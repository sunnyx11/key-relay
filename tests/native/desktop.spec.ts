import { test, expect, chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import config from '../../src-tauri/tauri.conf.json' with { type: 'json' };

for (const session of ['first', 'reopened']) {
test(`packaged WebView2 window, pin and cleanup (${session} session)`, async () => {
  const child = spawn(resolve('src-tauri/target/release/key-relay.exe'), [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229' }, stdio: 'ignore',
  });
  const errors: string[] = [];
  try {
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:9229/json/version')).ok; } catch { return false; } }, { timeout: 25_000 }).toBe(true);
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
    const context = browser.contexts()[0];
    await expect.poll(() => context.pages().length).toBeGreaterThan(0);
    const page = context.pages()[0];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#start')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => Math.abs(innerHeight - Math.max(360, document.querySelector('.window')!.getBoundingClientRect().height)))).toBeLessThan(2);
    const originalHeight = await page.evaluate(() => innerHeight);
    await page.locator('#about-tab').click();
    await expect(page.getByText(`版本 ${config.version} · Windows 64 位`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'hkhl888@foxmail.com' })).toHaveAttribute('href', 'mailto:hkhl888@foxmail.com');
    expect(await page.evaluate(() => innerHeight)).toBe(originalHeight);
    await page.screenshot({ path: 'test-results/native-about.png' });
    await page.getByRole('button', { name: 'MIT 许可证' }).click();
    await expect(page.getByLabel('MIT 许可证全文')).toContainText('Copyright (c) 2026 sunnyx11');
    expect(await page.evaluate(() => innerHeight)).toBe(originalHeight);
    await page.getByRole('button', { name: '返回关于' }).click();
    const forbidden = await page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<void> } };
      try { await runtime.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: 'https://example.com' }); return ''; }
      catch (error) { return String(error); }
    });
    expect(forbidden).toContain('Not allowed to open url https://example.com');
    await page.locator('#input-tab').click();
    const pin = page.getByRole('button', { name: '置顶窗口' });
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await pin.click();
    await expect(page.getByRole('button', { name: '取消置顶' })).toHaveAttribute('aria-pressed', 'true');
    const isPinned = () => page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<boolean> } }).__TAURI_INTERNALS__.invoke('plugin:window|is_always_on_top', { label: 'main' }));
    expect(await isPinned()).toBe(true);
    await page.getByRole('button', { name: '最小化' }).click();
    const isMinimized = () => page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<boolean> } }).__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }));
    await expect.poll(isMinimized).toBe(true);
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RelayTestWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd); }'; [RelayTestWindow]::ShowWindow((Get-Process -Id ${child.pid}).MainWindowHandle, 9)`]);
    await expect.poll(isMinimized).toBe(false);
    await expect(page.getByRole('button', { name: '取消置顶' })).toBeVisible();
    expect(await isPinned()).toBe(true);
    await page.getByRole('button', { name: '取消置顶' }).click();
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(await isPinned()).toBe(false);
    await page.locator('#start').click(); await expect(page.locator('#status-message')).toContainText('请先填写文本');
    await page.locator('#source').fill('中文 Native IPC');
    const state = await page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<Record<string, unknown>> } };
      return runtime.__TAURI_INTERNALS__.invoke('get_snapshot');
    });
    expect(state.phase).toBe('idle'); expect(state.shortcutError).toBeNull(); expect(state).not.toHaveProperty('text');
    await page.locator('#start').click();
    await expect(page.locator('#start')).toContainText('取消输入');
    await expect(page.locator('#settings-tab')).toBeDisabled();
    await expect(page.locator('#about-tab')).toBeDisabled();
    await expect(pin).toBeDisabled();
    await page.locator('#start').click();
    await expect(page.locator('#status-message')).toContainText('已取消');
    await expect(page.locator('#source')).toHaveValue('中文 Native IPC');
    await page.locator('#source').evaluate(el => { el.style.height = '320px'; });
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeGreaterThan(450);
    await page.locator('#source').evaluate(el => { el.style.height = '184px'; });
    await page.locator('#clear').click();
    await expect(page.locator('#source')).toHaveValue('');
    await expect(page.locator('#status-message')).toContainText('已清空');
    await expect.poll(() => page.evaluate(() => Math.abs(innerHeight - Math.max(360, document.querySelector('.window')!.getBoundingClientRect().height)))).toBeLessThan(2);
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(400);
    await page.getByRole('button', { name: '最大化或还原' }).click();
    await expect.poll(() => page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<boolean> } };
      return runtime.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' });
    })).toBe(true);
    await page.getByRole('button', { name: '最大化或还原' }).click();
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600);
    await expect.poll(() => page.evaluate(() => Math.abs(innerHeight - Math.max(360, document.querySelector('.window')!.getBoundingClientRect().height)))).toBeLessThan(2);
    await pin.click();
    await expect(page.getByRole('button', { name: '取消置顶' })).toHaveAttribute('aria-pressed', 'true');
    console.log('Native viewport', await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })));
    await page.screenshot({ path: 'test-results/native-window.png' });
    await page.getByRole('button', { name: '关闭' }).click();
    await expect.poll(() => child.exitCode, { timeout: 10_000 }).toBe(0);
    expect(errors).toEqual([]);
    await browser.close();
  } finally { if (child.exitCode === null) child.kill(); }
});
}
