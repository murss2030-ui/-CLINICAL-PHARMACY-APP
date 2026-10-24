import { describe, expect, it } from 'vitest';
import { dHashFromGray, evaluateQuality, grayMetrics, hammingHex } from '@/lib/image';

const W = 400;
const H = 400;
/** Deterministic pseudo-random value in [0, 1) for a pair of integers. */
const rnd = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
/** Synthetic "printed page": light background with lines of irregular glyph strokes (like real text). */
function page({ bg = 240, ink = 30, rotated = false } = {}) {
  const g = new Uint8ClampedArray(W * H).fill(bg);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, c] = rotated ? [x, y] : [y, x];
      const line = Math.floor(r / 24);
      const inLine = r % 24 >= 6 && r % 24 < 16 && c > 20 && c < W - 20;
      if (inLine && rnd(line, c) < 0.35) g[y * W + x] = ink;
    }
  }
  return g;
}
const dims = { width: 1200, height: 1600, bytes: 300_000 };

describe('image quality check', () => {
  it('passes a sharp, well-lit, upright page', () => {
    const q = evaluateQuality(grayMetrics(page(), W, H), dims);
    expect(q.ready).toBe(true);
    expect(q.issues).toEqual([]);
  });
  it('fails a blank / featureless image (blur, unreadable)', () => {
    const q = evaluateQuality(grayMetrics(new Uint8ClampedArray(W * H).fill(200), W, H), dims);
    expect(q.ready).toBe(false);
    expect(q.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['blur', 'unreadable_text']));
  });
  it('fails a dark image', () => {
    const q = evaluateQuality(grayMetrics(page({ bg: 40, ink: 5 }), W, H), dims);
    expect(q.issues.find((i) => i.code === 'low_light')?.severity).toBe('fail');
  });
  it('warns when text runs vertically (page rotated)', () => {
    const q = evaluateQuality(grayMetrics(page({ rotated: true }), W, H), dims);
    expect(q.issues.map((i) => i.code)).toContain('rotated');
  });
  it('fails tiny images and warns about heavy compression', () => {
    const m = grayMetrics(page(), W, H);
    expect(evaluateQuality(m, { width: 320, height: 400, bytes: 20_000 }).ready).toBe(false);
    expect(evaluateQuality(m, { width: 2000, height: 2000, bytes: 50_000 }).issues.map((i) => i.code)).toContain('compression');
  });
});

describe('near-duplicate image detection (dHash)', () => {
  it('matches identical images and separates inverted ones', () => {
    const a = Array.from({ length: 72 }, (_, i) => (i * 37) % 255);
    const inv = a.map((v) => 255 - v);
    expect(hammingHex(dHashFromGray(a), dHashFromGray(a))).toBe(0);
    expect(hammingHex(dHashFromGray(a), dHashFromGray(inv))).toBeGreaterThan(40);
  });
});
