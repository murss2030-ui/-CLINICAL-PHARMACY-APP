// Renders Android launcher icons (legacy, round and adaptive foreground) and
// splash images from the PRECEPTOR logo. Run after `npx cap add android`.
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const RES = new URL('../android/app/src/main/res/', import.meta.url);
if (!existsSync(RES)) {
  console.error('android/ not found — run `npx cap add android` first.');
  process.exit(1);
}
const cross = (scale) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)"><path d="M206 96h100v110h110v100H306v110H206V306H96V206h110z" fill="#3fb68b"/><circle cx="256" cy="256" r="46" fill="#fff"/></g>`;
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">${bg}${body}</svg>`;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
async function render(markup, w, h, file, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:${transparent ? 'transparent' : '#0f2a4a'};display:grid;place-items:center">${markup}</body></html>`);
  writeFileSync(new URL(file, RES), await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } }));
}
for (const [d, f] of Object.entries(DENSITIES)) {
  const legacy = Math.round(48 * f);
  const fg = Math.round(108 * f);
  await render(`<div style="width:${legacy}px;height:${legacy}px">${svg(cross(0.8), '<rect width="512" height="512" rx="96" fill="#0f2a4a"/>')}</div>`, legacy, legacy, `mipmap-${d}/ic_launcher.png`, true);
  await render(`<div style="width:${legacy}px;height:${legacy}px">${svg(cross(0.8), '<circle cx="256" cy="256" r="256" fill="#0f2a4a"/>')}</div>`, legacy, legacy, `mipmap-${d}/ic_launcher_round.png`, true);
  // Adaptive foreground: logo inside the 66 dp safe zone of a 108 dp canvas.
  await render(`<div style="width:${fg}px;height:${fg}px">${svg(cross(0.5))}</div>`, fg, fg, `mipmap-${d}/ic_launcher_foreground.png`, true);
}
// Splash screens (portrait / landscape) on navy.
const splash = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(splash)) {
  const logo = Math.round(Math.min(w, h) * 0.35);
  const markup = `<div style="width:${logo}px;height:${logo}px">${svg(cross(0.9))}</div>`;
  await render(markup, w, h, `drawable-port-${d}/splash.png`);
  await render(markup, h, w, `drawable-land-${d}/splash.png`);
}
await render(`<div style="width:300px;height:300px">${svg(cross(0.9))}</div>`, 480, 800, 'drawable/splash.png');
writeFileSync(new URL('values/ic_launcher_background.xml', RES), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F2A4A</color>\n</resources>\n');
await browser.close();
console.log('Android icons and splash screens written.');
