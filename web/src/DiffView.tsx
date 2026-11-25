import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { highlight, type Tok } from './highlight';
import { collapse, splitRows, unifiedRows, type Expansion, type SRow } from './rows';
import { CommentForm, Thread, type Actions } from './Thread';
import type { DiffLine, Discussion, FileDiff, Side, ViewMode } from './types';

const STEP = 20;
type Sel = { side: Side; start: number; end: number };
type Drag = { side: Side; anchor: number; current: number };

function Code({ text, toks }: { text: string; toks?: Tok[] }) {
  if (!toks) return <>{text || ' '}</>;
  return <>{toks.map((t, i) => <span key={i} style={t.style}>{t.content}</span>)}{toks.length === 0 && ' '}</>;
}

export function DiffView({ diff, discussions, viewMode, contextLines, showAll, actions }: {
  diff: FileDiff; discussions: Discussion[]; viewMode: ViewMode; contextLines: number; showAll: boolean; actions: Actions;
}) {
  const [expansion, setExpansion] = useState<Expansion>({});
  const [form, setForm] = useState<Sel | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [oldToks, setOldToks] = useState<Tok[][] | null>(null);
  const [newToks, setNewToks] = useState<Tok[][] | null>(null);

  useEffect(() => { setExpansion({}); setForm(null); }, [diff.path, diff.hunks]);

  // Hunks carry the whole file, so both sides can be reconstructed and highlighted as whole files.
  useEffect(() => {
    let live = true;
    const oldL: string[] = []; const newL: string[] = [];
    for (const h of diff.hunks) for (const l of h.lines) {
      if (l.oldNumber != null) oldL[l.oldNumber - 1] = l.text;
      if (l.newNumber != null) newL[l.newNumber - 1] = l.text;
    }
    setOldToks(null); setNewToks(null);
    highlight(Array.from(oldL, (x) => x ?? ''), diff.oldPath ?? diff.path).then((t) => live && setOldToks(t));
    highlight(Array.from(newL, (x) => x ?? ''), diff.path).then((t) => live && setNewToks(t));
    return () => { live = false; };
  }, [diff]);

  useEffect(() => {
    if (!drag) return;
    const up = () => { setForm({ side: drag.side, start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) }); setDrag(null); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [drag]);

  const placed = useMemo(() => discussions.filter((d) => !d.outdated), [discussions]);
  const threadsByKey = useMemo(() => {
    const m = new Map<string, Discussion[]>();
    for (const d of placed) m.set(`${d.side}:${d.endLine}`, [...(m.get(`${d.side}:${d.endLine}`) ?? []), d]);
    return m;
  }, [placed]);

  const uRows = useMemo(() => unifiedRows(diff.hunks), [diff]);
  const sRows = useMemo(() => splitRows(diff.hunks), [diff]);
  const keysU = (r: DiffLine) => [r.type !== 'add' && r.oldNumber != null ? `old:${r.oldNumber}` : '', r.type !== 'del' && r.newNumber != null ? `new:${r.newNumber}` : ''].filter(Boolean);
  const keysS = (r: SRow) => [r.left ? `old:${r.left.num}` : '', r.right ? `new:${r.right.num}` : ''].filter(Boolean);
  const hasThread = (keys: string[]) => keys.some((k) => threadsByKey.has(k) || (form && k === `${form.side}:${form.end}`));

  const allKeys = useMemo(() => new Set(uRows.flatMap((r) => keysU(r))), [uRows]);
  const unplaced = discussions.filter((d) => d.outdated || !allKeys.has(`${d.side}:${d.endLine}`));

  const inSel = (side: Side, n: number | null | undefined) => {
    if (n == null) return false;
    const s = drag ? { side: drag.side, start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) } : form;
    return !!s && s.side === side && n >= s.start && n <= s.end;
  };

  const numCell = (side: Side, n: number | null | undefined, cls: string, canComment: boolean) => (
    <td
      className={`num ${cls}`}
      onMouseEnter={() => { if (drag && drag.side === side && n != null) setDrag({ ...drag, current: n }); }}
    >
      {canComment && n != null && (
        <button className="add-comment" title="Add a comment (drag to select multiple lines)"
          onMouseDown={(e) => { e.preventDefault(); setDrag({ side, anchor: n, current: n }); }}>+</button>
      )}
      {n ?? ''}
    </td>
  );

  const threadBlock = (keys: string[], side?: Side): ReactNode => {
    const ds = keys.filter((k) => !side || k.startsWith(side)).flatMap((k) => threadsByKey.get(k) ?? []);
    const f = form && keys.includes(`${form.side}:${form.end}`) && (!side || form.side === side) ? form : null;
    if (ds.length === 0 && !f) return null;
    return (
      <div className="threads">
        {ds.map((d) => <Thread key={d.id} d={d} actions={actions} />)}
        {f && (
          <div className="thread new">
            <CommentForm submitLabel="Add comment to review" onCancel={() => setForm(null)}
              onSubmit={async (b) => { await actions.create(f.side, f.start, f.end, b); setForm(null); }} />
          </div>
        )}
      </div>
    );
  };

  const gapRow = (g: { id: number; count: number; canUp: boolean; canDown: boolean }, cols: number) => {
    const bump = (k: 'top' | 'bottom') => setExpansion((e) => {
      const cur = e[g.id] ?? { top: 0, bottom: 0 };
      return { ...e, [g.id]: { ...cur, [k]: cur[k] + STEP } };
    });
    const all = () => setExpansion((e) => ({ ...e, [g.id]: { top: 1e9, bottom: 0 } }));
    return (
      <tr key={`gap${g.id}-${g.count}`} className="gap">
        <td colSpan={cols}>
          <span className="gap-actions">
            {g.canUp && <button className="link" onClick={() => bump('top')}>↓ Expand {Math.min(STEP, g.count)}</button>}
            {g.canDown && <button className="link" onClick={() => bump('bottom')}>↑ Expand {Math.min(STEP, g.count)}</button>}
            <button className="link" onClick={all}>Show all {g.count} unchanged lines</button>
          </span>
        </td>
      </tr>
    );
  };

  const uItems = useMemo(() => viewMode === 'unified' ? collapse(uRows, (r) => r.type !== 'ctx' || hasThread(keysU(r)), contextLines, expansion, showAll) : [], [viewMode, uRows, contextLines, expansion, showAll, threadsByKey, form]);
  const sItems = useMemo(() => viewMode === 'split' ? collapse(sRows, (r) => r.left?.type === 'del' || r.right?.type === 'add' || hasThread(keysS(r)), contextLines, expansion, showAll) : [], [viewMode, sRows, contextLines, expansion, showAll, threadsByKey, form]);

  if (diff.binary) {
    return <div className="binary-note">Binary file — {diff.status}. A textual diff is not available.</div>;
  }
  if (diff.hunks.length === 0) {
    return <div className="binary-note">No textual changes (mode or metadata change only).</div>;
  }

  return (
    <div className="diff-wrap">
      {unplaced.length > 0 && (
        <div className="unplaced">
          <div className="unplaced-title">Discussions not attached to current code ({unplaced.length})</div>
          {unplaced.map((d) => <Thread key={d.id} d={d} actions={actions} />)}
        </div>
      )}
      <div className="diff-scroll">
        {viewMode === 'unified' ? (
          <table className="diff unified">
            <colgroup><col className="c-num" /><col className="c-num" /><col /></colgroup>
            <tbody>
              {uItems.map((it) => {
                if (it.kind === 'gap') return gapRow(it, 3);
                const r = it.row;
                const sel = inSel('old', r.type !== 'add' ? r.oldNumber : null) && r.type === 'del' || inSel('new', r.type !== 'del' ? r.newNumber : null);
                const toks = r.type === 'del' ? oldToks?.[r.oldNumber! - 1] : newToks?.[r.newNumber! - 1];
                return (
                  <Fragment key={it.index}>
                    <tr className={`line ${r.type}${sel ? ' selected' : ''}`}>
                      {numCell('old', r.oldNumber, 'old', r.type === 'del')}
                      {numCell('new', r.newNumber, 'new', r.type !== 'del')}
                      <td className="code"><span className="sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span><Code text={r.text} toks={toks} />{r.noEol && <span className="noeol"> ⏎̸</span>}</td>
                    </tr>
                    {hasThread(keysU(r)) && <tr className="thread-row"><td colSpan={3}>{threadBlock(keysU(r))}</td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="diff split">
            <colgroup><col className="c-num" /><col className="c-half" /><col className="c-num" /><col className="c-half" /></colgroup>
            <tbody>
              {sItems.map((it) => {
                if (it.kind === 'gap') return gapRow(it, 4);
                const { left: l, right: r } = it.row;
                const keys = keysS(it.row);
                const lt = l ? oldToks?.[l.num - 1] : undefined;
                const rt = r ? newToks?.[r.num - 1] : undefined;
                return (
                  <Fragment key={it.index}>
                    <tr className="line">
                      {numCell('old', l?.num, `${l?.type ?? 'empty'}`, !!l)}
                      <td className={`code ${l?.type ?? 'empty'}${inSel('old', l?.num) ? ' selected' : ''}`}>{l && <><span className="sign">{l.type === 'del' ? '−' : ' '}</span><Code text={l.text} toks={lt} /></>}</td>
                      {numCell('new', r?.num, `${r?.type ?? 'empty'}`, !!r)}
                      <td className={`code ${r?.type ?? 'empty'}${inSel('new', r?.num) ? ' selected' : ''}`}>{r && <><span className="sign">{r.type === 'add' ? '+' : ' '}</span><Code text={r.text} toks={rt} /></>}</td>
                    </tr>
                    {hasThread(keys) && (
                      <tr className="thread-row">
                        <td colSpan={2}>{threadBlock(keys, 'old')}</td>
                        <td colSpan={2}>{threadBlock(keys, 'new')}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
