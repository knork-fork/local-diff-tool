import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type SessionStatus, finishSession, getSession, listRepos, sendFeedback, makeApi } from './api';
import { DiffView } from './DiffView';
import { DiscussionsDialog, Modal, SettingsDialog } from './Dialogs';
import { flatten, Sidebar, type ReviewFilter } from './Sidebar';
import type { Actions } from './Thread';
import type { Discussion, FileDiff, FileEntry, FilesResult, RepoInfo, Scope, Settings } from './types';

const SCOPE_LABEL: Record<Scope, string> = {
  all: 'All uncommitted', staged: 'Staged only', unstaged: 'Unstaged only',
};

function useTheme() {
  const [theme, setThemeState] = useState(() => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, (t: string) => { setThemeState(t); try { localStorage.setItem('theme', t); } catch { /* ignore */ } }] as const;
}

export function App() {
  const m = /^\/repositories\/([^/]+)/.exec(location.pathname);
  return m ? <RepoPage id={m[1]} /> : <Home />;
}

function Home() {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  useEffect(() => { listRepos().then(setRepos).catch(() => setRepos([])); }, []);
  return (
    <div className="home">
      <h1>Local Review</h1>
      <p>Run <code>review</code> inside a git repository to open it here, or run <code>/start-review</code> in your coding agent (e.g. Claude Code) to review with it.</p>
      {repos?.map((r) => <p key={r.id}><a href={`/repositories/${r.id}`}>{r.name}</a> <span className="muted">{r.path}</span></p>)}
    </div>
  );
}

function RepoPage({ id }: { id: string }) {
  const api = useMemo(() => makeApi(id), [id]);
  const [theme, setTheme] = useTheme();
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [data, setData] = useState<FilesResult | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [selected, setSelected] = useState<string | null>(new URLSearchParams(location.search).get('file'));
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffErr, setDiffErr] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sinceOnly, setSinceOnly] = useState(false); // never persisted: full diff on refresh and on file switch
  const [dialog, setDialog] = useState<null | 'settings' | 'discussions' | 'finish'>(null);
  const [busy, setBusy] = useState(false);

  const scope = settings?.scope ?? 'all';

  // Review session token (from `review session-start`): kept in the URL and in sessionStorage so it survives refreshes of this tab.
  const [session, setSession] = useState<{ token: string; status: SessionStatus } | null>(null);
  const [ended, setEnded] = useState(false);
  const dropSession = () => { setSession(null); try { sessionStorage.removeItem(`session:${id}`); } catch { /* ignore */ } };
  useEffect(() => {
    const key = `session:${id}`;
    const u = new URL(location.href);
    let token = u.searchParams.get('session');
    try { if (token) sessionStorage.setItem(key, token); else token = sessionStorage.getItem(key); } catch { /* ignore */ }
    if (!token) return;
    getSession(token).then((r) => {
      setSession({ token: token!, status: r.status });
      if (!u.searchParams.has('session')) { u.searchParams.set('session', token!); history.replaceState(null, '', u); }
    }).catch(() => { try { sessionStorage.removeItem(key); } catch { /* ignore */ } });
  }, [id]);
  // Poll so the buttons go inert while the agent works, and disable when the token disappears (review ended elsewhere).
  const token = session?.token;
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => {
      getSession(token).then((r) => setSession((c) => (c && c.token === token ? { ...c, status: r.status } : c)))
        .catch((e) => { if (e instanceof ApiError && /session/i.test(e.message)) dropSession(); });
    }, 2000);
    return () => clearInterval(t);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const idle = session?.status === 'pending';
  const agentBusy = !!session && !idle; // spinner, not disabled
  const signal = async (kind: 'feedback' | 'finish') => {
    if (!session) return;
    setDialog(null);
    try {
      if (kind === 'feedback') {
        await sendFeedback(session.token);
        setSession({ ...session, status: 'feedback' });
        setNotice('Feedback sent. Your coding agent will address the comments and keep listening for more feedback.');
      } else {
        await finishSession(session.token);
        dropSession(); setEnded(true);
        window.close(); // only works for script-opened tabs; otherwise the "review finished" screen below stays
      }
    } catch (e: any) {
      if (e instanceof ApiError && /session/i.test(e.message)) dropSession();
      setNotice(e instanceof ApiError ? e.message : String(e));
    }
  };

  // Ctrl+Enter = Send feedback, except while typing (there it saves the comment/reply) or with a dialog open.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable || dialog || !idle) return;
      e.preventDefault();
      signal('feedback');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const loadFiles = useCallback(async (s: Scope) => {
    const [f, d] = await Promise.all([api.files(s), api.discussions()]);
    setData(f); setDiscussions(d);
  }, [api]);

  useEffect(() => {
    (async () => {
      try {
        const [i, s] = await Promise.all([api.info(), api.settings()]);
        setInfo(i); setSettings(s);
        await loadFiles(s.scope);
      } catch (e: any) { setError(e instanceof ApiError ? e.message : String(e)); }
    })();
  }, [api, loadFiles]);

  useEffect(() => { if (info) document.title = `${info.name} — Local Review`; }, [info]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.files ?? []).filter((f) =>
      (!q || f.path.toLowerCase().includes(q)) && (filter === 'all' || (filter === 'reviewed') === f.reviewed));
  }, [data, filter, query]);
  const ordered = useMemo(() => flatten(visible), [visible]);
  const current: FileEntry | undefined = data?.files.find((f) => f.path === selected);

  const select = useCallback((path: string | null) => {
    setSelected(path);
    const u = new URL(location.href);
    if (path) u.searchParams.set('file', path); else u.searchParams.delete('file');
    history.replaceState(null, '', u);
  }, []);

  // Only the selected file's diff is ever fetched.
  const [diffTick, setDiffTick] = useState(0);
  // Large diffs (> BIG_DIFF changed lines) need a per-file confirmation before rendering.
  const BIG_DIFF = 500;
  const [confirmedBig, setConfirmedBig] = useState(false);
  useEffect(() => setSinceOnly(false), [scope, current?.path]);
  useEffect(() => setConfirmedBig(false), [scope, current?.path]); // never remembered: re-ask whenever a file is (re)selected
  const needsConfirm = !!current && current.additions + current.deletions > BIG_DIFF && !confirmedBig;
  useEffect(() => {
    setDiff(null); setDiffErr('');
    if (!current || needsConfirm) return;
    let live = true;
    api.diff(scope, current.path, current.oldPath).then((d) => live && setDiff(d)).catch((e) => live && setDiffErr(e.message));
    return () => { live = false; };
  }, [api, scope, current?.path, current?.oldPath, current?.fingerprint, diffTick, needsConfirm]);

  const reload = useCallback(() => loadFiles(scope).catch((e) => setNotice(e.message)), [loadFiles, scope]);

  const guarded = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e: any) { setNotice(e.message); } finally { setBusy(false); }
  };

  // Poll only the review file's comments, and only to update threads already on the page (e.g. agent replies): never add
  // or remove threads, and never touch the diff, file list or reviewed state.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const fresh = new Map((await api.discussions()).map((d) => [d.id, d]));
        setDiscussions((cur) => {
          let changed = false;
          const next = cur.map((d) => {
            const f = fresh.get(d.id);
            if (!f || JSON.stringify(f) === JSON.stringify(d)) return d;
            changed = true; return f;
          });
          return changed ? next : cur;
        });
      } catch { /* transient; next tick retries */ }
    }, 4000);
    return () => clearInterval(t);
  }, [api]);

  const refresh = () => guarded(async () => {
    const r = await api.refresh(scope);
    setData(r); setDiscussions(await api.discussions()); setDiffTick((t) => t + 1);
    const x = r.refresh;
    setNotice(x ? `Refreshed: ${x.invalidated.length} file(s) un-reviewed, ${x.outdated.length} discussion(s) newly outdated, ${x.relocated.length} relocated.` : 'Refreshed');
  });

  const changeScope = (s: Scope) => guarded(async () => {
    const ns = await api.patchSettings({ scope: s });
    setSettings(ns); await loadFiles(s); select(null);
  });
  const patchSettings = (p: Partial<Settings>) => api.patchSettings(p).then(setSettings).catch((e) => setNotice(e.message));

  const toggleReviewed = (f: FileEntry) => guarded(async () => setData(await api.setReviewed(scope, f.path, !f.reviewed)));

  const allReviewed = !!data && data.files.length > 0 && data.files.every((f) => f.reviewed);
  const toggleAllReviewed = () => guarded(async () => setData(await api.setAllReviewed(scope, !allReviewed)));

  const goto = (delta: number) => {
    if (ordered.length === 0) return;
    const i = ordered.findIndex((f) => f.path === selected);
    const n = i < 0 ? (delta > 0 ? 0 : ordered.length - 1) : (i + delta + ordered.length) % ordered.length;
    select(ordered[n].path);
  };
  const nextUnreviewed = (files = data?.files ?? []) => {
    const all = flatten(files);
    const i = all.findIndex((f) => f.path === selected);
    for (let k = 1; k <= all.length; k++) {
      const f = all[(i + k + all.length) % all.length];
      if (!f.reviewed && f.path !== selected) return select(f.path);
    }
    setNotice('All files are reviewed 🎉');
  };

  const spaceReview = () => {
    if (!current) return;
    guarded(async () => {
      const r = await api.setReviewed(scope, current.path, !current.reviewed);
      setData(r);
      if (!current.reviewed) nextUnreviewed(r.files);
    });
  };

  useEffect(() => {
    const skip = (e: KeyboardEvent) => /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey;
    const h = (e: KeyboardEvent) => {
      if (skip(e)) return;
      if (e.key === 'j') goto(1); else if (e.key === 'k') goto(-1);
      else if (e.key === ' ') { e.preventDefault(); if (!e.repeat && !busy) spaceReview(); }
    };
    // stop a focused button from also being clicked by the space key
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && !skip(e)) e.preventDefault(); };
    window.addEventListener('keydown', h);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('keyup', up); };
  });

  const actions: Actions = useMemo(() => {
    const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A) => { await fn(...a); await reload(); };
    return {
      create: wrap((side: string, s: number, e: number, body: string) => api.create(scope, selected!, side, s, e, body)),
      update: wrap((id: string, p: { body?: string; resolved?: boolean }) => api.update(id, p)),
      remove: wrap((id: string) => api.remove(id)),
      reply: wrap((id: string, b: string) => api.reply(id, b)),
      updateReply: wrap((id: string, r: string, b: string) => api.updateReply(id, r, b)),
      removeReply: wrap((id: string, r: string) => api.removeReply(id, r)),
    } as Actions;
  }, [api, scope, selected, reload]);

  // Discussions dialog can act on any file's discussion, so it uses path-agnostic actions.
  const globalActions: Actions = useMemo(() => ({ ...actions, create: async () => {} }), [actions]);

  if (ended) return <div className="home"><h2>Review finished</h2><p>You can close this tab. Run <code>/start-review</code> in your coding agent to review again.</p></div>;
  if (error) return <div className="home"><h2>Cannot open repository</h2><p className="error">{error}</p><p>Run <code>review</code> in the repository again.</p></div>;
  if (!data || !info || !settings) return <div className="home muted">Loading…</div>;

  const t = data.totals;
  const fileDiscussions = discussions.filter((d) => d.path === selected);

  return (
    <div className="app">
      <header className="header">
        <div className="row gap wrap">
          <strong className="repo">{info.name}</strong>
          <span className="pill" title="Current branch">⎇ {data.branch}</span>
          <span className="muted">{t.files} file{t.files === 1 ? '' : 's'} · <span className="add">+{t.additions}</span> <span className="del">−{t.deletions}</span></span>
          <span className="progress">
            <span className="bar"><span style={{ width: `${t.files ? (100 * t.reviewed) / t.files : 0}%` }} /></span>
            {t.reviewed}/{t.files} files reviewed · {t.unresolvedDiscussions} unresolved discussion{t.unresolvedDiscussions === 1 ? '' : 's'}
          </span>
          <span className="spacer" />
          <select value={scope} onChange={(e) => changeScope(e.target.value as Scope)} title="Diff scope">
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
          <div className="seg">
            <button className={settings.viewMode === 'unified' ? 'on' : ''} onClick={() => patchSettings({ viewMode: 'unified' })}>Unified</button>
            <button className={settings.viewMode === 'split' ? 'on' : ''} onClick={() => patchSettings({ viewMode: 'split' })}>Side-by-side</button>
          </div>
          <button className="btn" disabled={busy} onClick={refresh}>↻ Refresh</button>
          <button className="btn" onClick={() => setDialog('discussions')}>Discussions ({t.totalDiscussions})</button>
          <span className={`split${session ? '' : ' disabled'}`} title={!session ? '/start-review with coding agent (e.g. claude code) to enable this feature' : agentBusy ? 'Your coding agent is busy with the previous round' : undefined}>
            <button className={`btn finish${agentBusy ? ' busy' : ''}`} disabled={!session} aria-busy={agentBusy} onClick={() => { if (idle) setDialog('finish'); }}>
              {agentBusy && <span className="spinner" aria-hidden />}Finish review
            </button>
            {!agentBusy && <button className="btn finish caret" disabled={!session} aria-label="More review actions"><svg width="10" height="6" viewBox="0 0 10 6" aria-hidden><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
            {idle && <div className="split-menu"><button className="btn finish" title="Send feedback (Ctrl+Enter)" onClick={() => signal('feedback')}>Send feedback</button></div>}
          </span>
          <button className="btn" onClick={() => setDialog('settings')} title="Settings">⚙</button>
        </div>
        {notice && <div className="notice" onClick={() => setNotice('')}>{notice} <span className="muted">(click to dismiss)</span></div>}
      </header>
      <div className="body">
        <Sidebar files={visible} selected={selected} onSelect={(f) => select(f.path)} onToggleReviewed={toggleReviewed} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} />
        <main className="main">
          {!current ? (
            <div className="empty">{t.files === 0 ? 'No changes in this scope.' : 'Select a file from the sidebar to review its diff. (j / k to move between files, space to review)'}</div>
          ) : (
            <>
              <div className="file-head">
                <div className="file-title">
                  <span className={`status s-${current.status}`}>{current.status}</span>
                  <strong>{current.oldPath ? `${current.oldPath} → ${current.path}` : current.path}</strong>
                  <span className="muted"><span className="add">+{current.additions}</span> <span className="del">−{current.deletions}</span></span>
                  {diff?.sinceReview && (
                    <button className={`btn small${sinceOnly ? ' on' : ''}`} onClick={() => setSinceOnly(!sinceOnly)} title={sinceOnly ? 'Back to the full diff of this file' : 'Show only what changed since this file was marked reviewed'}>{sinceOnly ? 'Full diff' : 'Changes since review'}</button>
                  )}
                </div>
                <div className="row gap">
                  <button className="btn small" onClick={() => goto(-1)} title="Previous file (K)">← Prev</button>
                  <button className="btn small" onClick={() => goto(1)} title="Next file (J)">Next →</button>
                  <button className="btn small" onClick={() => nextUnreviewed()}>Next unreviewed ⇥</button>
                  <button className={`btn small${showAll ? ' on' : ''}`} onClick={() => setShowAll(!showAll)}>{showAll ? 'Collapse unchanged' : 'Show full file'}</button>
                  <label className="reviewed-toggle" title="Space"><input type="checkbox" checked={current.reviewed} onChange={() => toggleReviewed(current)} /> {current.reviewed ? 'Unreview' : 'Review'}</label>
                  <button className="btn small" onClick={toggleAllReviewed} title="Applies to all files in this scope">{allReviewed ? 'Unreview all' : 'Review all'}</button>
                </div>
              </div>
              {needsConfirm && current && (
                <div className="empty">
                  <p>This diff is large ({current.additions + current.deletions} changed lines). Are you sure you want to display it?</p>
                  <button className="btn" onClick={() => setConfirmedBig(true)}>Display diff</button>
                </div>
              )}
              {diffErr && <div className="error pad">{diffErr}</div>}
              {!needsConfirm && !diff && !diffErr && <div className="muted pad">Loading diff…</div>}
              {diff && <DiffView diff={diff} discussions={fileDiscussions} viewMode={settings.viewMode} contextLines={settings.contextLines} showAll={showAll} sinceOnly={sinceOnly && !!diff.sinceReview} actions={actions} />}
            </>
          )}
        </main>
      </div>
      {dialog === 'finish' && (
        <Modal title="Finish review?" onClose={() => setDialog(null)}>
          <p>Finishing the review ends the conversation with your coding agent about it, and this tab will close. To review again you will need to run <code>/start-review</code> again.</p>
          <p>If you want the agent to address your comments and keep talking, send feedback instead.</p>
          <div className="row gap" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => signal('feedback')}>Send feedback</button>
            <button className="btn finish" onClick={() => signal('finish')}>Finish review</button>
          </div>
        </Modal>
      )}
      {dialog === 'settings' && <SettingsDialog theme={theme} setTheme={setTheme} contextLines={settings.contextLines} setContextLines={(n) => patchSettings({ contextLines: n })} onClose={() => setDialog(null)} />}
      {dialog === 'discussions' && <DiscussionsDialog discussions={discussions} actions={globalActions} onOpenFile={(p) => select(p)} onClearAll={() => guarded(async () => { await api.clearAll(); await reload(); })} onClose={() => setDialog(null)} />}
    </div>
  );
}
