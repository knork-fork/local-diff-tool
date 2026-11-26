import { describe, expect, it } from 'vitest';
import { flatten } from './Sidebar';
import type { FileEntry } from './types';

const f = (path: string): FileEntry => ({
  path, oldPath: null, status: 'modified', untracked: false, binary: false,
  additions: 0, deletions: 0, fingerprint: '', reviewed: false, discussionCount: 0, unresolvedCount: 0,
});

describe('flatten', () => {
  it('lists files before folders at every level', () => {
    const out = flatten(['src/a.ts', 'src/lib/x.ts', 'src/z.ts', 'docs/d.md', '.env', 'package.json'].map(f));
    expect(out.map((x) => x.path)).toEqual([
      '.env', 'package.json', 'docs/d.md', 'src/a.ts', 'src/z.ts', 'src/lib/x.ts',
    ]);
  });
});
