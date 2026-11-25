import type { Discussion } from './types.js';

export interface ExportMeta { name: string; branch: string; scope: string; exportedAt: string }

const fence = (s: string) => (s.includes('```') ? '````' : '```');

export function exportMarkdown(meta: ExportMeta, discussions: Discussion[]): string {
  const out: string[] = [`# Code review: ${meta.name} (${meta.branch})`, '', `Exported ${meta.exportedAt} · ${discussions.length} discussion(s)`, ''];
  const byFile = new Map<string, Discussion[]>();
  for (const d of discussions) byFile.set(d.path, [...(byFile.get(d.path) ?? []), d]);
  for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`## ${file}`, '');
    for (const d of list.sort((a, b) => a.startLine - b.startLine)) {
      const lines = d.startLine === d.endLine ? `Line ${d.startLine}` : `Lines ${d.startLine}–${d.endLine}`;
      const tags = [d.side === 'old' ? 'old side' : 'new side', d.resolved ? 'resolved' : 'unresolved', d.outdated ? 'outdated' : ''].filter(Boolean);
      out.push(`### ${lines} (${tags.join(', ')})`, '');
      const code = d.anchor.lines.join('\n');
      out.push(fence(code) + '', code, fence(code), '');
      out.push(...d.body.split('\n').map((l) => `> ${l}`), '');
      for (const r of d.replies) out.push(`> **Reply (${r.author}):**`, ...r.body.split('\n').map((l) => `> ${l}`), '');
    }
  }
  return out.join('\n');
}
