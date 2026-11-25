export type Scope = 'unstaged' | 'staged' | 'all' | 'untracked';
export const SCOPES: Scope[] = ['unstaged', 'staged', 'all', 'untracked'];
export type Side = 'old' | 'new';
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  untracked: boolean;
  binary: boolean;
  additions: number;
  deletions: number;
  fingerprint: string;
}

export interface Anchor {
  lines: string[];
  before: string[];
  after: string[];
}

export interface Reply {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface Discussion {
  id: string;
  branch: string;
  scope: Scope;
  path: string;
  side: Side;
  startLine: number;
  endLine: number;
  originalStartLine: number;
  originalEndLine: number;
  anchor: Anchor;
  fingerprint: string;
  body: string;
  author: string;
  replies: Reply[];
  resolved: boolean;
  resolvedAt: string | null;
  outdated: boolean;
  reviewId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  branch: string;
  scope: Scope;
  summary: string;
  discussionIds: string[];
  createdAt: string;
}

export interface Settings {
  viewMode: 'unified' | 'split';
  scope: Scope;
  contextLines: number;
}

export interface ReviewedEntry {
  fingerprint: string;
  reviewedAt: string;
}

export interface ReviewData {
  schemaVersion: number;
  revision: number;
  repoPath?: string;
  reviewedFiles: Record<string, Record<string, ReviewedEntry>>; // scopeKey -> path -> entry
  discussions: Discussion[];
  reviews: Review[];
  settings: Settings;
  createdAt: string;
  updatedAt: string;
}

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}
