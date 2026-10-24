// Image intake: compression, quality check, hashing, rotate and crop.
// The quality metrics are pure functions over a grayscale buffer so they can
// be unit-tested without a browser.
import type { ImageQuality } from './types';

export const MAX_DIMENSION = 1600;
export const JPEG_QUALITY = 0.82;

export interface GrayMetrics {
  brightness: number;
  contrast: number;
  sharpness: number;
  rowProfileVar: number;
  colProfileVar: number;
  borderEdgeRatio: number;
}

/** Metrics on a grayscale image (values 0–255, row-major). */
export function grayMetrics(gray: ArrayLike<number>, w: number, h: number): GrayMetrics {
  const n = w * h;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i]!;
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (gray[i]! - mean) ** 2;
  const contrast = Math.sqrt(varSum / n);

  // Variance of the Laplacian → sharpness (low = blurred).
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  // Edge energy near the border vs the interior → text running off the edge.
  let borderEdge = 0;
  let borderCount = 0;
  let innerEdge = 0;
  let innerCount = 0;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      count++;
      const edge = Math.abs(lap);
      if (x < band || y < band || x >= w - band || y >= h - band) {
        borderEdge += edge;
        borderCount++;
      } else {
        innerEdge += edge;
        innerCount++;
      }
    }
  }
  const lapMean = lapSum / Math.max(1, count);
  const sharpness = lapSq / Math.max(1, count) - lapMean * lapMean;

  // Text lines create strong variation between rows (upright) or columns (rotated 90°).
  const rowMeans = new Float64Array(h);
  const colMeans = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]!;
      s += v;
      colMeans[x]! += v / h;
    }
    rowMeans[y] = s / w;
  }
  const profileVar = (arr: Float64Array) => {
    // Variance of the first difference removes slow illumination gradients.
    let s = 0;
    let s2 = 0;
    for (let i = 1; i < arr.length; i++) {
      const d = arr[i]! - arr[i - 1]!;
      s += d;
      s2 += d * d;
    }
    const m = s / Math.max(1, arr.length - 1);
    return s2 / Math.max(1, arr.length - 1) - m * m;
  };

  return {
    brightness: mean,
    contrast,
    sharpness,
    rowProfileVar: profileVar(rowMeans),
    colProfileVar: profileVar(colMeans),
    borderEdgeRatio: innerCount && innerEdge > 0 ? borderEdge / borderCount / (innerEdge / innerCount) : 0,
  };
}

export function evaluateQuality(m: GrayMetrics, dims: { width: number; height: number; bytes: number }): ImageQuality {
  const issues: ImageQuality['issues'] = [];
  const minSide = Math.min(dims.width, dims.height);
  const bytesPerPixel = dims.bytes / Math.max(1, dims.width * dims.height);
  if (minSide < 480) issues.push({ code: 'resolution', severity: 'fail', message: 'Resolution too low to read reliably.' });
  else if (minSide < 800) issues.push({ code: 'resolution', severity: 'warn', message: 'Low resolution — small print may be unreadable.' });
  if (m.brightness < 50) issues.push({ code: 'low_light', severity: 'fail', message: 'Image is too dark.' });
  else if (m.brightness < 85) issues.push({ code: 'low_light', severity: 'warn', message: 'Lighting is dim.' });
  else if (m.brightness > 248) issues.push({ code: 'glare', severity: 'warn', message: 'Overexposed or glare — text may be washed out.' });
  if (m.contrast < 14) issues.push({ code: 'unreadable_text', severity: 'fail', message: 'Very low contrast — text may be unreadable.' });
  else if (m.contrast < 24) issues.push({ code: 'unreadable_text', severity: 'warn', message: 'Low contrast.' });
  if (m.sharpness < 40) issues.push({ code: 'blur', severity: 'fail', message: 'Image is blurred — hold the phone steady and refocus.' });
  else if (m.sharpness < 110) issues.push({ code: 'blur', severity: 'warn', message: 'Image is slightly soft.' });
  if (m.colProfileVar > m.rowProfileVar * 1.8 && m.contrast >= 14) issues.push({ code: 'rotated', severity: 'warn', message: 'Text may be rotated — rotate the page upright.' });
  if (m.borderEdgeRatio > 1.25) issues.push({ code: 'cut_off', severity: 'warn', message: 'Content touches the edges — part of the page may be cut off.' });
  if (dims.bytes > 0 && bytesPerPixel < 0.025) issues.push({ code: 'compression', severity: 'warn', message: 'Heavily compressed image — details may be lost.' });

  const fails = issues.filter((i) => i.severity === 'fail').length;
  const warns = issues.length - fails;
  const score = Math.max(0, Math.min(1, 1 - fails * 0.45 - warns * 0.12));
  return {
    ready: fails === 0,
    score: Math.round(score * 100) / 100,
    issues,
    metrics: {
      width: dims.width,
      height: dims.height,
      brightness: Math.round(m.brightness),
      contrast: Math.round(m.contrast),
      sharpness: Math.round(m.sharpness),
      bytesPerPixel: Math.round(bytesPerPixel * 1000) / 1000,
    },
  };
}

/** 64-bit difference hash (hex) for near-duplicate detection. */
export function dHashFromGray(gray9x8: ArrayLike<number>): string {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray9x8[y * 9 + x]! > gray9x8[y * 9 + x + 1]! ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingHex(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Near-duplicate threshold for dHash (out of 64 bits). */
export const NEAR_DUPLICATE_BITS = 6;

// ───────────────────────── browser helpers ─────────────────────────

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality));
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function grayFrom(source: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) gray[j] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  return gray;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
  dhash: string;
  quality: ImageQuality;
}

/** Compress (max 1600 px, JPEG), then quality-check and hash the result. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bmp = await decode(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await toBlob(c);
  const analysisScale = Math.min(1, 800 / Math.max(w, h));
  const aw = Math.max(16, Math.round(w * analysisScale));
  const ah = Math.max(16, Math.round(h * analysisScale));
  const metrics = grayMetrics(grayFrom(c, aw, ah), aw, ah);
  const quality = evaluateQuality(metrics, { width: bmp.width, height: bmp.height, bytes: file.type === 'image/jpeg' ? file.size : 0 });
  const dhash = dHashFromGray(grayFrom(c, 9, 8));
  bmp.close();
  return { blob, width: w, height: h, sha256: await sha256Hex(blob), dhash, quality };
}

export async function rotateImage(blob: Blob, degrees: 90 | 180 | 270): Promise<Blob> {
  const bmp = await decode(blob);
  const swap = degrees !== 180;
  const c = canvas(swap ? bmp.height : bmp.width, swap ? bmp.width : bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();
  return toBlob(c);
}

/** Crop with a rectangle in relative coordinates (0–1). */
export async function cropImage(blob: Blob, rect: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const bmp = await decode(blob);
  const sx = Math.round(rect.x * bmp.width);
  const sy = Math.round(rect.y * bmp.height);
  const sw = Math.max(16, Math.round(rect.w * bmp.width));
  const sh = Math.max(16, Math.round(rect.h * bmp.height));
  const c = canvas(sw, sh);
  c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  return toBlob(c);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(binary);
}
