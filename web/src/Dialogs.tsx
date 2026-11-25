import { useEffect, useState, type ReactNode } from 'react';
import type { Api } from './api';
import { Thread, type Actions } from './Thread';
import type { Discussion, Scope } from './types';

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><strong>{title}</strong><button className="link" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ExportDialog({ api, onClose, reviewId }: { api: Api; onClose(): void; reviewId?: string }) {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
  const [include, setInclude] = useState('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.export({ format, include, unresolvedOnly, reviewId }).then((t) => setText(format === 'json' ? JSON.stringify(JSON.parse(t), null, 2) : t)).catch((e) => setText(e.message));
  }, [api, format, include, unresolvedOnly, reviewId]);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setMsg('Copied!'); } catch { setMsg('Copy failed — select the text manually'); } };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `review.${format === 'json' ? 'json' : 'md'}`;
    a.click();
  };
  return (
    <Modal title="Export review comments" onClose={onClose} wide>
      <div className="row gap wrap">
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}><option value="markdown">Markdown</option><option value="json">JSON</option></select>
        <select value={include} onChange={(e) => setInclude(e.target.value)} disabled={!!reviewId}>
          <option value="all">Pending + submitted</option><option value="pending">Pending only</option><option value="submitted">Submitted only</option>
        </select>
        <label><input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} /> Unresolved only</label>
        <span className="spacer" />
        <button className="btn primary" onClick={copy}>Copy to clipboard</button>
        <button className="btn" onClick={download}>Download</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <pre className="export-text">{text}</pre>
    </Modal>
  );
}

export function SubmitDialog({ api, scope, pending, onClose, onDone }: { api: Api; scope: Scope; pending: number; onClose(): void; onDone(reviewId: string): void }) {
  const [summary, setSummary] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    try { const r = await api.submit(scope, summary); onDone(r.id); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="Submit review" onClose={onClose}>
      <p>{pending} pending unresolved discussion{pending === 1 ? '' : 's'} will be submitted as a batch and become available through the API. Nothing is staged, committed or pushed.</p>
      <textarea className="full" rows={4} placeholder="Optional summary…" value={summary} onChange={(e) => setSummary(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <div className="row gap"><button className="btn primary" onClick={submit}>Submit review</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

export function SettingsDialog({ theme, setTheme, contextLines, setContextLines, onClose }: {
  theme: string; setTheme(t: string): void; contextLines: number; setContextLines(n: number): void; onClose(): void;
}) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <label className="field">Theme
        <select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      </label>
      <label className="field">Context lines around changes
        <input type="number" min={0} max={50} value={contextLines} onChange={(e) => setContextLines(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} />
      </label>
      <p className="muted small">Theme is stored in this browser. Context lines are stored with the review data in the app's data/ folder.</p>
    </Modal>
  );
}

export function DiscussionsDialog({ discussions, actions, onOpenFile, onClose }: {
  discussions: Discussion[]; actions: Actions; onOpenFile(path: string): void; onClose(): void;
}) {
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const list = discussions.filter((d) => !unresolvedOnly || !d.resolved);
  const files = [...new Set(list.map((d) => d.path))].sort();
  return (
    <Modal title={`Discussions (${list.length})`} onClose={onClose} wide>
      <label><input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} /> Unresolved only</label>
      {list.length === 0 && <p className="muted">No discussions.</p>}
      {files.map((f) => (
        <div key={f} className="disc-file">
          <div className="row gap"><strong>{f}</strong><button className="link" onClick={() => { onOpenFile(f); onClose(); }}>Open file</button></div>
          {list.filter((d) => d.path === f).map((d) => <Thread key={d.id} d={d} actions={actions} />)}
        </div>
      ))}
    </Modal>
  );
}
