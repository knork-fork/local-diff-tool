import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { repoIdFor, resolveRepoRoot, rootFromId } from './paths.js';
import { parseScope, Repo } from './repo.js';
import { HttpError } from './types.js';
import { GitError } from './git.js';

const known = new Map<string, Repo>();
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function getRepo(id: string): Promise<Repo> {
  const root = await resolveRepoRoot(rootFromId(id)).catch((e) => {
    if (e instanceof HttpError && e.statusCode === 400) throw new HttpError(404, 'repository_not_found', 'Repository not found');
    throw e;
  });
  let r = known.get(repoIdFor(root));
  if (!r) { r = new Repo(root); known.set(r.id, r); }
  return r;
}

const bool = (v: unknown): boolean | undefined => (v === undefined || v === '' ? undefined : v === 'true' || v === '1');

export function buildApp(opts: { webDir?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && { level: 'info' }, bodyLimit: 2 * 1024 * 1024, maxParamLength: 2048 });

  // DNS-rebinding / cross-site protection for a service with no auth.
  app.addHook('onRequest', async (req) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) throw new HttpError(403, 'forbidden_host', 'Only localhost access is allowed');
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'forbidden_origin', 'Cross-origin request rejected');
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    if (err instanceof GitError) return reply.status(500).send({ error: { code: 'git_error', message: err.message } });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: { code: 'bad_request', message: err.message } });
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: err.message } });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post('/api/repositories/open', async (req) => {
    const b = (req.body ?? {}) as { path?: string };
    if (typeof b.path !== 'string') throw new HttpError(400, 'invalid_body', 'path is required');
    const root = await resolveRepoRoot(b.path);
    let r = known.get(repoIdFor(root));
    if (!r) { r = new Repo(root); known.set(r.id, r); }
    return r.init();
  });
  app.get('/api/repositories', async () => ({ repositories: await Promise.all([...known.values()].map((r) => r.info().catch(() => null))).then((l) => l.filter(Boolean)) }));

  const R = '/api/repositories/:id';
  type Q = Record<string, string | undefined>;
  type P = { id: string; discussionId?: string; replyId?: string };

  app.get<{ Params: P }>(R, async (req) => (await getRepo(req.params.id)).info());
  app.get<{ Params: P; Querystring: Q }>(`${R}/files`, async (req) => {
    const r = await getRepo(req.params.id);
    return r.files(await r.resolveScope(req.query.scope));
  });
  app.get<{ Params: P; Querystring: Q }>(`${R}/diff`, async (req) => {
    const r = await getRepo(req.params.id);
    if (!req.query.path) throw new HttpError(400, 'invalid_query', 'path is required');
    return r.diff(await r.resolveScope(req.query.scope), req.query.path, req.query.oldPath ?? null);
  });
  app.post<{ Params: P; Body: Record<string, any> }>(`${R}/refresh`, async (req) => {
    const r = await getRepo(req.params.id);
    return r.refresh(await r.resolveScope(req.body?.scope));
  });
  app.put<{ Params: P; Body: Record<string, any> }>(`${R}/files/reviewed`, async (req) => {
    const r = await getRepo(req.params.id);
    return r.setReviewed(await r.resolveScope(req.body?.scope), req.body?.path, !!req.body?.reviewed);
  });
  app.get<{ Params: P }>(`${R}/settings`, async (req) => (await getRepo(req.params.id)).settings());
  app.patch<{ Params: P; Body: Record<string, any> }>(`${R}/settings`, async (req) => (await getRepo(req.params.id)).settings(req.body ?? {}));

  app.get<{ Params: P; Querystring: Q }>(`${R}/discussions`, async (req) => {
    const r = await getRepo(req.params.id);
    const q = req.query;
    return { discussions: await r.listDiscussions({ file: q.file, resolved: bool(q.resolved), outdated: bool(q.outdated) }) };
  });
  app.get<{ Params: P }>(`${R}/comment-stats`, async (req) => (await getRepo(req.params.id)).commentStats());
  app.delete<{ Params: P }>(`${R}/comments`, async (req) => ({ cleared: await (await getRepo(req.params.id)).clearDiscussions() }));
  app.get<{ Params: P }>(`${R}/comments`, async (req) => ({ comments: await (await getRepo(req.params.id)).cliComments() }));
  app.get<{ Params: P }>(`${R}/comments/:discussionId`, async (req) => (await getRepo(req.params.id)).cliComments(req.params.discussionId!));
  app.post<{ Params: P; Body: Record<string, any> }>(`${R}/discussions`, async (req, reply) => reply.status(201).send(await (await getRepo(req.params.id)).createDiscussion(req.body ?? {})));
  app.patch<{ Params: P; Body: Record<string, any> }>(`${R}/discussions/:discussionId`, async (req) => (await getRepo(req.params.id)).updateDiscussion(req.params.discussionId!, req.body ?? {}));
  app.delete<{ Params: P }>(`${R}/discussions/:discussionId`, async (req, reply) => {
    await (await getRepo(req.params.id)).deleteDiscussion(req.params.discussionId!);
    return reply.status(204).send();
  });
  app.post<{ Params: P; Body: Record<string, any> }>(`${R}/discussions/:discussionId/replies`, async (req, reply) =>
    reply.status(201).send(await (await getRepo(req.params.id)).addReply(req.params.discussionId!, req.body ?? {})));
  app.patch<{ Params: P; Body: Record<string, any> }>(`${R}/discussions/:discussionId/replies/:replyId`, async (req) =>
    (await getRepo(req.params.id)).updateReply(req.params.discussionId!, req.params.replyId!, req.body ?? {}));
  app.delete<{ Params: P }>(`${R}/discussions/:discussionId/replies/:replyId`, async (req) =>
    (await getRepo(req.params.id)).deleteReply(req.params.discussionId!, req.params.replyId!));

  const webDir = opts.webDir;
  if (webDir && fs.existsSync(webDir)) {
    app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'not_found', message: 'Unknown endpoint' } });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));
  }
  void parseScope; void path;
  return app;
}
