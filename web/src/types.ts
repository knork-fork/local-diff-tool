export type Scope = 'unstaged' | 'staged' | 'all' | 'untracked';
export type Side = 'old' | 'new';
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type ViewMode = 'unified' | 'split';

export interface FileEntry {
  path: string; oldPath: string | null; status: FileStatus; untracked: boolean; binary: boolean;
  additions: number; deletions: number; fingerprint: string;
  reviewed: boolean; discussionCount: number; unresolvedCount: number;
}
export interface Totals { files: number; additions: number; deletions: number; reviewed: number; unresolvedDiscussions: number; totalDiscussions: number }
export interface FilesResult { branch: string; scope: Scope; files: FileEntry[]; totals: Totals; refresh?: { invalidated: string[]; outdated: string[]; relocated: string[] } }
export interface RepoInfo { id: string; name: string; path: string; branch: string; hasHead: boolean; }
export interface Settings { viewMode: ViewMode; scope: Scope; contextLines: number }

export interface DiffLine { type: 'ctx' | 'add' | 'del'; oldNumber: number | null; newNumber: number | null; text: string; noEol?: boolean }
export interface Hunk { header: string; oldStart: number; newStart: number; lines: DiffLine[] }
export interface FileDiff { path: string; oldPath: string | null; status: FileStatus; untracked: boolean; binary: boolean; hunks: Hunk[] }

export interface Reply { id: string; body: string; author: string; createdAt: string; updatedAt: string }
export interface Discussion {
  id: string; path: string; side: Side; startLine: number; endLine: number; body: string; author: string;
  replies: Reply[]; resolved: boolean; outdated: boolean; reviewId: string | null; createdAt: string; updatedAt: string;
  anchor: { lines: string[] };
}
