// Renders synthetic demo documents to JPEG images so the demo exercises the
// real image pipeline (quality check, hashing, upload, vision analysis).
import { DEMO_BANNER, demoDocPages, type DemoDoc } from '@shared/demo';

const W = 1240;
const H = 1754;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderDemoPage(doc: DemoDoc, pageIndex: number): Promise<Blob> {
  const lines = demoDocPages(doc)[pageIndex] ?? [];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rand = seeded(doc.key.length * 97 + pageIndex * 13 + 7);
  ctx.fillStyle = doc.handwritten ? '#fbf8ef' : '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Watermark: synthetic data.
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillStyle = 'rgba(200, 30, 30, 0.07)';
  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SYNTHETIC DEMO', 0, 0);
  ctx.restore();

  let y = 90;
  const left = 90;
  const maxWidth = W - 2 * left;
  for (const [i, raw] of lines.entries()) {
    if (raw === DEMO_BANNER) {
      ctx.fillStyle = '#b91c1c';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(raw, left, y);
      y += 50;
      continue;
    }
    const isTitle = i === 1;
    if (doc.handwritten && !isTitle) {
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'italic 36px "Comic Sans MS", "Segoe Print", cursive';
    } else {
      ctx.fillStyle = '#111827';
      ctx.font = isTitle ? 'bold 34px serif' : '28px serif';
    }
    for (const part of wrap(ctx, raw, maxWidth)) {
      ctx.save();
      if (doc.handwritten && !isTitle) {
        ctx.translate(left + rand() * 8, y + rand() * 4);
        ctx.rotate((rand() - 0.5) * 0.02);
        ctx.fillText(part, 0, 0);
      } else ctx.fillText(part, left, y);
      ctx.restore();
      y += doc.handwritten ? 62 : 46;
    }
    if (isTitle) {
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(left, y - 22);
      ctx.lineTo(W - left, y - 22);
      ctx.stroke();
      y += 12;
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/jpeg', 0.9));
}
