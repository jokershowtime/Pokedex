import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true });
const userData = path.join(qa, 'desktop-user');
mkdirSync(userData, { recursive: true });
writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({ favorites: [], history: [], notes: {}, settings: { versionId: 27, theme: 'light', imageStyle: 'artwork', shortcut: 'Ctrl+Alt+P', keepOnTop: false } }));
const packaged = process.argv.includes('--packaged');
const executablePath = packaged ? path.join(root, 'release/Pokedex-win32-x64/Pokedex.exe') : require('electron');
const environment = { ...process.env, POKEDEX_USER_DATA: userData, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.POKEDEX_DEV_URL;
const assertions = [];
const errors = [];
let desktop;
async function check(label, fn) { await fn(); assertions.push(label); console.log(`PASS ${label}`); }
async function screenshot(page, filename) {
  // Chromium's CDP screenshot stalls for hidden Windows topmost windows.
  // Electron's capturePage explicitly supports hidden capture without showing the UI.
  const capture = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    if (!window) throw new Error('无法找到待截图的图鉴窗口。');
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  }, page.url());
  await capture();
  await page.waitForTimeout(150);
  const png = await capture();
  writeFileSync(filename, Buffer.from(png, 'base64'));
}
async function launch() {
  const instance = await electron.launch({ executablePath, args: packaged ? [] : [root], cwd: root, env: environment, timeout: 45000 });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  writeFileSync(path.join(qa, 'test-process.json'), JSON.stringify({ pid: instance.process().pid, executablePath }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('.pokemon-row', { timeout: 45000 });
  await page.getByRole('heading', { name: '喷火龙', exact: true }).waitFor();
  return { instance, page };
}
try {
  let launched = await launch(); desktop = launched.instance; let page = launched.page;
  await check('桌面版离线启动并显示 1025 只中文宝可梦', async () => {
    await expect(page.locator('.pokemon-row')).toHaveCount(1025);
    await expect(page.locator('.hero-art img')).toBeVisible();
    await expect.poll(() => page.locator('.hero-art img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  });
  await screenshot(page, path.join(qa, packaged ? 'packaged-light.png' : 'desktop-light.png'));
  await check('中文、拼音、首字母和编号搜索；方向键切换结果', async () => {
    const search = page.getByRole('textbox', { name: '搜索宝可梦', exact: true });
    for (const query of ['皮卡丘', 'pikaqiu', 'pkq', '0025']) {
      await search.fill(query); await expect(page.locator('.pokemon-row')).toHaveCount(1);
      await search.press('ArrowDown'); await expect(page.getByRole('heading', { name: '皮卡丘', exact: true })).toBeVisible();
    }
    await search.fill('暴蝾螈'); await expect(page.locator('.pokemon-row strong')).toHaveText('暴飞龙');
    await search.fill('不存在的宝可梦'); await expect(page.getByRole('heading', { name: '没有找到对应的宝可梦' })).toBeVisible();
    await search.fill('6'); await page.locator('.pokemon-row-main').click();
  });
  await check('收藏和笔记保存', async () => {
    await page.getByRole('button', { name: '收藏当前宝可梦', exact: true }).click();
    const notes = page.getByRole('textbox', { name: '宝可梦笔记' });
    await notes.fill('首版验证：喷火龙，注意四倍岩石弱点。');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.getByRole('button', { name: /我的收藏/ }).click();
    await expect(page.locator('.pokemon-row')).toHaveCount(1);
    await expect(page.locator('.pokemon-row strong')).toHaveText('喷火龙');
  });
  await check('GBA 规则切换与历史种族值', async () => {
    await page.getByRole('button', { name: '宝可梦图鉴', exact: true }).click();
    await page.getByLabel('官方规则版本', { exact: true }).selectOption('6');
    await page.getByRole('textbox', { name: '搜索宝可梦', exact: true }).fill('25');
    await expect(page.locator('.pokemon-row')).toHaveCount(1);
    await page.locator('.pokemon-row-main').click();
    await expect(page.locator('.hero-metrics')).toContainText('300');
    await expect(page.locator('.ability-card')).toHaveCount(1);
    await page.getByRole('textbox', { name: '搜索宝可梦', exact: true }).fill('6'); await page.locator('.pokemon-row-main').click();
    await expect(page.locator('.matchup-group.weak .matchup-values')).toContainText('×4');
  });
  await check('完整进化链和招式详情联动', async () => {
    await page.getByRole('button', { name: '进化链', exact: true }).click();
    await expect(page.locator('.evolution-edge')).toHaveCount(2);
    await expect(page.locator('.evolution-condition')).toContainText(['等级达到 16', '等级达到 36']);
    await page.getByRole('button', { name: /招式学习/ }).click();
    await expect(page.locator('.move-table tbody tr')).toHaveCount(61);
    await page.getByRole('textbox', { name: '筛选学习招式' }).fill('喷射火焰');
    await page.locator('.move-table tbody tr').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '喷射火焰', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭资料详情' }).click();
  });
  await check('招式、特性、道具图鉴的独立查询', async () => {
    for (const [kind, nav, query, expected] of [['moves', '招式图鉴', '十万伏特', '十万伏特'], ['abilities', '特性图鉴', '静电', '静电'], ['items', '道具图鉴', '雷之石', '雷之石']]) {
      await page.getByRole('button', { name: nav, exact: true }).click();
      await page.getByRole('textbox', { name: `搜索${nav}` }).fill(query);
      await page.locator('.dictionary-row').first().click();
      await expect(page.locator('.entity-hero h1')).toHaveText(expected);
      await expect(page.locator('.entity-description')).not.toBeEmpty();
    }
  });
  await check('属性克制工具支持单双属性与快速选择', async () => {
    await page.getByRole('button', { name: '属性克制', exact: true }).click();
    await expect(page.locator('.matchup-result .weak')).toContainText('岩石');
    await expect(page.locator('.matchup-result .weak')).toContainText('×4');
    await page.getByRole('textbox', { name: '克制工具搜索宝可梦' }).fill('巨沼怪');
    await page.locator('.preset-pokemon button').first().click();
    await expect(page.locator('.matchup-result .weak')).toContainText('草');
    await expect(page.locator('.matchup-result .weak')).toContainText('×4');
  });
  await check('深色主题、像素图、置顶与自定义快捷键', async () => {
    await page.getByRole('button', { name: /设置/ }).click();
    await page.getByRole('button', { name: /深色 · 夜间/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('详情图片风格').selectOption('sprite');
    await page.getByRole('switch', { name: '完整窗口置顶' }).click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    await page.getByRole('textbox', { name: '迷你图鉴全局快捷键' }).fill('Ctrl+Alt+Shift+F9');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect.poll(() => desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+Shift+F9'))).toBe(true);
    await page.getByRole('button', { name: '宝可梦图鉴', exact: true }).click();
    await page.getByRole('button', { name: '基础资料', exact: true }).click();
    await expect(page.locator('.hero-art img')).toHaveClass(/pixel/);
    await screenshot(page, path.join(qa, packaged ? 'packaged-dark.png' : 'desktop-dark.png'));
  });
  await check('迷你窗口可查询，默认置顶并与完整窗口共享收藏', async () => {
    const waiting = desktop.waitForEvent('window');
    await page.getByRole('button', { name: '迷你图鉴', exact: true }).click();
    const mini = await waiting;
    mini.on('pageerror', error => errors.push(error.message));
    await mini.waitForSelector('.mini-panel');
    const search = mini.getByRole('textbox', { name: '搜索宝可梦', exact: true });
    await search.fill('25'); await mini.locator('.mini-results .pokemon-row-main').click();
    await expect(mini.getByRole('heading', { name: '皮卡丘', exact: true })).toBeVisible();
    await mini.getByRole('button', { name: '收藏当前宝可梦', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.pokedex.user('get')).favorites.includes(25))).toBe(true);
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => window.isAlwaysOnTop()))).toBe(true);
    await screenshot(mini, path.join(qa, packaged ? 'packaged-mini.png' : 'desktop-mini.png'));
  });
  const saved = JSON.parse(readFileSync(path.join(userData, 'preferences.json'), 'utf8'));
  await desktop.close(); desktop = null;
  await check('重新启动后保留收藏、笔记、主题和 GBA 规则', async () => {
    launched = await launch(); desktop = launched.instance; page = launched.page;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByLabel('官方规则版本', { exact: true })).toHaveValue('6');
    await expect(page.getByRole('textbox', { name: '宝可梦笔记' })).toHaveValue('首版验证：喷火龙，注意四倍岩石弱点。');
    await page.getByRole('button', { name: /我的收藏/ }).click();
    await expect(page.locator('.pokemon-row')).toHaveCount(2);
  });
  if (errors.length) throw new Error(`Renderer errors: ${errors.join('\n')}`);
  writeFileSync(path.join(qa, packaged ? 'packaged-ui-report.json' : 'ui-report.json'), JSON.stringify({ passed: assertions, rendererErrors: errors, savedPreferences: saved }, null, 2));
  console.log(`完成 ${assertions.length} 项实际桌面使用验证，无渲染错误。`);
} catch (error) {
  if (desktop) { const page = await desktop.firstWindow(); await screenshot(page, path.join(qa, 'failure.png')).catch(() => {}); }
  console.error(error); process.exitCode = 1;
} finally { if (desktop) await desktop.close(); }
