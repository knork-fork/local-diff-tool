import { useMemo, useState } from 'react';
import type { FileEntry } from './types';

interface TNode { name: string; path: string; children: TNode[]; file?: FileEntry }

function build(files: FileEntry[]): TNode {
  const root: TNode = { name: '', path: '', children: [] };
  for (const f of files) {
    let cur = root;
    const parts = f.path.split('/');
    parts.forEach((p, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let n = cur.children.find((c) => c.path === path);
      if (!n) { n = { name: p, path, children: [] }; cur.children.push(n); }
      if (i === parts.length - 1) n.file = f;
      cur = n;
    });
  }
  const tidy = (n: TNode): TNode => {
    n.children = n.children.map(tidy).sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    // GitLab-style compression of single-child directory chains
    while (!n.file && n.path && n.children.length === 1 && !n.children[0].file) {
      const c = n.children[0];
      n = { ...c, name: `${n.name}/${c.name}` };
    }
    return n;
  };
  root.children = root.children.map(tidy).sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
  return root;
}

export function flatten(files: FileEntry[]): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (n: TNode) => { if (n.file) out.push(n.file); n.children.forEach(walk); };
  walk(build(files));
  return out;
}

export type ReviewFilter = 'all' | 'unreviewed' | 'reviewed';
const STATUS = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' } as const;

export function Sidebar({ files, selected, onSelect, filter, setFilter, query, setQuery }: {
  files: FileEntry[]; selected: string | null; onSelect(f: FileEntry): void;
  filter: ReviewFilter; setFilter(f: ReviewFilter): void; query: string; setQuery(q: string): void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => build(files), [files]);
  const toggle = (p: string) => setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const render = (n: TNode, depth: number): React.ReactNode => {
    const pad = { paddingLeft: 8 + depth * 14 };
    if (n.file) {
      const f = n.file;
      return (
        <div key={n.path} className={`tree-file${selected === f.path ? ' selected' : ''}`} style={pad} onClick={() => onSelect(f)} title={f.path}>
          <span className={`status s-${f.status}`}>{STATUS[f.status]}</span>
          <span className="fname">{n.name}</span>
          {f.unresolvedCount > 0 && <span className="badge warn" title="Unresolved discussions">{f.unresolvedCount}</span>}
          <span className="counts"><span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span></span>
          <span className={`check${f.reviewed ? ' on' : ''}`} title={f.reviewed ? 'Reviewed' : 'Not reviewed'}>{f.reviewed ? '✓' : '○'}</span>
        </div>
      );
    }
    const open = !collapsed.has(n.path);
    return (
      <div key={n.path}>
        <div className="tree-dir" style={pad} onClick={() => toggle(n.path)}>
          <span className="caret">{open ? '▾' : '▸'}</span> {n.name}
        </div>
        {open && n.children.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-tools">
        <input placeholder="Filter files…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as ReviewFilter)}>
          <option value="all">All</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option>
        </select>
      </div>
      <div className="tree">
        {files.length === 0 ? <div className="muted pad">No files</div> : tree.children.map((c) => render(c, 0))}
      </div>
    </aside>
  );
}
