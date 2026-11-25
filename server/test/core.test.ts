import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeAnchor, relocate } from '../src/anchor.js';
import { parsePatch } from '../src/diffparse.js';
import { buildApp } from '../src/app.js';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
let dir: string;
process.env.ALLOWED_ROOTS = os.tmpdir();
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-data-'));
process.env.DATA_DIR = DATA;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lr-')));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
});

describe('anchor', () => {
  const file = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('relocates after insertion above', () => {
    const anchor = makeAnchor(file, 3, 4);
    const r = relocate(['x', 'y', ...file], anchor, 3, 4);
    expect(r).toEqual({ found: true, start: 5, end: 6 });
  });
  it('reports outdated when modified', () => {
    expect(relocate(['a', 'b', 'C', 'd'], makeAnchor(file, 3, 4), 3, 4).found).toBe(false);
  });
});

describe('parsePatch', () => {
  it('parses hunks', () => {
    const p = parsePatch('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+c\n');
    expect(p.hunks[0].lines.map((l) => l.type)).toEqual(['ctx', 'del', 'add']);
    expect(p.hunks[0].lines[2].newNumber).toBe(2);
  });
});

describe('api', () => {
  it('handles unborn repo, untracked, staged, review flow; never touches git state', async () => {
    const app = buildApp();
    const H = { host: 'localhost:22222' };
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2]));
    const open = await app.inject({ method: 'POST', url: '/api/repositories/open', headers: H, payload: { path: dir } });
    expect(open.body).toContain('id'); expect(open.statusCode).toBe(200);
    const id = open.json().id;
    const base = `/api/repositories/${id}`;
    let files = (await app.inject({ url: `${base}/files`, headers: H })).json();
    expect(files.files.map((f: any) => f.path)).toEqual(['a.txt', 'bin.dat']);
    expect(files.files.find((f: any) => f.path === 'bin.dat').binary).toBe(true);
    expect(fs.existsSync(path.join(dir, '.local-review'))).toBe(false); // nothing written into the repo

    const diff = (await app.inject({ url: `${base}/diff?path=a.txt`, headers: H })).json();
    expect(diff.status).toBe('added');
    expect(diff.hunks[0].lines).toHaveLength(3);

    const mk = await app.inject({ method: 'POST', url: `${base}/discussions`, headers: H, payload: { path: 'a.txt', side: 'new', startLine: 2, body: 'hmm' } });
    expect(mk.statusCode).toBe(201);
    const did = mk.json().id;
    await app.inject({ method: 'POST', url: `${base}/discussions/${did}/replies`, headers: H, payload: { body: 'r' } });
    await app.inject({ method: 'PUT', url: `${base}/files/reviewed`, headers: H, payload: { path: 'a.txt', reviewed: true } });
    files = (await app.inject({ url: `${base}/files`, headers: H })).json();
    expect(files.totals.reviewed).toBe(1);
    expect(files.totals.unresolvedDiscussions).toBe(1);

    // modify file: reviewed invalidated, comment relocated
    fs.writeFileSync(path.join(dir, 'a.txt'), 'zero\none\ntwo\nthree\n');
    const ref = (await app.inject({ method: 'POST', url: `${base}/refresh`, headers: H, payload: {} })).json();
    expect(ref.refresh.invalidated).toEqual(['a.txt']);
    expect(ref.totals.reviewed).toBe(0);
    const d = (await app.inject({ url: `${base}/discussions`, headers: H })).json().discussions[0];
    expect([d.startLine, d.outdated]).toEqual([3, false]);
    const cl = (await app.inject({ url: `${base}/comments`, headers: H })).json().comments;
    expect([cl[0].file, cl[0].line, cl[0].replies.length]).toEqual([path.join(dir, 'a.txt'), 3, 1]);
    await app.inject({ method: 'PATCH', url: `${base}/discussions/${did}`, headers: H, payload: { resolved: true } });
    expect((await app.inject({ url: `${base}/comments`, headers: H })).json().comments).toHaveLength(0);
    expect((await app.inject({ url: `${base}/comments/${did}`, headers: H })).json().resolved).toBe(true);
    await app.inject({ method: 'PATCH', url: `${base}/discussions/${did}`, headers: H, payload: { resolved: false } });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'zero\none\nTWO\nthree\n');
    await app.inject({ method: 'POST', url: `${base}/refresh`, headers: H, payload: {} });
    expect((await app.inject({ url: `${base}/discussions?outdated=true`, headers: H })).json().discussions).toHaveLength(1);

    // review data is per branch: a different branch starts empty, and the original is intact when switching back
    const orig = sh(dir, 'symbolic-ref', '--short', 'HEAD').trim();
    sh(dir, 'symbolic-ref', 'HEAD', 'refs/heads/feature/x');
    expect((await app.inject({ url: `${base}/discussions`, headers: H })).json().discussions).toHaveLength(0);
    sh(dir, 'symbolic-ref', 'HEAD', `refs/heads/${orig}`);
    expect((await app.inject({ url: `${base}/discussions`, headers: H })).json().discussions).toHaveLength(1);

    // clear only affects the current branch
    const stats = (await app.inject({ url: `${base}/comment-stats`, headers: H })).json();
    expect(stats.count).toBe(1);
    expect(typeof stats.oldestCreatedAt).toBe('string');
    sh(dir, 'symbolic-ref', 'HEAD', 'refs/heads/feature/x');
    expect((await app.inject({ method: 'DELETE', url: `${base}/comments`, headers: H })).json().cleared).toBe(0);
    sh(dir, 'symbolic-ref', 'HEAD', `refs/heads/${orig}`);
    expect((await app.inject({ url: `${base}/discussions`, headers: H })).json().discussions).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `${base}/comments`, headers: H })).json().cleared).toBe(1);
    expect((await app.inject({ url: `${base}/discussions`, headers: H })).json().discussions).toHaveLength(0);
    // restore a discussion for the remaining assertions
    await app.inject({ method: 'POST', url: `${base}/discussions`, headers: H, payload: { path: 'a.txt', side: 'new', startLine: 1, body: 'again' } });

    // staged scope + commit-less repo
    sh(dir, 'add', 'a.txt');
    const st = (await app.inject({ url: `${base}/files?scope=staged`, headers: H })).json();
    expect(st.files.map((f: any) => f.path)).toEqual(['a.txt']);
    expect(sh(dir, 'status', '--porcelain')).toContain('A  a.txt');

    // malformed file is never overwritten
    const rf = fs.readdirSync(DATA).filter((n) => n.startsWith(path.basename(dir)))[0];
    const bdir = path.join(DATA, rf, 'branches');
    const file = path.join(bdir, fs.readdirSync(bdir).find((n) => n.startsWith(orig))!, 'review.json');
    fs.writeFileSync(file, '{oops');
    const bad = await app.inject({ method: 'PUT', url: `${base}/files/reviewed`, headers: H, payload: { path: 'a.txt', reviewed: true } });
    expect(bad.statusCode).toBe(500);
    expect(fs.readFileSync(file, 'utf8')).toBe('{oops');
  });

  it('unreviews a file modified on disk after it was reviewed', async () => {
    const app = buildApp(); const H = { host: 'localhost' };
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    const id = (await app.inject({ method: 'POST', url: '/api/repositories/open', headers: H, payload: { path: dir } })).json().id;
    const base = `/api/repositories/${id}`;
    await app.inject({ method: 'PUT', url: `${base}/files/reviewed`, headers: H, payload: { path: 'a.txt', reviewed: true } });
    expect((await app.inject({ url: `${base}/files`, headers: H })).json().files[0].reviewed).toBe(true);
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, 'a.txt'), future, future);
    expect((await app.inject({ url: `${base}/files`, headers: H })).json().files[0].reviewed).toBe(false);
    const r = (await app.inject({ method: 'POST', url: `${base}/refresh`, headers: H, payload: {} })).json();
    expect(r.refresh.invalidated).toEqual(['a.txt']);
  });

  it('rejects foreign hosts and traversal', async () => {
    const app = buildApp();
    expect((await app.inject({ url: '/api/health', headers: { host: 'evil.com' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/health', headers: { host: 'localhost:22222' } })).statusCode).toBe(200);
    const open = await app.inject({ method: 'POST', url: '/api/repositories/open', headers: { host: 'localhost' }, payload: { path: dir } });
    const r = await app.inject({ url: `/api/repositories/${open.json().id}/diff?path=../etc/passwd`, headers: { host: 'localhost' } });
    expect(r.statusCode).toBe(400);
  });

  it('detects renames and modifications', async () => {
    const app = buildApp(); const H = { host: 'localhost' };
    fs.writeFileSync(path.join(dir, 'a.txt'), 'l1\nl2\nl3\nl4\nl5\nl6\n');
    sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'init');
    sh(dir, 'mv', 'a.txt', 'b.txt');
    fs.appendFileSync(path.join(dir, 'b.txt'), 'l7\n');
    const open = await app.inject({ method: 'POST', url: '/api/repositories/open', headers: H, payload: { path: dir } });
    const base = `/api/repositories/${open.json().id}`;
    const f = (await app.inject({ url: `${base}/files?scope=all`, headers: H })).json().files;
    expect(f[0]).toMatchObject({ path: 'b.txt', oldPath: 'a.txt', status: 'renamed', additions: 1 });
    const d = (await app.inject({ url: `${base}/diff?scope=all&path=b.txt&oldPath=a.txt`, headers: H })).json();
    expect(d.status).toBe('renamed');
  });
});
