// Run against an open prototype: playwright-cli -s=<session> run-code --filename=prototypes/tests/interaction-check.js
async page => {
  const results = [];
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const state = () => page.locator('#status-message').getAttribute('data-state');
  const waitState = expected => page.waitForFunction(value => document.querySelector('#status-message').dataset.state === value, expected);
  const configure = async (selector, value) => {
    await page.locator('#settings-tab').click();
    await page.locator(selector).fill(value);
    await page.locator('#input-tab').click();
  };
  const target = async () => {
    if (!await page.locator('#target').isVisible()) await page.locator('.preview > summary').click();
    await page.locator('#target').click();
  };
  const cases = [
    ['Caption matches the desktop geometry and previews window actions', async () => {
      check((await page.locator('.titlebar').boundingBox()).height === 28, 'Caption height must be 28px');
      check(await page.locator('.caption-button').count() === 4, 'Four window controls required');
      const appearance = await page.locator('.app-name').evaluate(el => {
        const style = getComputedStyle(el);
        return [style.fontSize, style.fontWeight, style.lineHeight];
      });
      check(JSON.stringify(appearance) === JSON.stringify(['12px', '400', '20px']), 'Caption typography differs from desktop');
      const pin = page.getByRole('button', { name: '置顶窗口', exact: true });
      await pin.click();
      check(await page.locator('.pin').getAttribute('aria-pressed') === 'true', 'Pin did not activate');
      await page.getByRole('button', { name: '最小化', exact: true }).click();
      check(!await page.locator('.workspace').isVisible(), 'Minimize preview still shows content');
      await page.locator('#restore-window').click();
      check(await page.locator('.pin').getAttribute('aria-pressed') === 'true', 'Restore lost pin state');
      const normal = await page.locator('.window').boundingBox();
      await page.getByRole('button', { name: '最大化或还原', exact: true }).click();
      check((await page.locator('.window').boundingBox()).width > normal.width, 'Maximize preview did not expand');
      await page.locator('.title-drag').dblclick();
      check((await page.locator('.window').boundingBox()).width === normal.width, 'Caption double click did not restore');
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      check(!await page.locator('.window').isVisible(), 'Close preview still visible');
      await page.locator('#restore-window').click();
      check(await page.locator('.pin').getAttribute('aria-pressed') === 'false', 'Reopening must reset pin');
    }],
    ['About supports three-tab navigation, fixed links and offline license', async () => {
      check(await page.getByRole('tab').count() === 3, 'About tab missing');
      await page.locator('#source').fill('保留文本');
      await page.locator('#input-tab').focus();
      await page.keyboard.press('End');
      check(await page.locator('#about-tab').getAttribute('aria-selected') === 'true', 'End must select About');
      check(await page.locator('.about-version').textContent() === '版本 0.2.3 · Windows 64 位', 'Version metadata differs');
      const links = await page.locator('.about-support a').evaluateAll(items => items.map(item => item.getAttribute('href')));
      check(JSON.stringify(links) === JSON.stringify(['https://github.com/sunnyx11/key-relay', 'https://github.com/sunnyx11/key-relay#readme', 'https://github.com/sunnyx11/key-relay/issues', 'mailto:hkhl888@foxmail.com']), 'Support links differ');
      check(await page.locator('#input-panel').evaluate(el => el.inert), 'Hidden input remains interactive');
      check(await page.locator('.footer').evaluate(el => el.inert), 'Hidden footer remains interactive');
      await page.locator('#show-license').click();
      check((await page.locator('.license-text').textContent()).includes('THE SOFTWARE IS PROVIDED "AS IS"'), 'Offline license is incomplete');
      check(await page.locator('#back-about').evaluate(el => el === document.activeElement), 'License entry focus missing');
      await page.locator('#back-about').click();
      check(await page.locator('#show-license').evaluate(el => el === document.activeElement), 'License return focus missing');
      await page.locator('#about-tab').focus();
      await page.keyboard.press('ArrowRight');
      check(await page.locator('#input-tab').getAttribute('aria-selected') === 'true', 'Right must wrap to input');
      await page.keyboard.press('ArrowLeft');
      check(await page.locator('#about-tab').getAttribute('aria-selected') === 'true', 'Left must wrap to About');
      await page.keyboard.press('Home');
      check(await page.locator('#source').inputValue() === '保留文本', 'About changed source');
    }],
    ['About and pin honor countdown and the interrupting pointer gesture', async () => {
      check(await page.locator('#about-tab').count() === 1, 'About tab missing');
      await page.locator('#source').fill('abcdef'.repeat(100));
      await page.locator('#start').click();
      check(await page.locator('#about-tab').isDisabled(), 'About enabled during countdown');
      check(await page.locator('.pin').isDisabled(), 'Pin enabled during countdown');
      await page.keyboard.press('Escape');
      for (const selector of ['#about-tab', '.pin']) {
        await page.locator('#about-tab').click();
        await target();
        await page.keyboard.down('Control');
        await page.keyboard.down('Alt');
        await page.keyboard.down('F8');
        check(await page.locator('#input-tab').getAttribute('aria-selected') === 'true', 'Task start must show input');
        check(await page.locator('#target').evaluate(el => el === document.activeElement), 'Task start stole target focus');
        await page.keyboard.up('F8');
        await page.keyboard.up('Alt');
        await page.keyboard.up('Control');
        await waitState('typing');
        const box = await page.locator(selector).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        check(await state() === 'stopped', 'Pointer did not stop sending');
        check(await page.locator(selector).isDisabled(), 'Control enabled before interrupting mouse release');
        await page.mouse.up();
        check(await page.locator('#input-tab').getAttribute('aria-selected') === 'true', 'Interrupting gesture switched to About');
        check(await page.locator('.pin').getAttribute('aria-pressed') === 'false', 'Interrupting gesture pinned window');
      }
      await page.locator('.pin').click();
      check(await page.locator('.pin').getAttribute('aria-pressed') === 'true', 'Separate pin click failed');
    }],
    ['All panels and the license retain height at narrow widths and zoom', async () => {
      check(await page.locator('#about-tab').count() === 1, 'About tab missing');
      for (const width of [1180, 560, 390, 320]) {
        await page.setViewportSize({ width, height: 1200 });
        for (const height of [184, 320]) {
          await page.locator('#input-tab').click();
          await page.locator('#source').evaluate((el, value) => { el.style.height = value + 'px'; }, height);
          const input = await page.locator('.window').boundingBox();
          for (const tab of ['settings', 'about']) {
            await page.locator(`#${tab}-tab`).click();
            check((await page.locator('.window').boundingBox()).height === input.height, tab + ' changed window height');
          }
          await page.locator('#show-license').click();
          check((await page.locator('.window').boundingBox()).height === input.height, 'License changed window height');
          check(await page.locator('#license-view').evaluate(el => el.scrollHeight > el.clientHeight), 'License must scroll internally');
          await page.locator('#back-about').click();
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
        }
      }
      await page.setViewportSize({ width: 1952, height: 1216 });
      await page.evaluate(() => { document.body.style.zoom = '1.5'; });
      const about = await page.locator('.window').boundingBox();
      await page.locator('#input-tab').click();
      check((await page.locator('.window').boundingBox()).height === about.height, 'Zoom changed panel height');
    }],
    ['Interrupting on disabled Clear preserves source', async () => {
      const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(10);
      await page.locator('#source').fill(text);
      await target();
      await page.keyboard.press('Control+Alt+F8');
      await waitState('typing');
      check(await page.locator('#clear').isDisabled(), 'Clear must be disabled while typing');
      const box = await page.locator('#clear').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      check(await page.locator('#source').inputValue() === text, 'Interrupting click erased source');
      check(await state() === 'stopped', 'Interrupting click must leave stopped state');
      await page.locator('#clear').click();
      check(await page.locator('#source').inputValue() === '', 'A separate Clear click must work');
    }],
    ['Clear supports native undo, redo and subsequent editing', async () => {
      await page.locator('#source').click();
      await page.keyboard.type('Prepared text');
      await page.locator('#clear').click();
      await page.keyboard.press('Control+z');
      check(await page.locator('#source').inputValue() === 'Prepared text', 'Undo did not restore cleared text');
      check(await page.locator('#text-count').textContent() === '13 个字符', 'Undo did not refresh count');
      await page.keyboard.press('Control+y');
      check(await page.locator('#source').inputValue() === '', 'Redo did not clear text');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      await page.keyboard.press('Control+z');
      check(await page.locator('#source').inputValue() === 'Prepared text', 'Editing after undo lost restored text');
    }],
    ['Invalid settings show persistent field errors', async () => {
      await page.locator('#settings-tab').click();
      for (const [id, invalid, valid] of [['delay', '0', '5'], ['interval', '1.5', '50']]) {
        await page.locator('#' + id).fill(invalid);
        await page.locator('#shortcut').focus();
        const error = page.locator('#' + id + '-error');
        check(await error.isVisible(), id + ' field error is missing');
        check(await page.locator('#' + id).getAttribute('aria-invalid') === 'true', 'Missing invalid accessibility state');
        await page.locator('#input-tab').click();
        await page.locator('#source').fill('Text');
        await page.locator('#start').click();
        check(await error.isVisible(), 'Error disappeared after failed start');
        check(await page.locator('#' + id).evaluate(el => el === document.activeElement), 'Invalid control not focused');
        await page.locator('#' + id).fill(valid);
        check(!await error.isVisible(), 'Corrected error remains visible');
      }
      await page.locator('#delay').fill('');
      await page.locator('#restore').click();
      check(!await page.locator('#delay-error').isVisible(), 'Restore must clear validation');
    }],
    ['Countdown keeps input tab and cancel available', async () => {
      await page.locator('#source').fill('Text');
      await configure('#delay', '60');
      await page.locator('#start').click();
      check(await page.locator('#settings-tab').isDisabled(), 'Settings tab remains available during countdown');
      await page.locator('#input-tab').focus();
      await page.keyboard.press('ArrowRight');
      check(await page.locator('#input-panel').isVisible(), 'Keyboard switched away from countdown');
      check(await page.locator('#start').isVisible(), 'Cancel must remain visible');
      await page.keyboard.press('Escape');
      check(await state() === 'stopped', 'Escape must cancel countdown');
      check(await page.locator('#settings-tab').isEnabled(), 'Settings tab did not recover');
      await page.locator('#start').click();
      await page.locator('#start').click();
      check(await state() === 'stopped', 'Button must cancel countdown');
    }],
    ['Typing reports sent and total characters', async () => {
      await page.locator('#source').fill('abcdef'.repeat(30));
      await target();
      await page.keyboard.press('Control+Alt+F8');
      await waitState('typing');
      check(/已发送 \d+ \/ 180/.test(await page.locator('#status-message').textContent()), 'No numeric progress');
      await page.waitForFunction(() => /已发送 ([2-9]|\d{2,}) \/ 180/.test(document.querySelector('#status-message').textContent));
      await page.keyboard.press('x');
      check(await state() === 'stopped', 'Keyboard interruption failed');
    }],
    ['Countdown reserves footer space while keeping idle button small', async () => {
      await page.locator('#source').fill('Text');
      await configure('#delay', '60');
      const before = await page.locator('#status-message').boundingBox();
      const clearBefore = await page.locator('#clear').boundingBox();
      check((await page.locator('#start').boundingBox()).width === 72, 'Idle start button is not compact');
      await page.locator('#start').click();
      const after = await page.locator('#status-message').boundingBox();
      const clearAfter = await page.locator('#clear').boundingBox();
      check(before.x === after.x && before.width === after.width, 'Countdown moved or resized the message area');
      check(clearBefore.x === clearAfter.x, 'Countdown moved Clear');
      check(await page.locator('#start').evaluate(el => el.scrollWidth <= el.clientWidth), 'Countdown label clipped');
    }],
    ['Narrow settings use stacked labels and controls', async () => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.locator('#settings-tab').click();
      const rows = await page.locator('.setting-row').evaluateAll(els => els.map(el => {
        const label = el.querySelector('.setting-copy').getBoundingClientRect();
        const control = el.querySelector('.setting-value, select').getBoundingClientRect();
        return control.top >= label.bottom && control.width === el.getBoundingClientRect().width;
      }));
      check(rows.every(Boolean), 'Narrow controls must appear below labels at full width');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    }],
    ['Empty source and missing target prevent sending', async () => {
      await page.locator('#start').click();
      check(await state() === 'error', 'Empty source was accepted');
      await page.locator('#source').fill('Text');
      await configure('#delay', '1');
      await page.locator('#start').click();
      await waitState('stopped');
      check(await page.locator('#target').inputValue() === '', 'Missing target received text');
    }],
    ['Countdown outputs Chinese and newlines and preserves source', async () => {
      const text = '中文 Abc\n123';
      await page.locator('#source').fill(text);
      await configure('#delay', '1');
      if (!await page.locator('#target').isVisible()) await page.locator('.preview > summary').click();
      await page.locator('#start').click();
      await page.locator('#target').click();
      await waitState('done');
      check(await page.locator('#target').inputValue() === text, 'Output mismatch');
      check(await page.locator('#source').inputValue() === text, 'Source changed');
      check(await page.locator('#settings-tab').isEnabled(), 'Settings unavailable after completion');
    }],
    ['Shortcut waits for full release and stops on real input', async () => {
      await page.locator('#source').fill('abcdef'.repeat(30));
      await target();
      await page.keyboard.down('Control');
      await page.keyboard.down('Alt');
      await page.keyboard.down('F8');
      check(await state() === 'arming', 'Shortcut did not arm');
      await page.keyboard.up('F8');
      check(await state() === 'arming', 'Shortcut started before modifiers released');
      await page.keyboard.up('Alt');
      await page.keyboard.up('Control');
      await waitState('typing');
      await page.mouse.move(20, 20);
      check(await state() === 'typing', 'Mouse movement interrupted typing');
      await page.mouse.click(20, 20);
      check(await state() === 'stopped', 'Mouse click did not interrupt');
      await target();
      await page.keyboard.press('Control+Alt+F8');
      await waitState('typing');
      await page.keyboard.press('Control+Alt+F8');
      check(await state() === 'stopped', 'Repeated shortcut restarted instead of stopping');
      await page.keyboard.press('Control+Alt+F8');
      await waitState('typing');
      await page.keyboard.press('x');
      check(await state() === 'stopped', 'Real key did not interrupt');
      check((await page.locator('#target').inputValue()).endsWith('x'), 'Real key was consumed');
    }],
    ['Changed shortcut and default restoration work', async () => {
      await page.locator('#source').fill('ABC');
      await page.locator('#settings-tab').click();
      await page.locator('#delay').fill('8');
      await page.locator('#interval').fill('80');
      await page.locator('#shortcut').selectOption('F10');
      await page.locator('#input-tab').click();
      check((await page.locator('#status-message').textContent()).includes('8 秒'), 'Delay summary stale');
      await target();
      await page.keyboard.press('Control+Alt+F10');
      await waitState('done');
      check(await page.locator('#target').inputValue() === 'ABC', 'Changed shortcut failed');
      await page.locator('#settings-tab').click();
      await page.locator('#restore').click();
      check(await page.locator('#delay').inputValue() === '5', 'Delay default');
      check(await page.locator('#interval').inputValue() === '50', 'Interval default');
      check(await page.locator('#shortcut').inputValue() === 'F8', 'Shortcut default');
    }],
    ['Narrow editor uses the shared panel height', async () => {
      for (const width of [420, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const editor = await page.locator('#source').boundingBox();
        const meta = await page.locator('.editor-meta').boundingBox();
        const footer = await page.locator('.footer').boundingBox();
        check(editor.height > 184, 'Narrow editor must use the additional panel space');
        check(footer.y - meta.y - meta.height <= 16, 'Unused space separates text metadata from the footer');
        await page.locator('#settings-tab').click();
        const settings = await page.locator('.window').boundingBox();
        await page.locator('#input-tab').click();
        check(settings.height === (await page.locator('.window').boundingBox()).height, 'Filling editor changed tab height');
      }
    }],
    ['Medium windows give status its own row', async () => {
      await page.setViewportSize({ width: 560, height: 900 });
      await page.locator('#source').fill('Text');
      await configure('#delay', '60');
      const before = await page.locator('#status-message').boundingBox();
      const clearBefore = await page.locator('#clear').boundingBox();
      check(clearBefore.y >= before.y + before.height, 'Medium window still squeezes status beside buttons');
      await page.locator('#start').click();
      const after = await page.locator('#status-message').boundingBox();
      const clearAfter = await page.locator('#clear').boundingBox();
      check(before.x === after.x && before.width === after.width, 'Countdown changed status width');
      check(clearBefore.x === clearAfter.x && clearBefore.y === clearAfter.y, 'Countdown shifted Clear');
      const start = await page.locator('#start').boundingBox();
      const slot = await page.locator('.start-slot').boundingBox();
      check(start.x >= slot.x && start.width <= slot.width, 'Countdown exceeds its reserved space');
    }],
    ['Status messages keep idle typography and layout across task states', async () => {
      for (const width of [1180, 560, 390, 320]) {
        await page.reload();
        await page.setViewportSize({ width, height: 1200 });
        const appearance = () => page.locator('#status-message').evaluate(el => {
          const typography = node => {
            const style = getComputedStyle(node);
            return [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing];
          };
          return {
            typography: [el, ...el.querySelectorAll('*')].map(typography),
            boxes: ['.window', '.footer', '#status-message', '#clear'].map(selector => {
              const box = document.querySelector(selector).getBoundingClientRect();
              return [box.x + scrollX, box.y + scrollY, box.width, box.height];
            }),
          };
        });
        const idle = await appearance();
        const verify = async (expected, text) => {
          check(await state() === expected, 'Unexpected task state: ' + expected);
          check((await page.locator('#status-message').textContent()).includes(text), 'Missing status text: ' + text);
          const current = await appearance();
          check(current.typography.every(style => JSON.stringify(style) === JSON.stringify(idle.typography[0])), expected + ' typography differs from idle');
          check(JSON.stringify(current.boxes) === JSON.stringify(idle.boxes), expected + ' moved or resized the footer at width ' + width);
        };
        await page.locator('#start').click();
        await verify('error', '请先填写文本');
        await page.locator('#source').fill('AB');
        await configure('#interval', '1000');
        await page.locator('#start').click();
        await verify('countdown', '等待输入');
        await page.locator('#start').click();
        await verify('stopped', '已取消');
        await target();
        await page.keyboard.down('Control');
        await page.keyboard.down('Alt');
        await page.keyboard.down('F8');
        await verify('arming', '等待按键释放');
        await page.keyboard.up('F8');
        await page.keyboard.up('Alt');
        await page.keyboard.up('Control');
        await waitState('typing');
        await verify('typing', '已发送 1 / 2');
        await waitState('done');
        await verify('done', '已完成');
        await target();
        await page.keyboard.press('Control+Alt+F8');
        await waitState('typing');
        await page.keyboard.press('x');
        await verify('stopped', '已中止');
        await page.locator('#clear').click();
        await verify('idle', 'Ctrl+Z');
        await page.locator('#source').fill('New text');
        await verify('idle', '点击后等待');
      }
    }],
    ['Status text is vertically centered with buttons at both zoom levels', async () => {
      for (const zoom of [1, 1.5]) {
        await page.setViewportSize({ width: 1952, height: 1200 });
        await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
        for (const text of ['点击后等待 5 秒，请在此期间选择输入位置。', '已完成，已发送 3 个字符', '已中止，已发送 123456 个字符，剩余内容已取消']) {
          const offset = await page.locator('#status-message').evaluate((el, value) => {
            el.textContent = value;
            const range = document.createRange();
            range.selectNodeContents(el);
            const textBox = range.getBoundingClientRect();
            const buttons = document.querySelector('.footer-actions').getBoundingClientRect();
            return Math.abs(textBox.top + textBox.height / 2 - buttons.top - buttons.height / 2);
          }, text);
          check(offset <= 2 * zoom, 'Status text is not vertically centered: offset ' + offset);
        }
      }
    }],
    ['Placeholder text meets normal text contrast', async () => {
      const ratio = await page.locator('#source').evaluate(el => {
        const luminance = color => {
          const [r, g, b] = color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const foreground = luminance(getComputedStyle(el, '::placeholder').color);
        const background = luminance(getComputedStyle(el).backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      check(ratio >= 4.5, 'Placeholder contrast is below 4.5:1: ' + ratio.toFixed(2));
    }],
    ['Panel height is stable across sizes and editor resize', async () => {
      for (const width of [1180, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const sourceHeight of [184, 320]) {
          await page.locator('#input-tab').click();
          await page.locator('#source').evaluate((el, height) => { el.style.height = height + 'px'; }, sourceHeight);
          const input = await page.locator('.window').boundingBox();
          await page.locator('#settings-tab').click();
          const settings = await page.locator('.window').boundingBox();
          check(input.height === settings.height, 'Panel height changed');
          check(!await page.locator('#start').isVisible(), 'Input actions visible on settings');
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
        }
      }
      await page.setViewportSize({ width: 1952, height: 1216 });
      await page.evaluate(() => { document.body.style.zoom = '1.5'; });
      const settings = await page.locator('.window').boundingBox();
      await page.locator('#input-tab').click();
      check(settings.height === (await page.locator('.window').boundingBox()).height, 'Zoom panel height changed');
    }],
  ];
  try {
    for (const [name, test] of cases) {
      try {
        await page.keyboard.up('F8');
        await page.keyboard.up('Alt');
        await page.keyboard.up('Control');
        await page.reload();
        await page.setViewportSize({ width: 1180, height: 960 });
        await test();
        results.push({ name, passed: true });
      } catch (error) {
        results.push({ name, passed: false, error: error.message });
      }
    }
    results.push({ name: 'No browser JavaScript errors', passed: errors.length === 0, errors });
    return { passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
  } finally {
    page.off('pageerror', onError);
    await page.reload();
  }
}
