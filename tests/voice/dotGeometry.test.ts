import { describe, expect, it } from 'vitest';
import { buildDotRing, dotColor, dotPosition, seededRandom } from '@/components/voice/dotGeometry';

describe('dotGeometry', () => {
  it('seededRandom is deterministic and within [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const r = seededRandom(i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      expect(seededRandom(i)).toBe(r);
    }
  });

  it('buildDotRing produces a stable, evenly spread layout', () => {
    const ring = buildDotRing(140);
    expect(ring).toHaveLength(140);
    // Stable across calls
    expect(buildDotRing(140)).toEqual(ring);
    // Angles increase around the ring overall (with jitter, dot i sits near i/count of a turn)
    expect(ring[10].angle).toBeGreaterThan(ring[0].angle);
    expect(ring[100].angle).toBeGreaterThan(ring[50].angle);
  });

  it('dotPosition stays within the max radius plus dot size', () => {
    const ring = buildDotRing(50);
    for (const dot of ring) {
      for (const level of [0, 0.5, 1]) {
        const p = dotPosition(dot, level, 3.2, 100, 100, 80);
        const dx = p.x - 100;
        const dy = p.y - 100;
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(80 + 6);
        expect(p.size).toBeGreaterThan(0);
        expect(p.alpha).toBeGreaterThanOrEqual(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it('energy pushes dots outward', () => {
    const dot = buildDotRing(1)[0];
    const idle = dotPosition(dot, 0, 5, 0, 0, 100);
    const loud = dotPosition(dot, 1, 5, 0, 0, 100);
    expect(Math.hypot(loud.x, loud.y)).toBeGreaterThan(Math.hypot(idle.x, idle.y));
  });

  it('dotColor shifts from cyan toward violet with energy', () => {
    const dot = buildDotRing(1)[0];
    const idle = dotColor(dot, 0);
    const loud = dotColor(dot, 1);
    const hueOf = (s: string) => Number(s.slice(4, s.indexOf(' ')));
    expect(hueOf(idle)).toBeLessThan(210);
    expect(hueOf(loud)).toBeGreaterThan(hueOf(idle));
    expect(hueOf(loud)).toBeLessThanOrEqual(265);
  });
});
