import type { Anchor } from './types.js';

const norm = (s: string) => s.replace(/\r$/, '').trimEnd();
const CTX = 3;
const MAX_ANCHOR_LINES = 200;

/** start/end are 1-based inclusive. */
export function makeAnchor(lines: string[], start: number, end: number): Anchor {
  const block = lines.slice(start - 1, Math.min(end, start - 1 + MAX_ANCHOR_LINES));
  return {
    lines: block,
    before: lines.slice(Math.max(0, start - 1 - CTX), start - 1),
    after: lines.slice(end, end + CTX),
  };
}

export interface Relocation { found: boolean; start: number; end: number }

export function relocate(lines: string[] | null, anchor: Anchor, start: number, end: number): Relocation {
  const miss = { found: false, start, end };
  if (!lines || anchor.lines.length === 0) return miss;
  const block = anchor.lines.map(norm);
  const n = block.length;
  const hay = lines.map(norm);
  const matchesAt = (i: number) => {
    if (i < 0 || i + n > hay.length) return false;
    for (let k = 0; k < n; k++) if (hay[i + k] !== block[k]) return false;
    return true;
  };
  const origIdx = start - 1;
  if (matchesAt(origIdx)) return { found: true, start, end: start + n - 1 };

  const candidates: number[] = [];
  for (let i = 0; i + n <= hay.length; i++) if (matchesAt(i)) candidates.push(i);
  if (candidates.length === 0) return miss;

  const before = anchor.before.map(norm);
  const after = anchor.after.map(norm);
  const score = (i: number) => {
    let s = 0;
    for (let k = 1; k <= before.length; k++) {
      if (hay[i - k] === before[before.length - k]) s++; else break;
    }
    for (let k = 0; k < after.length; k++) {
      if (hay[i + n + k] === after[k]) s++; else break;
    }
    return s;
  };
  const ranked = candidates
    .map((i) => ({ i, s: score(i), d: Math.abs(i - origIdx) }))
    .sort((a, b) => b.s - a.s || a.d - b.d);
  if (ranked.length > 1 && ranked[0].s === ranked[1].s && ranked[0].s === 0) return miss; // ambiguous
  if (ranked.length > 1 && ranked[0].s === ranked[1].s && ranked[0].d === ranked[1].d) return miss;
  const best = ranked[0].i;
  return { found: true, start: best + 1, end: best + n };
}
