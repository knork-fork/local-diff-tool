import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeAnchor, relocate } from './anchor.js';
import { markNewLines, parsePatch } from './diffparse.js';
import { filePatch, listChanges, readSide, repoInfo } from './git.js';
import { repoIdFor, safeRelPath } from './paths.js';
import { ReviewStore } from './store.js';
import { HttpError, SCOPES, type ChangedFile, type Discussion, type ReviewData, type Scope, type Settings, type Side } from './types.js';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const scopeKey = (branch: string, scope: Scope) => `${branch}::${scope}`;

export function parseScope(v: unknown, fallback: Scope = 'all'): Scope {
  if (v === undefined || v === '') return fallback;
  if (!SCOPES.includes(v as Scope)) throw new HttpError(400, 'invalid_scope', `scope must be one of ${SCOPES.join(', ')}`);
  return v as Scope;
}

const str = (v: unknown, name: string, max = 100_000): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'invalid_body', `${name} is required`);
  if (v.length > max) throw new HttpError(400, 'invalid_body', `${name} is too long`);
  return v;
};

export interface DiscussionFilter { file?: string; resolved?: boolean; outdated?: boolean }

export class Repo {
  readonly id: string;
  constructor(readonly root: string) {
    this.id = repoIdFor(root);
  }

  /** Review data lives in one file per branch, so the store follows the currently checked-out branch. */
  async store(): Promise<ReviewStore> {
    return new ReviewStore(this.root, (await repoInfo(this.root)).branch);
  }

  async info() {
    const { branch, hasHead } = await repoInfo(this.root);
    return {
      id: this.id, name: path.basename(this.root), path: this.root, branch, hasHead,
      reviewUrl: `/repositories/${this.id}`,
    };
  }

  async init() {
    await (await this.store()).ensureDir();
    return this.info();
  }

  private async scopeFallback(): Promise<Scope> {
    return (await (await this.store()).read()).settings.scope;
  }

  async resolveScope(v: unknown) { return parseScope(v, await this.scopeFallback()); }

  /** Reviewed paths whose file on disk was modified after they were marked reviewed (deleted files have no mtime: skipped). */
  private async modifiedSinceReview(reviewed: Record<string, { reviewedAt: string }>): Promise<Set<string>> {
    const out = new Set<string>();
    await Promise.all(Object.entries(reviewed).map(async ([p, e]) => {
      try {
        if ((await fs.lstat(path.join(this.root, p))).mtimeMs > Date.parse(e.reviewedAt)) out.add(p);
      } catch { /* missing on disk */ }
    }));
    return out;
  }

  private decorate(data: ReviewData, branch: string, scope: Scope, files: ChangedFile[], stale: Set<string> = new Set()) {
    const reviewed = data.reviewedFiles[scopeKey(branch, scope)] ?? {};
    const mine = data.discussions.filter((d) => d.branch === branch);
    const out = files.map((f) => {
      const ds = mine.filter((d) => d.path === f.path);
      return {
        ...f,
        reviewed: reviewed[f.path]?.fingerprint === f.fingerprint && !stale.has(f.path),
        discussionCount: ds.length,
        unresolvedCount: ds.filter((d) => !d.resolved).length,
      };
    });
    return {
      branch, scope, files: out,
      totals: {
        files: out.length,
        additions: out.reduce((s, f) => s + f.additions, 0),
        deletions: out.reduce((s, f) => s + f.deletions, 0),
        reviewed: out.filter((f) => f.reviewed).length,
        unresolvedDiscussions: mine.filter((d) => !d.resolved).length,
        totalDiscussions: mine.length,
      },
    };
  }

  async files(scope: Scope) {
    const [{ branch }, files, data] = await Promise.all([repoInfo(this.root), listChanges(this.root, scope), this.store().then((s) => s.read())]);
    const stale = await this.modifiedSinceReview(data.reviewedFiles[scopeKey(branch, scope)] ?? {});
    await this.syncCache(scope, files);
    return this.decorate(data, branch, scope, files, stale);
  }

  /**
   * Caches the whole current diff: every listed file without a baseline gets one (first sight), and baselines of
   * files that are no longer in the diff are dropped. Existing baselines are only replaced on mark-reviewed.
   */
  private async syncCache(scope: Scope, files: ChangedFile[]) {
    const { branch } = await repoInfo(this.root);
    const key = scopeKey(branch, scope);
    const store = await this.store();
    const cached = new Set(await store.cachedPaths(key));
    const present = new Set(files.map((f) => f.path));
    const missing = files.filter((f) => !cached.has(f.path));
    for (const p of cached) if (!present.has(p)) await store.deletePatch(key, p);
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.all(missing.slice(i, i + 8).map(async (f) => {
        const r = await filePatch(this.root, scope, f.path, f.oldPath);
        if (r) await store.writePatch(key, f.path, r.patch);
      }));
    }
  }

  async diff(scope: Scope, rel: string, oldPath: string | null) {
    rel = safeRelPath(rel);
    if (oldPath) oldPath = safeRelPath(oldPath);
    const res = await filePatch(this.root, scope, rel, oldPath);
    if (!res) throw new HttpError(404, 'no_changes', `No changes for ${rel} in scope ${scope}`);
    const p = parsePatch(res.patch);
    const { branch } = await repoInfo(this.root);
    const cached = await (await this.store()).readPatch(scopeKey(branch, scope), rel);
    if (cached !== null && cached !== res.patch) markNewLines(p.hunks, cached);
    return {
      path: rel, oldPath: p.oldPath ?? (oldPath && oldPath !== rel ? oldPath : null), scope,
      status: p.isNew ? 'added' : p.isDeleted ? 'deleted' : p.isRename ? 'renamed' : 'modified',
      untracked: res.untracked, binary: p.binary, hunks: p.hunks,
    };
  }

  /** Refresh: invalidate stale reviewed files, re-anchor discussions, persist. */
  async refresh(scope: Scope) {
    const { branch } = await repoInfo(this.root);
    const files = await listChanges(this.root, scope);
    await this.syncCache(scope, files);
    const oldPathOf = new Map(files.filter((f) => f.oldPath).map((f) => [f.path, f.oldPath!]));
    const report = { invalidated: [] as string[], outdated: [] as string[], relocated: [] as string[], reopened: [] as string[] };
    const data = await (await this.store()).mutate(async (d) => {
      const key = scopeKey(branch, scope);
      const reviewed = d.reviewedFiles[key] ?? {};
      const byPath = new Map(files.map((f) => [f.path, f]));
      const stale = await this.modifiedSinceReview(reviewed);
      for (const [p, entry] of Object.entries(reviewed)) {
        if (byPath.get(p)?.fingerprint !== entry.fingerprint || stale.has(p)) { delete reviewed[p]; report.invalidated.push(p); }
      }
      d.reviewedFiles[key] = reviewed;
      const cache = new Map<string, string[] | null>();
      for (const disc of d.discussions) {
        if (disc.branch !== branch) continue;
        const ck = `${disc.side}:${disc.path}`;
        if (!cache.has(ck)) cache.set(ck, await readSide(this.root, scope, disc.path, oldPathOf.get(disc.path) ?? null, disc.side));
        const r = relocate(cache.get(ck)!, disc.anchor, disc.startLine, disc.endLine);
        if (r.found) {
          if (r.start !== disc.startLine) report.relocated.push(disc.id);
          if (disc.outdated) report.reopened.push(disc.id);
          disc.startLine = r.start; disc.endLine = r.end; disc.outdated = false;
        } else if (!disc.outdated) { disc.outdated = true; report.outdated.push(disc.id); }
      }
      return JSON.parse(JSON.stringify(d)) as ReviewData;
    });
    return { ...this.decorate(data, branch, scope, files), refresh: report };
  }

  async setReviewed(scope: Scope, rel: string, reviewed: boolean) {
    rel = safeRelPath(rel);
    const { branch } = await repoInfo(this.root);
    const files = await listChanges(this.root, scope);
    const f = files.find((x) => x.path === rel);
    if (!f) throw new HttpError(404, 'no_changes', `${rel} has no changes in scope ${scope}`);
    const patch = reviewed ? (await filePatch(this.root, scope, rel, f.oldPath))?.patch : undefined;
    const st = await this.store();
    if (patch !== undefined) await st.writePatch(scopeKey(branch, scope), rel, patch);
    await st.mutate((d) => {
      const key = scopeKey(branch, scope);
      d.reviewedFiles[key] ??= {};
      if (reviewed) {
        d.reviewedFiles[key][rel] = { fingerprint: f.fingerprint, reviewedAt: now() };
      } else delete d.reviewedFiles[key][rel];
    });
    return this.files(scope);
  }

  async setAllReviewed(scope: Scope, reviewed: boolean) {
    const { branch } = await repoInfo(this.root);
    const files = await listChanges(this.root, scope);
    const patches = new Map<string, string>();
    if (reviewed) await Promise.all(files.map(async (f) => { const r = await filePatch(this.root, scope, f.path, f.oldPath); if (r) patches.set(f.path, r.patch); }));
    const st = await this.store();
    for (const [p, patch] of patches) await st.writePatch(scopeKey(branch, scope), p, patch);
    await st.mutate((d) => {
      const key = scopeKey(branch, scope);
      d.reviewedFiles[key] ??= {};
      for (const f of files) {
        if (reviewed) {
          d.reviewedFiles[key][f.path] = { fingerprint: f.fingerprint, reviewedAt: now() };
        }
        else delete d.reviewedFiles[key][f.path];
      }
    });
    return this.files(scope);
  }

  async settings(patch?: Partial<Settings>) {
    const store = await this.store();
    if (!patch) return (await store.read()).settings;
    return store.mutate((d) => {
      if (patch.viewMode !== undefined) {
        if (patch.viewMode !== 'unified' && patch.viewMode !== 'split') throw new HttpError(400, 'invalid_body', 'invalid viewMode');
        d.settings.viewMode = patch.viewMode;
      }
      if (patch.scope !== undefined) d.settings.scope = parseScope(patch.scope);
      if (patch.contextLines !== undefined) {
        if (!Number.isInteger(patch.contextLines) || patch.contextLines < 0 || patch.contextLines > 50) throw new HttpError(400, 'invalid_body', 'invalid contextLines');
        d.settings.contextLines = patch.contextLines;
      }
      return { ...d.settings };
    });
  }

  // ---- discussions ----
  async listDiscussions(f: DiscussionFilter = {}) {
    const data = await (await this.store()).read();
    return data.discussions.filter((d) =>
      (f.file === undefined || d.path === f.file) &&
      (f.resolved === undefined || d.resolved === f.resolved) &&
      (f.outdated === undefined || d.outdated === f.outdated));
  }

  /** CLI view of a thread: absolute file + the line the UI shows it at (endLine on its side). */
  private cliComment(d: Discussion) {
    return {
      id: d.id, file: path.join(this.root, d.path), path: d.path, line: d.endLine, startLine: d.startLine, side: d.side,
      resolved: d.resolved, outdated: d.outdated, body: d.body, author: d.author, createdAt: d.createdAt,
      replies: d.replies.map((r) => ({ id: r.id, body: r.body, author: r.author, createdAt: r.createdAt })),
    };
  }

  /** Re-anchors first so lines match what the UI shows after a refresh. */
  async cliComments(id?: string) {
    await this.refresh(await this.resolveScope(undefined));
    const all = await this.listDiscussions();
    if (id === undefined) return all.filter((d) => !d.resolved).map((d) => this.cliComment(d));
    const d = all.find((x) => x.id === id);
    if (!d) throw new HttpError(404, 'not_found', 'Discussion not found');
    return this.cliComment(d);
  }

  async createDiscussion(b: any): Promise<Discussion> {
    const scope = await this.resolveScope(b.scope);
    const rel = safeRelPath(b.path);
    const side: Side = b.side === 'old' ? 'old' : b.side === 'new' ? 'new' : (() => { throw new HttpError(400, 'invalid_body', 'side must be old or new'); })();
    const startLine = Number(b.startLine);
    const endLine = b.endLine === undefined ? startLine : Number(b.endLine);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) throw new HttpError(400, 'invalid_body', 'invalid line range');
    const body = str(b.body, 'body');
    const { branch } = await repoInfo(this.root);
    const files = await listChanges(this.root, scope);
    const f = files.find((x) => x.path === rel);
    const lines = await readSide(this.root, scope, rel, f?.oldPath ?? null, side);
    if (!lines || endLine > lines.length) throw new HttpError(400, 'invalid_lines', 'Lines do not exist on that side of the file');
    const t = now();
    const d: Discussion = {
      id: uid(), branch, scope, path: rel, side, startLine, endLine, originalStartLine: startLine, originalEndLine: endLine,
      anchor: makeAnchor(lines, startLine, endLine), fingerprint: f?.fingerprint ?? '', body,
      author: typeof b.author === 'string' && b.author ? b.author : 'You', replies: [],
      resolved: false, resolvedAt: null, outdated: false, createdAt: t, updatedAt: t,
    };
    await (await this.store()).mutate((data) => { data.discussions.push(d); });
    return d;
  }

  private async withDiscussion<T>(id: string, fn: (d: Discussion, data: ReviewData) => T): Promise<T> {
    return (await this.store()).mutate((data) => {
      const d = data.discussions.find((x) => x.id === id);
      if (!d) throw new HttpError(404, 'not_found', 'Discussion not found');
      const r = fn(d, data);
      d.updatedAt = now();
      return r;
    });
  }

  updateDiscussion(id: string, b: any) {
    return this.withDiscussion(id, (d) => {
      if (b.body !== undefined) d.body = str(b.body, 'body');
      if (b.resolved !== undefined) {
        d.resolved = !!b.resolved;
        d.resolvedAt = d.resolved ? now() : null;
      }
      return { ...d };
    });
  }

  /** Branch + comment count + oldest comment time, for the CLI's stale-comment prompt. */
  async commentStats() {
    const { branch } = await repoInfo(this.root);
    const ds = (await (await this.store()).read()).discussions;
    const oldest = ds.map((d) => d.createdAt).sort()[0] ?? null;
    return { branch, count: ds.length, oldestCreatedAt: oldest };
  }

  /** Removes every discussion of the current branch only (other branches/repos have their own files). */
  async clearDiscussions() {
    return (await this.store()).mutate((data) => {
      const n = data.discussions.length;
      data.discussions = [];
      return n;
    });
  }

  async deleteDiscussion(id: string) {
    await (await this.store()).mutate((data) => {
      const i = data.discussions.findIndex((x) => x.id === id);
      if (i < 0) throw new HttpError(404, 'not_found', 'Discussion not found');
      data.discussions.splice(i, 1);
    });
  }

  addReply(id: string, b: any) {
    const body = str(b.body, 'body');
    return this.withDiscussion(id, (d) => {
      const t = now();
      d.replies.push({ id: uid(), body, author: typeof b.author === 'string' && b.author ? b.author : 'You', createdAt: t, updatedAt: t });
      return { ...d };
    });
  }

  updateReply(id: string, replyId: string, b: any) {
    const body = str(b.body, 'body');
    return this.withDiscussion(id, (d) => {
      const r = d.replies.find((x) => x.id === replyId);
      if (!r) throw new HttpError(404, 'not_found', 'Reply not found');
      r.body = body; r.updatedAt = now();
      return { ...d };
    });
  }

  deleteReply(id: string, replyId: string) {
    return this.withDiscussion(id, (d) => {
      const i = d.replies.findIndex((x) => x.id === replyId);
      if (i < 0) throw new HttpError(404, 'not_found', 'Reply not found');
      d.replies.splice(i, 1);
      return { ...d };
    });
  }
}
