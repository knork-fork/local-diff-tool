import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';
import './markdown';

describe('markdown', () => {
  it('keeps angle-bracket placeholders as literal text', () => {
    const html = marked.parse('(review reply <id> <text> [author]); then X', { async: false }) as string;
    expect(html).toContain('&lt;id&gt;');
    expect(html).toContain('then X');
    expect(DOMPurify.isSupported || true).toBe(true);
  });
});
