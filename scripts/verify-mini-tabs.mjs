import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true }); const directory = mkdtempSync(path.join(qa, 'mini-tabs-'));
const { createUserStore } = require('../electron/user-store.cjs');
createUserStore(directory).settings({ versionId: 27, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F4' });
const launch = JSON.parse(readFileSync(path.join(root, '.vscode/launch.json'), 'utf8'));
const mainConfig = launch.configurations.find(value => value.type === 'node');
const expand = value => value.replaceAll('${workspaceFolder}', root);
const env = { ...process.env, ...Object.fromEntries(Object.entries(mainConfig.env).filter(([, value]) => value !== null).map(([key, value]) => [key, expand(value)])),
  POKEDEX_USER_DATA: directory, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1' };
for (const [key, value] of Object.entries(mainConfig.env)) if (value === null) delete env[key];
const checks = [], errors = [], debug = {}; let desktop, main, mini;
async function start() {
  desktop = await electron.launch({ executablePath: expand(mainConfig.runtimeExecutable), args: [...mainConfig.runtimeArgs, root], cwd: root, env, timeout: 45000 });
  main = await desktop.firstWindow(); main.setDefaultTimeout(15000); main.on('pageerror', error => errors.push(error.message));
  await main.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
  const waiting = desktop.waitForEvent('window'); await main.getByRole('button', { name: '迷你图鉴', exact: true }).click();
  mini = await waiting; mini.setDefaultTimeout(15000); mini.on('pageerror', error => errors.push(error.message));
  await mini.waitForSelector('.mini-panel');
}
async function capture(name) {
  const snapshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, mini.url());
  await snapshot(); await mini.waitForTimeout(150); await snapshot(); await mini.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await snapshot(), 'base64'));
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
const settings = () => mini.evaluate(() => window.pokedex.user('get'));
async function search(text, name) {
  const input = mini.getByRole('combobox', { name: '迷你统一搜索', exact: true });
  await input.fill(text); await mini.getByRole('option', { name, exact: true }).click();
}
async function pinEntity(text, kind, name) {
  await search(text, '打开' + kind + name);
  await expect(mini.locator('.entity-modal h1')).toHaveText(name);
  await mini.getByRole('button', { name: '固定为标签', exact: true }).click();
  await expect(mini.getByRole('dialog')).toHaveCount(0);
  await expect(mini.locator('.mini-entity-panel h1')).toHaveText(name);
}
async function bounds() {
  const value = await mini.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return { width: innerWidth, height: innerHeight, title: rect(document.querySelector('.mini-titlebar')), tabs: rect(document.querySelector('.mini-tabs')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.querySelector('.mini-tab-content').scrollWidth - document.querySelector('.mini-tab-content').clientWidth };
  });
  expect(value.overflow).toBeLessThanOrEqual(2); expect(value.bodyOverflow).toBeLessThanOrEqual(2);
  expect(value.title.top).toBeGreaterThanOrEqual(0); expect(value.title.right).toBeLessThanOrEqual(value.width);
  expect(value.tabs.left).toBeGreaterThanOrEqual(0); expect(value.tabs.right).toBeLessThanOrEqual(value.width); expect(value.tabs.bottom).toBeLessThan(value.height);
}
try {
  await check('F5 配置启动 Electron，主进程与界面调试端口可用，源码映射含 TSX', async () => {
    const tasks = JSON.parse(readFileSync(path.join(root, '.vscode/tasks.json'), 'utf8')).tasks;
    const task = tasks.find(value => value.label === launch.compounds[0].preLaunchTask);
    expect(task.args).toContain('--sourcemap'); expect(existsSync(expand(mainConfig.runtimeExecutable))).toBe(true);
    const maps = readdirSync(path.join(root, 'dist/assets')).filter(file => file.endsWith('.js.map'));
    expect(maps.length).toBeGreaterThan(0);
    const map = JSON.parse(readFileSync(path.join(root, 'dist/assets', maps[0]), 'utf8'));
    expect(map.sources).toContain('../../src/MiniTabs.tsx'); expect(map.sources).toContain('../../src/App.tsx');
    await start();
    debug.mainPort = await desktop.evaluate(() => process.debugPort); expect(debug.mainPort).toBeGreaterThan(0);
    const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    debug.targets = targets.filter(value => value.type === 'page').map(value => value.url);
    expect(debug.targets.some(value => value.includes('/dist/index.html'))).toBe(true);
    const session = await main.context().newCDPSession(main), scripts = [];
    session.on('Debugger.scriptParsed', value => { if (value.sourceMapURL) scripts.push(value.sourceMapURL); });
    await session.send('Debugger.enable');
    expect(scripts.some(value => value.endsWith('.js.map'))).toBe(true); await session.detach();
  });
  await check('四类资料可手动固定、去重、切换和关闭，临时搜索不覆盖标签，版本切换保留不可用标签', async () => {
    await search('皮卡丘', '打开宝可梦皮卡丘'); await expect(mini.locator('.mini-panel h1')).toHaveText('皮卡丘');
    await mini.getByRole('button', { name: '固定当前宝可梦', exact: true }).click();
    await expect(mini.getByRole('tab', { name: '宝可梦标签：皮卡丘', exact: true })).toHaveAttribute('aria-selected', 'true');
    await pinEntity('威吓', '特性', '威吓'); await pinEntity('十万伏特', '招式', '十万伏特'); await pinEntity('雷之石', '道具', '雷之石');
    expect((await settings()).settings.miniTabs).toHaveLength(4);
    await pinEntity('十万伏特', '招式', '十万伏特'); expect((await settings()).settings.miniTabs).toHaveLength(4);
    await mini.getByRole('tab', { name: '宝可梦标签：皮卡丘', exact: true }).click(); await expect(mini.locator('.mini-panel h1')).toHaveText('皮卡丘');
    await mini.getByRole('tab', { name: '特性标签：威吓', exact: true }).click(); await expect(mini.locator('.mini-entity-panel h1')).toHaveText('威吓');
    await search('雷丘', '打开宝可梦雷丘'); await expect(mini.locator('.mini-panel h1')).toHaveText('雷丘');
    await expect(mini.getByRole('tab', { name: '临时查询', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect((await settings()).settings.miniTabs).toHaveLength(4);
    await mini.getByRole('button', { name: '关闭固定标签威吓', exact: true }).click();
    await expect(mini.getByRole('tab', { name: '特性标签：威吓', exact: true })).toHaveCount(0);
    await mini.getByRole('tab', { name: '道具标签：雷之石', exact: true }).click();
    await mini.getByRole('button', { name: '关闭固定标签雷之石', exact: true }).click();
    await expect(mini.getByRole('tab', { name: '临时查询', exact: true })).toHaveAttribute('aria-selected', 'true');
    await search('赛富豪', '打开宝可梦赛富豪'); await expect(mini.locator('.mini-panel h1')).toHaveText('赛富豪');
    await mini.getByRole('button', { name: '固定当前宝可梦', exact: true }).click();
    await mini.getByLabel('迷你图鉴规则版本').selectOption('6');
    await expect(mini.getByRole('heading', { name: '当前版本没有此宝可梦', exact: true })).toBeVisible();
    await mini.getByRole('tab', { name: '招式标签：十万伏特', exact: true }).click(); await expect(mini.locator('.mini-entity-panel .entity-metrics')).toContainText('95');
    await mini.getByLabel('迷你图鉴规则版本').selectOption('1');
    await mini.getByRole('tab', { name: '宝可梦标签：赛富豪', exact: true }).click();
    await mini.getByLabel('迷你图鉴规则版本').selectOption('27'); await expect(mini.locator('.mini-panel h1')).toHaveText('赛富豪');
    await bounds();
  });
  await check('200% 字号最小窗口支持标签键盘与滚动，固定按钮不遮挡关闭，重启保留标签', async () => {
    await main.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await desktop.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url); window.setSize(...window.getMinimumSize());
    }, mini.url());
    for (const [kind, id, name] of [['items', 83, '雷之石'], ['abilities', 22, '威吓'], ['moves', 89, '地震'], ['pokemon', 130, '暴鲤龙']])
      await mini.evaluate(value => window.pokedex.user('mini-pin', value), { kind, id, name });
    await mini.getByRole('tab', { name: '临时查询', exact: true }).click();
    await mini.getByRole('tab', { name: '临时查询', exact: true }).press('ArrowRight');
    await expect(mini.getByRole('tab', { name: '宝可梦标签：皮卡丘', exact: true })).toHaveAttribute('aria-selected', 'true');
    await mini.getByRole('tab', { name: '宝可梦标签：皮卡丘', exact: true }).press('End');
    await expect(mini.getByRole('tab', { name: '宝可梦标签：暴鲤龙', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(mini.locator('.mini-panel h1')).toHaveText('暴鲤龙');
    await mini.locator('.ability-card').filter({ hasText: '威吓' }).click();
    const modalBounds = await mini.locator('.entity-modal').evaluate(element => {
      const box = value => { const r = value.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return { modal: box(element), close: box(element.querySelector('.modal-close')), pin: box(element.querySelector('.mini-modal-pin')), width: innerWidth, height: innerHeight };
    });
    for (const rect of [modalBounds.modal, modalBounds.close, modalBounds.pin]) { expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(modalBounds.width); expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(modalBounds.height); }
    expect(modalBounds.pin.right).toBeLessThanOrEqual(modalBounds.close.left + 1);
    await mini.getByRole('button', { name: '固定为标签', exact: true }).click();
    await expect(mini.locator('.mini-entity-panel h1')).toHaveText('威吓'); await bounds(); await capture('mini-tabs-large');
    const pinned = (await settings()).settings.miniTabs;
    await desktop.close(); await start();
    expect((await settings()).settings.miniTabs).toEqual(pinned);
    await expect(mini.getByRole('tab')).toHaveCount(pinned.length + 1);
    await mini.getByRole('tab', { name: '招式标签：十万伏特', exact: true }).click(); await expect(mini.locator('.mini-entity-panel h1')).toHaveText('十万伏特');
  });
  expect(errors).toEqual([]);
} catch (error) { if (mini) await capture('mini-tabs-failure').catch(() => {}); errors.push(error.message); throw error; }
finally { writeFileSync(path.join(qa, 'mini-tabs-ui-report.json'), JSON.stringify({ directory, checks, errors, debug }, null, 2)); await desktop?.close(); }
