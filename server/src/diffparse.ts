export type LineType = 'ctx' | 'add' | 'del';
export interface DiffLine {
  type: LineType;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
  noEol?: boolean;
  isNew?: boolean;
  /** Changed lines of the cached baseline that are gone now, shown just before / after this line. */
  removedBefore?: { type: 'add' | 'del'; text: string }[];
  removedAfter?: { type: 'add' | 'del'; text: string }[];
}
export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}
export interface ParsedPatch {
  binary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  oldPath: string | null;
  newPath: string | null;
  hunks: Hunk[];
}

/** Splits a multi-file `git diff` output into one string per file. */
export function splitPatches(text: string): string[] {
  return text.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function isBinaryPatch(text: string): boolean {
  return /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text);
}

export function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (!inHunk) {
      if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

export function parsePatch(text: string): ParsedPatch {
  const lines = text.split('\n');
  const res: ParsedPatch = {
    binary: isBinaryPatch(text), isNew: false, isDeleted: false, isRename: false,
    oldPath: null, newPath: null, hunks: [],
  };
  let i = 0;
  for (; i < lines.length && !lines[i].startsWith('@@'); i++) {
    const l = lines[i];
    if (l.startsWith('new file mode')) res.isNew = true;
    else if (l.startsWith('deleted file mode')) res.isDeleted = true;
    else if (l.startsWith('rename from ')) { res.isRename = true; res.oldPath = l.slice(12); }
    else if (l.startsWith('rename to ')) res.newPath = l.slice(10);
  }
  while (i < lines.length) {
    const m = HUNK.exec(lines[i]);
    if (!m) { i++; continue; }
    const hunk: Hunk = {
      header: m[5] ?? '',
      oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2],
      newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4],
      lines: [],
    };
    let o = hunk.oldStart;
    let n = hunk.newStart;
    let ro = hunk.oldLines;
    let rn = hunk.newLines;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith('\\')) {
        const prev = hunk.lines[hunk.lines.length - 1];
        if (prev) prev.noEol = true;
        i++;
        continue;
      }
      if (ro <= 0 && rn <= 0) break;
      const c = l[0];
      if (c === '+') { hunk.lines.push({ type: 'add', oldNumber: null, newNumber: n++, text: l.slice(1) }); rn--; }
      else if (c === '-') { hunk.lines.push({ type: 'del', oldNumber: o++, newNumber: null, text: l.slice(1) }); ro--; }
      else if (c === ' ' || l === '') { hunk.lines.push({ type: 'ctx', oldNumber: o++, newNumber: n++, text: l.slice(1) }); ro--; rn--; }
      else break;
      i++;
    }
    res.hunks.push(hunk);
  }
  return res;
}

const MAX_CELLS = 4_000_000;

/**
 * Compares the current patch with the cached baseline: marks changed lines that are not in the baseline (`isNew`)
 * and attaches changed baseline lines that no longer exist (`removedBefore` / `removedAfter`) at their position.
 */
export function markNewLines(current: Hunk[], cachedPatch: string): void {
  const seen = new Map<string, number>();
  const cachedLines = parsePatch(cachedPatch).hunks.flatMap((h) => h.lines);
  for (const l of cachedLines) {
    if (l.type === 'ctx') continue;
    const k = l.type + l.text;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const cur = current.flatMap((h) => h.lines);
  for (const l of cur) {
    if (l.type === 'ctx') continue;
    const k = l.type + l.text;
    const n = seen.get(k) ?? 0;
    if (n > 0) seen.set(k, n - 1); else l.isNew = true;
  }
  // Removed lines: align the two full-context sequences (trim common ends, LCS on the middle).
  const key = (l: DiffLine) => l.type + l.text;
  const a = cachedLines.map(key); const b = cur.map(key);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf; const m = b.length - pre - suf;
  if (n === 0 || (n + 1) * (m + 1) > MAX_CELLS) return;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i * w + j] = a[pre + i] === b[pre + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  }
  let i = 0; let j = 0;
  const ghost = (l: DiffLine, at: number) => {
    if (l.type === 'ctx') return;
    const g = { type: l.type, text: l.text };
    const target = cur[at];
    if (target) (target.removedBefore ??= []).push(g);
    else if (cur.length) (cur[cur.length - 1].removedAfter ??= []).push(g);
  };
  while (i < n && j < m) {
    if (a[pre + i] === b[pre + j]) { i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ghost(cachedLines[pre + i], pre + j); i++; }
    else j++;
  }
  while (i < n) { ghost(cachedLines[pre + i], pre + j); i++; }
}
