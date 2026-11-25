import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { countChanges, isBinaryPatch, splitPatches } from './diffparse.js';
import type { ChangedFile, FileStatus, Scope, Side } from './types.js';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_TEXT = 20 * 1024 * 1024;

// Read-only by construction: no optional locks (no index refresh writes), no fsmonitor/ext-diff/textconv
// (which could run commands from repo config).
const BASE = [
  '--no-optional-locks', '--literal-pathspecs',
  '-c', 'safe.directory=*', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
];
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '-M'];

export class GitError extends Error {
  constructor(message: string, public code: number, public stderr: string) { super(message); }
}

export function git(cwd: string, args: string[], opts: { ok?: number[] } = {}): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile('git', [...(args[0] === 'check-ignore' ? BASE.filter((a) => a !== '--literal-pathspecs') : BASE), ...args], {
      cwd, encoding: 'buffer', maxBuffer: 1 << 30,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      const errText = stderr?.toString() ?? '';
      if (err) {
        const code = typeof (err as any).code === 'number' ? (err as any).code : -1;
        if (opts.ok?.includes(code)) return resolve({ stdout, stderr: errText, code });
        return reject(new GitError(`git ${args[0]} failed: ${errText.trim() || err.message}`, code, errText));
      }
      resolve({ stdout, stderr: errText, code: 0 });
    });
  });
}

export async function repoInfo(root: string) {
  const sym = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { ok: [1] });
  const branch = sym.stdout.toString().trim() || '(detached)';
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { ok: [1] });
  return { branch, hasHead: head.code === 0 };
}

export async function excludeFile(root: string): Promise<string> {
  const out = await git(root, ['rev-parse', '--git-path', 'info/exclude']);
  return path.resolve(root, out.stdout.toString().trim());
}

export async function isIgnored(root: string, rel: string): Promise<boolean> {
  const r = await git(root, ['check-ignore', '-q', '--', rel], { ok: [1] });
  return r.code === 0;
}

const sha = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

function trackedModeArgs(scope: Scope, base: string): string[] {
  if (scope === 'staged') return ['diff', '--cached', base];
  if (scope === 'all') return ['diff', base];
  return ['diff'];
}

const STATUS: Record<string, FileStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', U: 'modified' };

interface RawEntry { status: FileStatus; path: string; oldPath: string | null }

function parseRaw(buf: Buffer): RawEntry[] {
  const toks = buf.toString('utf8').split('\0');
  const out: RawEntry[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i].startsWith(':')) continue;
    const letter = toks[i].split(' ').pop()![0];
    if (letter === 'R' || letter === 'C') {
      out.push({ status: STATUS[letter], oldPath: toks[i + 1], path: toks[i + 2] });
      i += 2;
    } else {
      out.push({ status: STATUS[letter] ?? 'modified', oldPath: null, path: toks[i + 1] });
      i += 1;
    }
  }
  return out;
}

async function isTextFile(buf: Buffer) { return !buf.subarray(0, 8000).includes(0); }

export function countLines(text: string): number {
  if (text === '') return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

export async function readWorktree(root: string, rel: string): Promise<Buffer | null> {
  const abs = path.join(root, rel);
  let st;
  try { st = await fs.lstat(abs); } catch { return null; }
  const parent = await fs.realpath(path.dirname(abs)).catch(() => null);
  if (!parent || path.relative(root, parent).startsWith('..')) return null; // never escape via symlinked dirs
  if (st.isSymbolicLink()) return Buffer.from(await fs.readlink(abs));
  if (!st.isFile() || st.size > MAX_TEXT) return null;
  return fs.readFile(abs);
}

async function listUntracked(root: string): Promise<ChangedFile[]> {
  const out = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = out.stdout.toString('utf8').split('\0').filter((p) => p && !p.endsWith('/') && !isMeta(p));
  const files: ChangedFile[] = [];
  for (let i = 0; i < paths.length; i += 16) {
    const batch = await Promise.all(paths.slice(i, i + 16).map(async (p): Promise<ChangedFile> => {
      const buf = await readWorktree(root, p);
      if (!buf) return { path: p, oldPath: null, status: 'added', untracked: true, binary: true, additions: 0, deletions: 0, fingerprint: sha('missing:' + p) };
      const binary = !(await isTextFile(buf));
      return {
        path: p, oldPath: null, status: 'added', untracked: true, binary,
        additions: binary ? 0 : countLines(buf.toString('utf8')), deletions: 0, fingerprint: sha(buf),
      };
    }));
    files.push(...batch);
  }
  return files;
}

const isMeta = (p: string) => p === '.local-review' || p.startsWith('.local-review/');

export async function listChanges(root: string, scope: Scope): Promise<ChangedFile[]> {
  const { hasHead } = await repoInfo(root);
  const base = hasHead ? 'HEAD' : EMPTY_TREE;
  const files: ChangedFile[] = [];
  if (scope !== 'untracked') {
    const mode = trackedModeArgs(scope, base);
    const raw = parseRaw((await git(root, [...mode, ...DIFF_FLAGS, '--raw', '-z', '--abbrev=40'])).stdout);
    const patches = splitPatches((await git(root, [...mode, ...DIFF_FLAGS, '-U0'])).stdout.toString('utf8'));
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (isMeta(r.path)) continue;
      let patch = patches.length === raw.length ? patches[i] : '';
      if (patches.length !== raw.length) {
        const specs = r.oldPath ? [r.oldPath, r.path] : [r.path];
        patch = (await git(root, [...mode, ...DIFF_FLAGS, '-U0', '--', ...specs])).stdout.toString('utf8');
      }
      const { additions, deletions } = countChanges(patch);
      files.push({
        path: r.path, oldPath: r.oldPath, status: r.status, untracked: false,
        binary: isBinaryPatch(patch), additions, deletions, fingerprint: sha(patch),
      });
    }
  }
  if (scope !== 'staged') {
    const tracked = new Set(files.map((f) => f.path));
    for (const u of await listUntracked(root)) if (!tracked.has(u.path)) files.push(u);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Full-context patch text for one file, or null if the file has no changes in the scope. */
export async function filePatch(root: string, scope: Scope, rel: string, oldPath: string | null): Promise<{ patch: string; untracked: boolean } | null> {
  const { hasHead } = await repoInfo(root);
  const base = hasHead ? 'HEAD' : EMPTY_TREE;
  if (scope !== 'untracked') {
    const specs = oldPath && oldPath !== rel ? [oldPath, rel] : [rel];
    const out = await git(root, [...trackedModeArgs(scope, base), ...DIFF_FLAGS, '-U1000000', '--', ...specs]);
    const text = out.stdout.toString('utf8');
    if (text.trim()) return { patch: text, untracked: false };
  }
  if (scope !== 'staged') {
    const u = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', rel]);
    if (u.stdout.toString().split('\0').includes(rel)) {
      const out = await git(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '-U1000000', '--', '/dev/null', rel], { ok: [1] });
      return { patch: out.stdout.toString('utf8'), untracked: true };
    }
  }
  return null;
}

export function toLines(buf: Buffer | null): string[] | null {
  if (!buf || buf.subarray(0, 8000).includes(0)) return null;
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Content lines of one side of a file as the given scope sees it; null if absent/binary. */
export async function readSide(root: string, scope: Scope, rel: string, oldPath: string | null, side: Side): Promise<string[] | null> {
  const { hasHead } = await repoInfo(root);
  const cat = async (spec: string) => {
    const r = await git(root, ['cat-file', 'blob', spec], { ok: [128] });
    return r.code === 0 ? r.stdout : null;
  };
  if (side === 'new') {
    if (scope === 'staged') return toLines(await cat(`:${rel}`));
    return toLines(await readWorktree(root, rel));
  }
  const p = oldPath ?? rel;
  if (scope === 'untracked') return null;
  if (scope === 'unstaged') return toLines(await cat(`:${p}`));
  return hasHead ? toLines(await cat(`HEAD:${p}`)) : null;
}
