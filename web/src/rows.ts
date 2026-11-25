import type { DiffLine, Hunk } from './types';

export interface Cell { num: number; text: string; type: 'ctx' | 'add' | 'del' }
export interface SRow { left: Cell | null; right: Cell | null }

export const unifiedRows = (hunks: Hunk[]): DiffLine[] => hunks.flatMap((h) => h.lines);

export function splitRows(hunks: Hunk[]): SRow[] {
  const rows: SRow[] = [];
  for (const h of hunks) {
    let dels: DiffLine[] = [];
    let adds: DiffLine[] = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        const d = dels[i]; const a = adds[i];
        rows.push({
          left: d ? { num: d.oldNumber!, text: d.text, type: 'del' } : null,
          right: a ? { num: a.newNumber!, text: a.text, type: 'add' } : null,
        });
      }
      dels = []; adds = [];
    };
    for (const l of h.lines) {
      if (l.type === 'del') dels.push(l);
      else if (l.type === 'add') adds.push(l);
      else {
        flush();
        rows.push({ left: { num: l.oldNumber!, text: l.text, type: 'ctx' }, right: { num: l.newNumber!, text: l.text, type: 'ctx' } });
      }
    }
    flush();
  }
  return rows;
}

export type Item<T> =
  | { kind: 'row'; row: T; index: number }
  | { kind: 'gap'; id: number; count: number; canUp: boolean; canDown: boolean };

export type Expansion = Record<number, { top: number; bottom: number }>;

/** Collapses runs of rows not near a "kept" row into gap items, honouring per-gap expansion. */
export function collapse<T>(rows: T[], keep: (r: T) => boolean, ctx: number, expansion: Expansion, showAll: boolean): Item<T>[] {
  const marked = new Array<boolean>(rows.length).fill(false);
  let any = false;
  rows.forEach((r, i) => {
    if (!keep(r)) return;
    any = true;
    for (let k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) marked[k] = true;
  });
  const items: Item<T>[] = [];
  if (showAll || !any) return rows.map((row, index) => ({ kind: 'row', row, index }));
  let i = 0;
  while (i < rows.length) {
    if (marked[i]) { items.push({ kind: 'row', row: rows[i], index: i }); i++; continue; }
    const a = i;
    while (i < rows.length && !marked[i]) i++;
    const b = i - 1;
    const len = b - a + 1;
    const { top, bottom } = expansion[a] ?? { top: 0, bottom: 0 };
    if (top + bottom >= len) {
      for (let k = a; k <= b; k++) items.push({ kind: 'row', row: rows[k], index: k });
      continue;
    }
    for (let k = a; k < a + top; k++) items.push({ kind: 'row', row: rows[k], index: k });
    items.push({ kind: 'gap', id: a, count: len - top - bottom, canUp: a > 0, canDown: b < rows.length - 1 });
    for (let k = b - bottom + 1; k <= b; k++) items.push({ kind: 'row', row: rows[k], index: k });
  }
  return items;
}
