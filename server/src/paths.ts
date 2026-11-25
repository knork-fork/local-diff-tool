import fs from 'node:fs/promises';
import path from 'node:path';
import { git, GitError } from './git.js';
import { HttpError } from './types.js';

export const META_DIR = '.local-review';

export function allowedRoots(): string[] {
  const raw = process.env.ALLOWED_ROOTS || process.env.HOST_HOME || process.env.HOME || '/';
  return raw.split(':').filter(Boolean);
}

export function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolves any path inside a git work tree to the repo root, enforcing the mounted roots. */
export async function resolveRepoRoot(input: string): Promise<string> {
  if (!path.isAbsolute(input)) throw new HttpError(400, 'invalid_path', 'Repository path must be absolute');
  let real: string;
  try {
    real = await fs.realpath(input);
  } catch {
    throw new HttpError(400, 'inaccessible_path', `Path is not accessible from the container: ${input}`);
  }
  const roots: string[] = [];
  for (const r of allowedRoots()) {
    try { roots.push(await fs.realpath(r)); } catch { /* ignore missing roots */ }
  }
  if (!roots.some((r) => within(r, real))) {
    throw new HttpError(403, 'outside_mounts', `Path is outside the mounted directories (${allowedRoots().join(', ')}). Add a mount and ALLOWED_ROOTS entry in docker-compose.yml.`);
  }
  const stat = await fs.stat(real);
  const cwd = stat.isDirectory() ? real : path.dirname(real);
  try {
    const out = await git(cwd, ['rev-parse', '--show-toplevel']);
    const top = await fs.realpath(out.stdout.toString().trim());
    if (!roots.some((r) => within(r, top))) throw new HttpError(403, 'outside_mounts', 'Repository root is outside the mounted directories');
    return top;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof GitError) throw new HttpError(400, 'not_a_repository', `Not a git repository: ${input}`);
    throw e;
  }
}

export const repoIdFor = (root: string) => Buffer.from(root).toString('base64url');
export const rootFromId = (id: string) => Buffer.from(id, 'base64url').toString('utf8');

/** Validates a repository-relative file path (no traversal, not the metadata dir). */
export function safeRelPath(p: unknown): string {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) throw new HttpError(400, 'invalid_path', 'Invalid file path');
  const norm = path.posix.normalize(p);
  if (path.isAbsolute(norm) || norm === '..' || norm.startsWith('../') || norm === '.') {
    throw new HttpError(400, 'invalid_path', 'Invalid file path');
  }
  if (norm === META_DIR || norm.startsWith(META_DIR + '/')) throw new HttpError(400, 'invalid_path', 'Metadata directory is not reviewable');
  return norm;
}

export const isMetaPath = (p: string) => p === META_DIR || p.startsWith(META_DIR + '/');
