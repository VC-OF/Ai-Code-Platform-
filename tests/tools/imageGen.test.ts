import { describe, it, expect } from 'vitest';
import { buildPollinationsUrl } from '@/lib/imageGen';
import { validateTool } from '@/lib/toolValidator';

describe('imageGen', () => {
  describe('buildPollinationsUrl', () => {
    it('encodes the prompt and applies defaults', () => {
      const url = buildPollinationsUrl({ prompt: 'a red fox, watercolor' });
      expect(url).toContain('image.pollinations.ai/prompt/a%20red%20fox');
      expect(url).toContain('width=1024');
      expect(url).toContain('height=1024');
      expect(url).toContain('model=flux');
      expect(url).toContain('nologo=true');
    });

    it('clamps dimensions to 64–2048', () => {
      const url = buildPollinationsUrl({ prompt: 'x', width: 9999, height: 8 });
      expect(url).toContain('width=2048');
      expect(url).toContain('height=64');
    });

    it('includes the seed when given', () => {
      expect(buildPollinationsUrl({ prompt: 'x', seed: 42 })).toContain('seed=42');
    });
  });

  describe('generate_image tool validation', () => {
    it('accepts a valid call', () => {
      expect(
        validateTool('generate_image', {
          prompt: 'hero image',
          path: 'public/hero.png',
          width: 1200,
          height: 630,
        }).ok
      ).toBe(true);
    });

    it('rejects non-image extensions', () => {
      const r = validateTool('generate_image', {
        prompt: 'x',
        path: 'src/evil.ts',
      });
      expect(r.ok).toBe(false);
    });
  });
});
