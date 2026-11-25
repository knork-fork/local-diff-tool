import { useState } from 'react';
import { Markdown } from './markdown';
import type { Discussion } from './types';

export interface Actions {
  create(side: string, start: number, end: number, body: string): Promise<void>;
  update(id: string, patch: { body?: string; resolved?: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  reply(id: string, body: string): Promise<void>;
  updateReply(id: string, rid: string, body: string): Promise<void>;
  removeReply(id: string, rid: string): Promise<void>;
}

const when = (s: string) => new Date(s).toLocaleString();

export function CommentForm({ initial = '', submitLabel, onSubmit, onCancel, autoFocus = true }: {
  initial?: string; submitLabel: string; onSubmit: (body: string) => Promise<void>; onCancel: () => void; autoFocus?: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true); setErr('');
    try { await onSubmit(body); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="comment-form">
      <textarea
        autoFocus={autoFocus} value={body} placeholder="Write a comment… (Markdown supported, Ctrl+Enter to submit)"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); if (e.key === 'Escape') onCancel(); }}
      />
      {err && <div className="error small">{err}</div>}
      <div className="row gap">
        <button className="btn primary" disabled={busy || !body.trim()} onClick={submit}>{submitLabel}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function Thread({ d, actions, showPath }: { d: Discussion; actions: Actions; showPath?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null); // 'root' or reply id
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => { setError(''); try { await fn(); } catch (e: any) { setError(e.message); } };
  const lines = d.startLine === d.endLine ? `line ${d.startLine}` : `lines ${d.startLine}–${d.endLine}`;
  return (
    <div className={`thread${d.resolved ? ' resolved' : ''}${d.outdated ? ' outdated' : ''}`}>
      <div className="thread-head">
        {showPath && <span className="thread-path">{d.path}</span>}
        <span className="muted">{lines} · {d.side} side</span>
        {d.outdated && <span className="badge warn" title="The commented code changed or was removed">Outdated</span>}
        {d.resolved && <span className="badge ok">Resolved</span>}
        <span className={`badge ${d.reviewId ? 'info' : ''}`}>{d.reviewId ? 'Submitted' : 'Pending'}</span>
      </div>
      {(d.outdated || showPath) && d.anchor.lines.length > 0 && (
        <pre className="anchor-code">{d.anchor.lines.slice(0, 8).join('\n')}</pre>
      )}
      <Entry
        author={d.author} time={d.createdAt} body={d.body} editing={editing === 'root'}
        onEdit={() => setEditing('root')} onCancel={() => setEditing(null)}
        onSave={async (b) => { await actions.update(d.id, { body: b }); setEditing(null); }}
        onDelete={() => { if (confirm('Delete this discussion and all its replies?')) run(() => actions.remove(d.id)); }}
      />
      {d.replies.map((r) => (
        <Entry
          key={r.id} author={r.author} time={r.createdAt} body={r.body} reply editing={editing === r.id}
          onEdit={() => setEditing(r.id)} onCancel={() => setEditing(null)}
          onSave={async (b) => { await actions.updateReply(d.id, r.id, b); setEditing(null); }}
          onDelete={() => { if (confirm('Delete this reply?')) run(() => actions.removeReply(d.id, r.id)); }}
        />
      ))}
      {error && <div className="error small">{error}</div>}
      <div className="thread-foot row gap">
        {replying ? (
          <CommentForm submitLabel="Reply" onCancel={() => setReplying(false)} onSubmit={async (b) => { await actions.reply(d.id, b); setReplying(false); }} />
        ) : (
          <>
            <button className="btn small" onClick={() => setReplying(true)}>Reply</button>
            <button className="btn small" onClick={() => run(() => actions.update(d.id, { resolved: !d.resolved }))}>
              {d.resolved ? 'Reopen discussion' : 'Resolve discussion'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Entry({ author, time, body, reply, editing, onEdit, onCancel, onSave, onDelete }: {
  author: string; time: string; body: string; reply?: boolean; editing: boolean;
  onEdit(): void; onCancel(): void; onSave(b: string): Promise<void>; onDelete(): void;
}) {
  return (
    <div className={`entry${reply ? ' reply' : ''}`}>
      <div className="entry-head">
        <strong>{author}</strong> <span className="muted">{when(time)}</span>
        {!editing && (
          <span className="entry-actions">
            <button className="link" onClick={onEdit}>Edit</button>
            <button className="link danger" onClick={onDelete}>Delete</button>
          </span>
        )}
      </div>
      {editing ? <CommentForm initial={body} submitLabel="Save" onSubmit={onSave} onCancel={onCancel} /> : <Markdown text={body} />}
    </div>
  );
}
