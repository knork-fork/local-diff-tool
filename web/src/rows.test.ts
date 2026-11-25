import { describe, expect, it } from 'vitest';
import { collapse, splitRows } from './rows';
import type { Hunk } from './types';

describe('collapse', () => {
  const rows = Array.from({ length: 30 }, (_, i) => i);
  it('collapses far rows and expands per gap', () => {
    const items = collapse(rows, (r) => r === 15, 3, {}, false);
    expect(items.filter((i) => i.kind === 'row')).toHaveLength(7);
    const gaps = items.filter((i) => i.kind === 'gap');
    expect(gaps).toHaveLength(2);
    const more = collapse(rows, (r) => r === 15, 3, { 0: { top: 0, bottom: 5 } }, false);
    expect(more.filter((i) => i.kind === 'row')).toHaveLength(12);
  });
  it('shows everything when showAll', () => {
    expect(collapse(rows, (r) => r === 15, 3, {}, true)).toHaveLength(30);
  });
});

describe('splitRows', () => {
  it('pairs deletions and additions', () => {
    const h: Hunk = { header: '', oldStart: 1, newStart: 1, lines: [
      { type: 'ctx', oldNumber: 1, newNumber: 1, text: 'a' },
      { type: 'del', oldNumber: 2, newNumber: null, text: 'b' },
      { type: 'add', oldNumber: null, newNumber: 2, text: 'c' },
      { type: 'add', oldNumber: null, newNumber: 3, text: 'd' },
    ] };
    const r = splitRows([h]);
    expect(r).toHaveLength(3);
    expect(r[1].left?.text).toBe('b');
    expect(r[2].left).toBeNull();
  });
});
