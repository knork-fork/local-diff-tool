import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

// Raw HTML is shown as literal text (e.g. `<id> <text>` in a comment), not parsed.
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
marked.use({ renderer: { html: ({ text }: { text: string }) => esc(text) } });

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { breaks: true, async: false }) as string), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
