// Pure geometry helpers for the Astra-style dot halo — exported for tests.

export interface DotSpec {
  /** Angle around the ring, radians */
  angle: number;
  /** 0..1 base orbit position */
  baseRadius: number;
  /** Individual phase offset so dots don't breathe in lockstep */
  phase: number;
  /** Individual size 2..4 px */
  size: number;
  /** Dot hue offset within the palette */
  hueShift: number;
}

const TAU = Math.PI * 2;

/** Deterministic pseudo-random from an index (stable across renders/reloads). */
export function seededRandom(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Build the ring's dot layout: `count` dots with stable random properties. */
export function buildDotRing(count: number): DotSpec[] {
  const dots: DotSpec[] = [];
  for (let i = 0; i < count; i++) {
    const r1 = seededRandom(i * 3 + 1);
    const r2 = seededRandom(i * 3 + 2);
    const r3 = seededRandom(i * 3 + 3);
    dots.push({
      angle: (i / count) * TAU + (r1 - 0.5) * 0.12,
      baseRadius: 0.78 + r2 * 0.22,
      phase: r3 * TAU,
      size: 2 + r1 * 2,
      hueShift: r2 * 30 - 15,
    });
  }
  return dots;
}

/**
 * Position of one dot for a frame.
 * @param level 0..1 mic/speech energy
 * @param t     seconds, drives the idle breathing
 */
export function dotPosition(
  dot: DotSpec,
  level: number,
  t: number,
  centerX: number,
  centerY: number,
  maxRadius: number
): { x: number; y: number; size: number; alpha: number } {
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.1 + dot.phase);
  // Energy pushes dots outward from their base orbit; idle keeps a slow breath.
  // The 1/1.28 factor caps the worst case (baseRadius 1 × 0.92+0.08+0.28)
  // at exactly maxRadius, so dots never leave the canvas.
  const base = maxRadius * dot.baseRadius * 0.78125;
  const radius = base * (0.92 + breathe * 0.08 + level * 0.28);
  // Dots swirl slowly; more energy spins faster
  const angle = dot.angle + t * (0.12 + level * 0.9) + Math.sin(t * 0.7 + dot.phase) * 0.05;
  const size = dot.size * (1 + level * 0.9 + breathe * 0.15);
  const alpha = 0.45 + breathe * 0.25 + level * 0.3;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
    size: Math.min(size, dot.size * 2.4),
    alpha: Math.min(alpha, 1),
  };
}

/** Per-dot color from the app's cyan→violet Astra palette. */
export function dotColor(dot: DotSpec, level: number): string {
  // 190 (cyan) at rest → 265 (violet) as energy rises, with per-dot variance
  const hue = 195 + dot.hueShift + level * 55;
  const light = 62 + level * 12;
  const sat = 70 + level * 20;
  return `hsl(${hue} ${sat}% ${light}%)`;
}
