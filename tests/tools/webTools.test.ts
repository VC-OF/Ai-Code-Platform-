import { describe, it, expect } from 'vitest';
import { fetchUrl, htmlToText } from '@/lib/webTools';

describe('webTools', () => {
  describe('SSRF guard', () => {
    it.each([
      'http://localhost:3000/api/settings',
      'http://127.0.0.1:8080/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://[::1]:3000/',
      'http://0.0.0.0/',
    ])('blocks %s', async (url) => {
      await expect(fetchUrl(url)).rejects.toThrow(/not allowed|private/i);
    });

    it('blocks non-http protocols', async () => {
      await expect(fetchUrl('file:///etc/passwd')).rejects.toThrow(/http/i);
    });
  });

  describe('htmlToText', () => {
    it('strips scripts, styles, and tags', () => {
      const html =
        '<html><head><style>.x{}</style><script>evil()</script></head>' +
        '<body><h1>Title</h1><p>Hello <b>world</b></p></body></html>';
      const text = htmlToText(html);
      expect(text).toContain('Title');
      expect(text).toContain('Hello world');
      expect(text).not.toContain('evil');
      expect(text).not.toContain('<');
    });

    it('decodes basic entities', () => {
      expect(htmlToText('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
    });
  });
});
