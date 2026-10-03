import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runInThisContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Run the shared browser checks against the standalone file; exit nonzero on any failure.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(new URL('../key-relay.html', import.meta.url).href);
  const { version } = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(await page.locator('.about-version').textContent(), `版本 ${version} · Windows 64 位`);
  assert.equal((await page.locator('.license-text').textContent()).trim(), readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim());
  const iconMatches = await page.locator('.about-icon').evaluate((icon, svg) => {
    const shapes = element => [...element.children].map(child => [child.localName, [...child.attributes].map(attribute => [attribute.name, attribute.value])]);
    return JSON.stringify(shapes(icon)) === JSON.stringify(shapes(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement));
  }, readFileSync(new URL('../../src-tauri/icons/icon.svg', import.meta.url), 'utf8'));
  assert.ok(iconMatches, 'Prototype icon must match the application SVG');
  console.log('Application version, full license and icon match the prototype.');
  const checks = runInThisContext(readFileSync(new URL('./interaction-check.js', import.meta.url), 'utf8'));
  const result = await checks(page);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failed ? 1 : 0;
  const output = new URL('../../test-results/prototype/', import.meta.url);
  mkdirSync(output, { recursive: true });
  for (const width of [1180, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const tab of ['input', 'settings', 'about']) {
      await page.locator(`#${tab}-tab`).click();
      await page.locator('.window').screenshot({ path: fileURLToPath(new URL(`${tab}-${width}.png`, output)) });
    }
    await page.locator('#show-license').click();
    await page.locator('.window').screenshot({ path: fileURLToPath(new URL(`license-${width}.png`, output)) });
    await page.locator('#back-about').click();
  }
  await page.setViewportSize({ width: 1952, height: 1216 });
  await page.evaluate(() => { document.body.style.zoom = '1.5'; });
  await page.locator('.window').screenshot({ path: fileURLToPath(new URL('about-150.png', output)) });
} finally {
  await browser.close();
}
