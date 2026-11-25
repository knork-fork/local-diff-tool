import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, type ReviewData } from './types.js';

export const SCHEMA_VERSION = 1;
const FILE = 'review.json';
const dataDir = () => process.env.DATA_DIR || '/data';
const queues = new Map<string, Promise<unknown>>();

export function defaultData(): ReviewData {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION, revision: 0, reviewedFiles: {}, discussions: [], reviews: [],
    settings: { viewMode: 'unified', scope: 'unstaged', contextLines: 3 },
    createdAt: now, updatedAt: now,
  };
}

// Migrations keyed by the version they upgrade FROM.
const migrations: Record<number, (d: any) => any> = {};

export class ReviewStore {
  readonly dir: string;
  readonly file: string;
  constructor(public root: string) {
    // Central storage: <DATA_DIR>/<repo-name>-<hash of root path>/review.json
    const key = `${path.basename(root).replace(/[^\w.-]/g, '_')}-${crypto.createHash('sha1').update(root).digest('hex').slice(0, 10)}`;
    this.dir = path.join(dataDir(), key);
    this.file = path.join(this.dir, FILE);
  }

  async ensureDir() {
    try {
      const st = await fs.lstat(this.dir);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new HttpError(500, 'metadata_dir_invalid', `${this.dir} must be a real directory`);
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      if (e.code !== 'ENOENT') throw e;
      await fs.mkdir(this.dir, { recursive: true });
    }
    try { await fs.access(this.dir, fs.constants.W_OK); } catch {
      throw new HttpError(500, 'metadata_not_writable', `${this.dir} is not writable from the container`);
    }
  }

  async read(): Promise<ReviewData> {
    let text: string;
    try {
      const st = await fs.lstat(this.file);
      if (st.isSymbolicLink()) throw new HttpError(500, 'review_file_invalid', 'review.json must not be a symlink');
      text = await fs.readFile(this.file, 'utf8');
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      if (e.code === 'ENOENT') return defaultData();
      throw e;
    }
    let data: any;
    try { data = JSON.parse(text); } catch {
      throw new HttpError(500, 'review_file_malformed', `${this.file} is not valid JSON. It has been left untouched; fix or move it.`);
    }
    if (!data || typeof data !== 'object' || typeof data.schemaVersion !== 'number' || !Array.isArray(data.discussions)) {
      throw new HttpError(500, 'review_file_malformed', `${this.file} has an unexpected structure. It has been left untouched.`);
    }
    if (data.schemaVersion > SCHEMA_VERSION) {
      throw new HttpError(500, 'review_file_unsupported', `${this.file} uses schema ${data.schemaVersion}, newer than supported (${SCHEMA_VERSION}).`);
    }
    while (data.schemaVersion < SCHEMA_VERSION) {
      const m = migrations[data.schemaVersion];
      if (!m) throw new HttpError(500, 'review_file_unsupported', `No migration from schema ${data.schemaVersion}`);
      data = m(data);
    }
    return { ...defaultData(), ...data, settings: { ...defaultData().settings, ...data.settings } };
  }

  /** Serialised read-modify-write with a cross-process lock file and atomic rename. */
  mutate<T>(fn: (d: ReviewData) => T | Promise<T>): Promise<T> {
    const prev = queues.get(this.root) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.locked(fn));
    queues.set(this.root, run);
    return run;
  }

  private async locked<T>(fn: (d: ReviewData) => T | Promise<T>): Promise<T> {
    await this.ensureDir();
    const lock = path.join(this.dir, FILE + '.lock');
    const start = Date.now();
    for (;;) {
      try { (await fs.open(lock, 'wx')).close(); break; } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        const st = await fs.stat(lock).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 30_000) { await fs.rm(lock, { force: true }); continue; }
        if (Date.now() - start > 5000) throw new HttpError(503, 'review_locked', 'Review file is locked by another process');
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      const data = await this.read();
      const result = await fn(data);
      data.revision += 1;
      data.repoPath = this.root;
      data.updatedAt = new Date().toISOString();
      const tmp = path.join(this.dir, `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
      const fh = await fs.open(tmp, 'w');
      try { await fh.writeFile(JSON.stringify(data, null, 2) + '\n'); await fh.sync(); } finally { await fh.close(); }
      await fs.rename(tmp, this.file);
      return result;
    } finally {
      await fs.rm(lock, { force: true });
    }
  }
}
