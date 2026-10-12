import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.qa/display-user');
mkdirSync(directory, { recursive: true });
// An existing 0.1.0 preference file deliberately has no uiScale field.
writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify({ favorites: [25], history: [], notes: { 25: '旧版的培养笔记' }, settings: { versionId: 27, theme: 'light', imageStyle: 'artwork', shortcut: 'Ctrl+Alt+Shift+F11', keepOnTop: false } }));
const packaged = process.argv.includes('--packaged');
const executablePath = packaged ? path.join(root, 'release/Pokedex-win32-x64/Pokedex.exe') : require('electron');
const env = { ...process.env, POKEDEX_USER_DATA: directory, POKEDEX_HEADLESS: '1', POKEDEX_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
let desktop;
const checks = [];
const errors = [];
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function launch() {
  desktop = await electron.launch({ executablePath, args: packaged ? [] : [root], env, cwd: root });
  const page = await desktop.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1');
  return page;
}
async function snapshot(page, name) {
  const capture = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  }, page.url());
  await capture(); await page.waitForTimeout(200); await capture(); await page.waitForTimeout(150);
  writeFileSync(path.join(root, `.qa/${name}.png`), Buffer.from(await capture(), 'base64'));
}
try {
  let page = await launch();
  await check('旧版偏好自动使用 125%，正文和辅助文字明显增大', async () => {
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1.25);
    const state = await page.evaluate(() => window.pokedex.user('get'));
    expect(state.settings.uiScale).toBe(125); expect(state.favorites).toEqual([25]); expect(state.notes[25]).toBe('旧版的培养笔记');
    const fonts = await page.evaluate(() => ({ name: parseFloat(getComputedStyle(document.querySelector('.row-name strong')).fontSize), secondary: parseFloat(getComputedStyle(document.querySelector('.row-name > span')).fontSize) }));
    expect(fonts.name).toBeGreaterThanOrEqual(16); expect(fonts.secondary).toBeGreaterThanOrEqual(12);
  });
  await snapshot(page, 'display-default-125');
  await page.getByRole('button', { name: /设置/ }).click();
  await check('五个缩放档位通过设置立即生效，并拒绝无效档位', async () => {
    for (const scale of [100, 125, 150, 175, 200]) {
      await page.getByLabel('界面缩放', { exact: true }).selectOption(String(scale));
      await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(scale / 100, 6);
      await expect(page.getByLabel('界面缩放', { exact: true })).toHaveValue(String(scale));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    const rejected = await page.evaluate(async () => { try { await window.pokedex.user('settings', { uiScale: 350 }); return false; } catch { return true; } });
    expect(rejected).toBe(true);
  });
  await snapshot(page, 'display-settings-200');
  await check('大缩放下能在列表、详情和资料字典间返回，内容不横向溢出', async () => {
    await page.getByRole('button', { name: '宝可梦图鉴', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索宝可梦', exact: true }).fill('6');
    await page.locator('.pokemon-row-main').click();
    await expect(page.getByRole('heading', { name: '喷火龙', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回宝可梦列表' }).click();
    await expect(page.locator('.catalog-panel')).toBeVisible();
    await page.getByRole('button', { name: '招式图鉴', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索招式图鉴' }).fill('十万伏特');
    await page.locator('.dictionary-row').click();
    await expect(page.getByRole('heading', { name: '十万伏特', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回资料列表' }).click();
    await expect(page.locator('.dictionary-list-panel')).toBeVisible();
  });
  await check('2K 与 4K 窗口尺寸下，大字模式保留双栏并正常显示', async () => {
    for (const [width, height, scale, name] of [[2560, 1440, 150, 'display-2k-150'], [3840, 2160, 200, 'display-4k-200']]) {
      await desktop.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(bounds[0], bounds[1]), [width, height]);
      await page.evaluate(scale => window.pokedex.user('settings', { uiScale: scale }), scale);
      await page.getByRole('button', { name: '宝可梦图鉴', exact: true }).click();
      await expect(page.locator('.catalog-panel')).toBeVisible(); await expect(page.locator('.detail-scroll')).toBeVisible();
      const layout = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, detailRight: document.querySelector('.detail-scroll').getBoundingClientRect().right }));
      expect(layout.overflow).toBeLessThanOrEqual(1); expect(layout.detailRight).toBeLessThanOrEqual(layout.width + 1);
      await snapshot(page, name);
    }
  });
  let mini;
  await check('迷你窗口同步缩放并扩展宽度，保留清晰布局', async () => {
    const waiting = desktop.waitForEvent('window'); await page.getByRole('button', { name: '迷你图鉴', exact: true }).click(); mini = await waiting;
    await mini.waitForSelector('.mini-panel');
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => w.webContents.getZoomFactor() === 2))).toBe(true);
    const size = await mini.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    expect(size.width).toBeGreaterThanOrEqual(380); expect(size.overflow).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: /设置/ }).click(); await page.getByLabel('界面缩放', { exact: true }).selectOption('150');
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => w.webContents.getZoomFactor() === 1.5))).toBe(true);
    await snapshot(mini, 'display-mini-150');
  });
  await check('缩放重启后保持，并可一键恢复 125%', async () => {
    await desktop.close(); desktop = null; page = await launch();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1.5);
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.favorites).toEqual([25]); expect(state.notes[25]).toBe('旧版的培养笔记');
    await page.getByRole('button', { name: /设置/ }).click(); await expect(page.getByLabel('界面缩放', { exact: true })).toHaveValue('150');
    await page.getByRole('button', { name: '恢复推荐大小 · 125%' }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1.25);
  });
  expect(errors).toEqual([]);
  writeFileSync(path.join(root, '.qa', packaged ? 'packaged-display-report.json' : 'display-report.json'), JSON.stringify({ checks, rendererErrors: errors }, null, 2));
} catch (error) { if (desktop) await snapshot(await desktop.firstWindow(), 'display-failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
