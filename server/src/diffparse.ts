export type LineType = 'ctx' | 'add' | 'del';
export interface DiffLine {
  type: LineType;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
  noEol?: boolean;
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
