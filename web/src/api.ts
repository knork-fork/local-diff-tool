import type { Discussion, FileDiff, FilesResult, RepoInfo, Scope, Settings } from './types';

export class ApiError extends Error {}

async function req<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error.message; } catch { /* keep default */ }
    throw new ApiError(msg);
  }
  if (res.status === 204) return undefined as T;
  return (raw ? res.text() : res.json()) as Promise<T>;
}

export const makeApi = (id: string) => {
  const b = `/api/repositories/${id}`;
  const q = (o: Record<string, string | undefined>) =>
    Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return {
    info: () => req<RepoInfo>('GET', b),
    settings: () => req<Settings>('GET', `${b}/settings`),
    patchSettings: (s: Partial<Settings>) => req<Settings>('PATCH', `${b}/settings`, s),
    files: (scope: Scope) => req<FilesResult>('GET', `${b}/files?scope=${scope}`),
    refresh: (scope: Scope) => req<FilesResult>('POST', `${b}/refresh`, { scope }),
    diff: (scope: Scope, path: string, oldPath: string | null) => req<FileDiff>('GET', `${b}/diff?${q({ scope, path, oldPath: oldPath ?? undefined })}`),
    setReviewed: (scope: Scope, path: string, reviewed: boolean) => req<FilesResult>('PUT', `${b}/files/reviewed`, { scope, path, reviewed }),
    discussions: () => req<{ discussions: Discussion[] }>('GET', `${b}/discussions`).then((r) => r.discussions),
    create: (scope: Scope, path: string, side: string, startLine: number, endLine: number, body: string) =>
      req<Discussion>('POST', `${b}/discussions`, { scope, path, side, startLine, endLine, body }),
    update: (id: string, patch: { body?: string; resolved?: boolean }) => req<Discussion>('PATCH', `${b}/discussions/${id}`, patch),
    remove: (id: string) => req<void>('DELETE', `${b}/discussions/${id}`),
    reply: (id: string, body: string) => req<Discussion>('POST', `${b}/discussions/${id}/replies`, { body }),
    updateReply: (id: string, rid: string, body: string) => req<Discussion>('PATCH', `${b}/discussions/${id}/replies/${rid}`, { body }),
    removeReply: (id: string, rid: string) => req<Discussion>('DELETE', `${b}/discussions/${id}/replies/${rid}`),
  };
};
export type Api = ReturnType<typeof makeApi>;

export const listRepos = () => req<{ repositories: RepoInfo[] }>('GET', '/api/repositories').then((r) => r.repositories);
