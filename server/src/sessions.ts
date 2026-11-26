import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './types.js';

/**
 * Review sessions: a coding agent's /start-review creates (or resumes) a token for a repo, the browser tab
 * carries it, and "Finish review" flips it to `finished`. Stored in <DATA_DIR>/sessions.json (not in review.json).
 */
/** pending: agent listening. feedback/finished: user clicked, agent not yet picked up. working: agent is handling it (buttons inert). */
export type SessionStatus = 'pending' | 'feedback' | 'finished' | 'working';
export interface Session { repoId: string; status: SessionStatus; closing?: boolean; createdAt: string }
type Sessions = Record<string, Session>;

const file = () => path.join(process.env.DATA_DIR || '/data', 'sessions.json');
let queue: Promise<unknown> = Promise.resolve();
export const TOKEN_RE = /^[a-f0-9]{32}$/;

async function read(): Promise<Sessions> {
  let text: string;
  try { text = await fs.readFile(file(), 'utf8'); } catch (e: any) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  try { return JSON.parse(text); } catch {
    throw new HttpError(500, 'sessions_file_malformed', `${file()} is not valid JSON. It has been left untouched; fix or move it.`);
  }
}

function edit<T>(fn: (s: Sessions) => T): Promise<T> {
  const run = queue.catch(() => {}).then(async () => {
    const s = await read();
    const r = fn(s);
    const f = file();
    await fs.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 2) + '\n');
    await fs.rename(tmp, f);
    return r;
  });
  queue = run;
  return run;
}

const missing = () => new HttpError(404, 'session_not_found', 'Review session not found');

/** Resume the repo's session (e.g. the tab was closed), else create one. A `working` one is reset: its agent is presumed dead. */
export function startSession(repoId: string): Promise<{ token: string; session: Session }> {
  return edit((s) => {
    const open = Object.entries(s).find(([, v]) => v.repoId === repoId);
    if (open) {
      open[1].status = open[1].status === 'feedback' ? 'feedback' : 'pending';
      delete open[1].closing;
      return { token: open[0], session: open[1] };
    }
    const token = crypto.randomBytes(16).toString('hex');
    s[token] = { repoId, status: 'pending', createdAt: new Date().toISOString() };
    return { token, session: s[token] };
  });
}

export async function getSession(token: string): Promise<Session> {
  const s = TOKEN_RE.test(token) ? (await read())[token] : undefined;
  if (!s) throw missing();
  return s;
}

/** The user's click. Only accepted while the agent is not handling a previous one (finish may override an unpicked feedback). */
export function signalSession(token: string, status: 'feedback' | 'finished'): Promise<Session> {
  return edit((s) => {
    const x = TOKEN_RE.test(token) ? s[token] : undefined;
    if (!x) throw missing();
    if (x.status === 'working' || (x.status === 'finished' && status === 'feedback')) throw new HttpError(409, 'session_busy', 'Your coding agent is still working on the previous round');
    x.status = status;
    return x;
  });
}

/**
 * The agent's poll (`review session-wait`). A click is handed over once and the session goes to `working` (clicks rejected);
 * calling it again after a `feedback` round means the agent is back listening, so `working` returns to `pending`.
 */
export function consumeSession(token: string): Promise<SessionStatus> {
  return edit((s) => {
    const x = TOKEN_RE.test(token) ? s[token] : undefined;
    if (!x) throw missing();
    if (x.status === 'feedback' || x.status === 'finished') { x.closing = x.status === 'finished'; x.status = 'working'; return x.closing ? 'finished' : 'feedback'; }
    if (x.status === 'working') { if (x.closing) return 'finished'; x.status = 'pending'; }
    return 'pending';
  });
}

/** `review session-end`: the agent is done with a finished review; clears the token. */
export function endSession(token: string): Promise<void> {
  return edit((s) => { if (!TOKEN_RE.test(token) || !s[token]) throw missing(); delete s[token]; });
}
