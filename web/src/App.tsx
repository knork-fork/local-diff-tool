import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, listRepos, makeApi } from './api';
import { DiffView } from './DiffView';
import { DiscussionsDialog, SettingsDialog } from './Dialogs';
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
      <p>Run <code>review</code> inside a git repository to open it here.</p>
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
  const [dialog, setDialog] = useState<null | 'settings' | 'discussions'>(null);
  const [busy, setBusy] = useState(false);

  const scope = settings?.scope ?? 'all';

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

  const goto = (delta: number) => {
    if (ordered.length === 0) return;
    const i = ordered.findIndex((f) => f.path === selected);
    const n = i < 0 ? (delta > 0 ? 0 : ordered.length - 1) : (i + delta + ordered.length) % ordered.length;
    select(ordered[n].path);
  };
  const nextUnreviewed = () => {
    const all = flatten(data?.files ?? []);
    const i = all.findIndex((f) => f.path === selected);
    for (let k = 1; k <= all.length; k++) {
      const f = all[(i + k + all.length) % all.length];
      if (!f.reviewed && f.path !== selected) return select(f.path);
    }
    setNotice('All files are reviewed 🎉');
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'j') goto(1); else if (e.key === 'k') goto(-1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
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
          <button className="btn" onClick={() => setDialog('settings')} title="Settings">⚙</button>
        </div>
        {notice && <div className="notice" onClick={() => setNotice('')}>{notice} <span className="muted">(click to dismiss)</span></div>}
      </header>
      <div className="body">
        <Sidebar files={visible} selected={selected} onSelect={(f) => select(f.path)} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} />
        <main className="main">
          {!current ? (
            <div className="empty">{t.files === 0 ? 'No changes in this scope.' : 'Select a file from the sidebar to review its diff. (j / k to move between files)'}</div>
          ) : (
            <>
              <div className="file-head">
                <div className="file-title">
                  <span className={`status s-${current.status}`}>{current.status}</span>
                  <strong>{current.oldPath ? `${current.oldPath} → ${current.path}` : current.path}</strong>
                  <span className="muted"><span className="add">+{current.additions}</span> <span className="del">−{current.deletions}</span></span>
                </div>
                <div className="row gap">
                  <button className="btn small" onClick={() => goto(-1)}>← Prev</button>
                  <button className="btn small" onClick={() => goto(1)}>Next →</button>
                  <button className="btn small" onClick={nextUnreviewed}>Next unreviewed ⇥</button>
                  <button className={`btn small${showAll ? ' on' : ''}`} onClick={() => setShowAll(!showAll)}>{showAll ? 'Collapse unchanged' : 'Show full file'}</button>
                  <label className="reviewed-toggle"><input type="checkbox" checked={current.reviewed} onChange={() => toggleReviewed(current)} /> {current.reviewed ? 'Unreview' : 'Review'}</label>
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
              {diff && <DiffView diff={diff} discussions={fileDiscussions} viewMode={settings.viewMode} contextLines={settings.contextLines} showAll={showAll} actions={actions} />}
            </>
          )}
        </main>
      </div>
      {dialog === 'settings' && <SettingsDialog theme={theme} setTheme={setTheme} contextLines={settings.contextLines} setContextLines={(n) => patchSettings({ contextLines: n })} onClose={() => setDialog(null)} />}
      {dialog === 'discussions' && <DiscussionsDialog discussions={discussions} actions={globalActions} onOpenFile={(p) => select(p)} onClose={() => setDialog(null)} />}
    </div>
  );
}
