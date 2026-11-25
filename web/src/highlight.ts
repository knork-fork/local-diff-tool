import { bundledLanguages, codeToTokens } from 'shiki';

export interface Tok { content: string; style?: Record<string, string> }

const SPECIAL: Record<string, string> = { dockerfile: 'docker', makefile: 'make', cmakelists: 'cmake' };

function langFor(path: string): string | null {
  const name = path.split('/').pop()!.toLowerCase();
  if (SPECIAL[name]) return SPECIAL[name];
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return ext && ext in bundledLanguages ? ext : null;
}

export async function highlight(lines: string[], path: string): Promise<Tok[][] | null> {
  const lang = langFor(path);
  if (!lang || lines.length === 0 || lines.length > 20000) return null;
  try {
    const res = await codeToTokens(lines.join('\n'), {
      lang: lang as any, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false,
    });
    return res.tokens.map((l) => l.map((t) => ({ content: t.content, style: t.htmlStyle as Record<string, string> | undefined })));
  } catch {
    return null;
  }
}
