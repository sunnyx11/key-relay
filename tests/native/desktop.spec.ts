import { test, expect, chromium, type Browser } from '@playwright/test';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import config from '../../src-tauri/tauri.conf.json' with { type: 'json' };

let configDir: string;
test.beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'key-relay-desktop-'));
  if (process.env.KEY_RELAY_TEST_SHORTCUT) writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ intervalMs: 50, shortcut: process.env.KEY_RELAY_TEST_SHORTCUT }));
});
test.afterAll(() => { rmSync(configDir, { recursive: true, force: true }); });

test('duplicate launch restores the existing window and keeps its session', async () => {
  const executable = resolve(process.env.KEY_RELAY_TEST_EXECUTABLE || 'src-tauri/target/release/key-relay.exe');
  const env = { ...process.env, KEY_RELAY_TEST_CONFIG_DIR: configDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229' };
  writeFileSync(join(configDir, 'text.json'), JSON.stringify({ restoreDraft: true, saveHistory: true, draft: '测试保存草稿', entries: [{ id: 1, time: Date.now(), text: '已保存历史\n  完整正文' }], nextId: 2 }));
  writeFileSync(join(configDir, 'updates.json'), JSON.stringify({ autoCheck: false }));
  const children: ReturnType<typeof spawn>[] = [];
  let browser: Browser | undefined;
  try {
    const first = spawn(executable, [], { env, stdio: 'ignore' }); children.push(first);
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:9229/json/version')).ok; } catch { return false; } }, { timeout: 25_000 }).toBe(true);
    browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
    const page = browser.contexts()[0].pages()[0];
    await expect(page.locator('#source')).toBeEditable();
    await expect(page.locator('#source')).toHaveValue('测试保存草稿');
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 600, height: 340 });
    await page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<void> } };
      await runtime.__TAURI_INTERNALS__.invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: 600, height: 450 } } });
    });
    await page.locator('#source').fill('原窗口中的最新编辑');
    await page.getByRole('button', { name: '置顶窗口' }).click();
    await page.locator('#settings-tab').click();
    await page.getByRole('button', { name: '最小化' }).click();
    const isMinimized = () => page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<boolean> } }).__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }));
    await expect.poll(isMinimized).toBe(true);
    const second = spawn(executable, [], { env: { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9230' }, stdio: 'ignore' }); children.push(second);
    await expect.poll(() => second.exitCode, { timeout: 5_000 }).toBe(0);
    await expect.poll(isMinimized).toBe(false);
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 600, height: 450 });
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await expect(page.locator('#settings-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: '取消置顶' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#input-tab').click();
    await expect(page.locator('#source')).toHaveValue('原窗口中的最新编辑');
    await page.getByRole('button', { name: '关闭' }).click();
    await expect.poll(() => first.exitCode, { timeout: 10_000 }).toBe(0);
    await browser.close(); browser = undefined;

    const reopened = spawn(executable, [], { env, stdio: 'ignore' }); children.push(reopened);
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:9229/json/version')).ok; } catch { return false; } }, { timeout: 25_000 }).toBe(true);
    browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
    const restored = browser.contexts()[0].pages()[0];
    await expect(restored.locator('#source')).toHaveValue('原窗口中的最新编辑');
    expect(await restored.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 600, height: 340 });
    await restored.locator('#history-tab').click();
    await expect(restored.locator('.history-entry')).toHaveCount(1);
    await restored.getByRole('button', { name: '关闭' }).click();
    await expect.poll(() => reopened.exitCode, { timeout: 10_000 }).toBe(0);
  } finally {
    for (const child of children) if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await browser?.close().catch(() => {});
  }
});

for (const session of ['first', 'reopened']) {
test(`packaged WebView2 window, pin and cleanup (${session} session)`, async () => {
  const executable = resolve(process.env.KEY_RELAY_TEST_EXECUTABLE || 'src-tauri/target/release/key-relay.exe');
  expect(statSync(executable).mtimeMs, '请先构建当前源码，桌面测试需要支持隔离配置目录的 EXE。').toBeGreaterThanOrEqual(statSync(resolve('src-tauri/src/lib.rs')).mtimeMs);
  const child = spawn(executable, [], {
    env: { ...process.env, KEY_RELAY_TEST_CONFIG_DIR: configDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229' }, stdio: 'ignore',
  });
  const errors: string[] = [];
  try {
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:9229/json/version')).ok; } catch { return false; } }, { timeout: 25_000 }).toBe(true);
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
    const context = browser.contexts()[0];
    await expect.poll(() => context.pages().length).toBeGreaterThan(0);
    const page = context.pages()[0];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#source')).toBeEditable();
    await expect(page.locator('#start')).toBeDisabled();
    await expect(page.locator('#status-message')).toContainText('请先点击外部输入位置');
    await expect(page.locator('#source')).toHaveCSS('resize', 'none');
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 600, height: 340 });
    await expect.poll(() => page.evaluate(() => Math.abs(innerHeight - document.querySelector('.window')!.getBoundingClientRect().height))).toBeLessThan(2);
    const originalEditorHeight = (await page.locator('#source').boundingBox())!.height;
    await page.screenshot({ path: `test-results/native-input-default-${session}.png` });
    const originalHeight = await page.evaluate(() => innerHeight);
    await page.locator('#about-tab').click();
    await expect(page.getByText(`版本 ${config.version} · Windows 64 位`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'hkhl888@foxmail.com' })).toHaveAttribute('href', 'mailto:hkhl888@foxmail.com');
    expect(await page.evaluate(() => innerHeight)).toBe(originalHeight);
    const contentBox = (await page.locator('.about-content').boundingBox())!;
    const windowBox = (await page.locator('.window').boundingBox())!;
    expect(windowBox.y + windowBox.height - contentBox.y - contentBox.height).toBeLessThanOrEqual(8);
    const updateStatus = (await page.locator('.update-status').boundingBox())!;
    const updatePreference = (await page.locator('.update-preference').boundingBox())!;
    expect(Math.abs(updateStatus.y - updatePreference.y)).toBeLessThan(4);
    expect(await page.locator('.about-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/native-about.png' });
    await page.getByRole('button', { name: 'MIT 许可证' }).click();
    await expect(page.getByLabel('MIT 许可证全文')).toContainText('Copyright (c) 2026 sunnyx11');
    expect(await page.evaluate(() => innerHeight)).toBe(originalHeight);
    expect((await page.locator('.about-content').boundingBox())!.height).toBe(contentBox.height);
    expect(await page.locator('.about-content').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
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
    await page.locator('#settings-tab').click();
    await expect(page.getByLabel('等待时间')).toHaveCount(0);
    await expect(page.getByLabel('字符间隔')).toBeVisible();
    await page.locator('#input-tab').click();
    await page.locator('#source').fill('中文 Native IPC');
    const state = await page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<Record<string, unknown>> } };
      return runtime.__TAURI_INTERNALS__.invoke('get_snapshot');
    });
    expect(state.phase).toBe('idle'); expect(state.target).toBeNull(); expect(state.shortcutError).toBeNull(); expect(state).not.toHaveProperty('text');
    await expect(page.locator('#start')).toBeDisabled();
    const startError = await page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } };
      try {
        await runtime.__TAURI_INTERNALS__.invoke('start_task', { draft: { revision: Date.now() + 1000, text: '中文 Native IPC', settings: { intervalMs: 50, shortcut: 'F8' } } });
        return '';
      } catch (error) { return String(error); }
    });
    expect(startError).toContain('请先点击外部输入位置');
    await expect(page.locator('#source')).toHaveValue('中文 Native IPC');
    await page.locator('#source').fill('  中文  \nA\t');
    await page.getByRole('button', { name: '清理', exact: true }).click();
    await expect(page.locator('#source')).toHaveValue('  中文\nA');
    await expect(page.locator('#text-count')).toHaveText('6 个字符');
    for (const [key, value] of [
      ['Control+z', '  中文  \nA'], ['Control+z', '  中文  \nA\t'],
      ['Control+y', '  中文  \nA'], ['Control+y', '  中文\nA'],
    ]) {
      await page.keyboard.press(key); await expect(page.locator('#source')).toHaveValue(value);
    }
    await expect(page.locator('#start')).toBeDisabled();
    await expect(page.locator('#trim-trailing')).toBeEnabled();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/native-cleanup-${session}.png` });
    await page.locator('#clear').click();
    await expect(page.locator('#source')).toHaveValue('');
    await expect(page.locator('#status-message')).toContainText('已清空');
    const checkPanels = async () => {
      for (const tab of ['history', 'settings', 'about', 'input']) {
        await page.locator(`#${tab}-tab`).click();
        expect(await page.evaluate(() => {
          const box = document.querySelector('.window')!.getBoundingClientRect();
          return Math.abs(box.height - innerHeight) <= 1 && Math.abs(box.width - innerWidth) <= 1
            && document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
        })).toBe(true);
        if (tab !== 'input') {
          const content = (await page.locator(`.${tab}-content`).boundingBox())!;
          expect(Math.abs(content.y + content.height - await page.evaluate(() => innerHeight))).toBeLessThanOrEqual(8);
        }
      }
      const editor = (await page.locator('#source').boundingBox())!;
      const footer = (await page.locator('.footer').boundingBox())!;
      expect(editor.height).toBeGreaterThan(0);
      expect(Math.abs(footer.y - editor.y - editor.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(footer.y + footer.height - await page.evaluate(() => innerHeight))).toBeLessThanOrEqual(1);
    };
    const minimum = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RelayMinimumSize {
        [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] public struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, ref MinMaxInfo info);
        public static int[] Read(IntPtr window) { var info = new MinMaxInfo(); SendMessage(window, 0x24, IntPtr.Zero, ref info); return new int[] { info.MinTrackSize.X, info.MinTrackSize.Y }; }
      }';
      $taskMinimum = [RelayMinimumSize]::Read((Get-Process -Id ${child.pid}).MainWindowHandle);
      ConvertTo-Json -Compress -InputObject @($taskMinimum)
    `], { encoding: 'utf8' }));
    expect(minimum).toEqual([320, 340]);
    for (const [width, height] of [[600, 600], [510, 340], [390, 450], [320, 340], [600, 340]]) {
      await page.evaluate(async ({ width, height }) => {
        const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<void> } };
        await runtime.__TAURI_INTERNALS__.invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width, height } } });
      }, { width, height });
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
      await checkPanels();
      if (width === 510) {
        const status = (await page.locator('#status-message').boundingBox())!;
        const actions = (await page.locator('.footer-actions').boundingBox())!;
        expect(Math.abs(status.y + status.height / 2 - actions.y - actions.height / 2)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `test-results/native-footer-510-${session}.png` });
      }
      if (width === 320) await page.screenshot({ path: `test-results/native-minimum-${session}.png` });
      if (width === 600) expect((await page.locator('#source').boundingBox())!.height - originalEditorHeight).toBeCloseTo(height - originalHeight, 1);
    }
    await page.getByRole('button', { name: '最大化或还原' }).click();
    await expect.poll(() => page.evaluate(async () => {
      const runtime = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<boolean> } };
      return runtime.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' });
    })).toBe(true);
    await checkPanels();
    await page.screenshot({ path: `test-results/native-maximized-${session}.png` });
    await page.getByRole('button', { name: '最大化或还原' }).click();
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 600, height: 340 });
    await checkPanels();
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
