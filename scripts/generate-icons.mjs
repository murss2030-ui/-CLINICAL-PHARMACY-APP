// Renders the PWA icons (PNG) from an inline SVG using Playwright's Chromium.
// Run once after changing the logo: npm run icons
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = new URL('../client/public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const logo = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#0f2a4a"/>
  <g transform="translate(256 256) scale(${pad ? 0.62 : 0.8}) translate(-256 -256)">
    <path d="M206 96h100v110h110v100H306v110H206V306H96V206h110z" fill="#3fb68b"/>
    <circle cx="256" cy="256" r="46" fill="#ffffff"/>
  </g>
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192, pad: false },
  { file: 'icon-512.png', size: 512, pad: false },
  { file: 'maskable-512.png', size: 512, pad: true },
  { file: 'apple-touch-icon.png', size: 180, pad: true },
];

const executablePath = process.env.PW_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${logo(t.pad).replace('width="512" height="512"', `width="${t.size}" height="${t.size}"`)}</body></html>`);
  await page.screenshot({ path: new URL(t.file, OUT).pathname, omitBackground: !t.pad, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log('wrote', t.file);
}
await browser.close();
