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

export function DiscussionsDialog({ discussions, actions, onOpenFile, onClearAll, onClose }: {
  discussions: Discussion[]; actions: Actions; onOpenFile(path: string): void; onClearAll(): Promise<void>; onClose(): void;
}) {
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const list = discussions.filter((d) => !unresolvedOnly || !d.resolved);
  const files = [...new Set(list.map((d) => d.path))].sort();
  return (
    <Modal title={`Discussions (${list.length})`} onClose={onClose} wide>
      <div className="row gap">
        <label><input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} /> Unresolved only</label>
        {discussions.length > 0 && <button className="btn small danger" onClick={() => { if (confirm(`Delete all ${discussions.length} discussion(s) on this branch? This cannot be undone.`)) onClearAll(); }}>Clear all</button>}
      </div>
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
