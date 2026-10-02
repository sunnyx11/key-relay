import { Buffer } from 'node:buffer';
import { log } from 'node:console';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';

// Coordinates are in output pixels. Straight stem edges stay on pixel boundaries.
const profiles = [
  { size: 16, x: 4, y: 3, width: 2, height: 10, radius: 0.5, joint: 8, tip: 12, top: 4, stroke: 2 },
  { size: 20, x: 5, y: 4, width: 2, height: 12, radius: 0.5, joint: 9.5, tip: 14.5, top: 5, stroke: 2 },
  { size: 24, x: 6, y: 4, width: 2, height: 16, radius: 0.5, joint: 11, tip: 18, top: 5, stroke: 2 },
  { size: 32, x: 8, y: 6, width: 3, height: 20, radius: 0.75, joint: 15.5, tip: 23.5, top: 8, stroke: 3 },
  { size: 36, x: 9, y: 7, width: 4, height: 22, radius: 1, joint: 18, tip: 27, top: 9, stroke: 4 },
  { size: 40, x: 10, y: 7, width: 4, height: 26, radius: 1, joint: 19, tip: 30, top: 9, stroke: 4 },
  { size: 48, x: 12, y: 9, width: 5, height: 30, radius: 1.25, joint: 23.5, tip: 35.5, top: 11.5, stroke: 5 },
  { size: 64, x: 16, y: 12, width: 6, height: 40, radius: 1.5, joint: 31, tip: 47, top: 16, stroke: 6 },
  { size: 256, x: 64, y: 48, width: 24, height: 160, radius: 6, joint: 124, tip: 188, top: 64, stroke: 24 },
];

const iconsDir = new URL('../src-tauri/icons/', import.meta.url);
const previewDir = new URL('../src-tauri/target/icon-build/pixel/', import.meta.url);
await mkdir(previewDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const frames = [];
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const p of profiles) {
    const inset = Math.max(1, Math.round(p.size / 32));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.size}" height="${p.size}" viewBox="0 0 ${p.size} ${p.size}">
  <rect x="${inset}" y="${inset}" width="${p.size - inset * 2}" height="${p.size - inset * 2}" rx="${p.size * 7 / 32}" fill="#f1f4f7"/>
  <rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="${p.radius}" fill="#326798"/>
  <path d="M${p.tip} ${p.top} ${p.joint} ${p.size / 2} ${p.tip} ${p.size - p.top}" fill="none" stroke="#326798" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>\n`;
    await page.setViewportSize({ width: p.size, height: p.size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true });
    if (png.readUInt32BE(16) !== p.size || png.readUInt32BE(20) !== p.size) throw new Error(`Unexpected PNG size: ${p.size}`);
    frames.push({ size: p.size, png });
    await writeFile(new URL(`${p.size}.png`, previewDir), png);
    if (p.size === 256) await writeFile(new URL('icon.svg', iconsDir), svg);
  }
} finally {
  await browser.close();
}

// ICO directory entries reference the independently rendered PNG frames.
const directory = Buffer.alloc(6 + frames.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, { size, png }] of frames.entries()) {
  const at = 6 + index * 16;
  directory[at] = directory[at + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, at + 4);
  directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(png.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += png.length;
}
await writeFile(new URL('icon.ico', iconsDir), Buffer.concat([directory, ...frames.map(frame => frame.png)]));
log(`Generated ${fileURLToPath(new URL('icon.ico', iconsDir))}: ${frames.map(frame => frame.size).join(', ')}px`);
