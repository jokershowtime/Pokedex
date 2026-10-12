import { _electron as electron } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.qa/preview-user');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify({ favorites: [], history: [], notes: {}, settings: { versionId: 27, theme: 'light', imageStyle: 'artwork', shortcut: 'Ctrl+Alt+Shift+F10', keepOnTop: false } }));
const env = { ...process.env, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ executablePath: path.join(root, 'release/Pokedex-win32-x64/Pokedex.exe'), env, cwd: root });
async function snapshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const capture = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url);
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  }, page.url());
  await capture();
  await page.waitForTimeout(250);
  await capture();
  await page.waitForTimeout(150);
  writeFileSync(path.join(root, `.qa/${name}.png`), Buffer.from(await capture(), 'base64'));
  console.log(`预览已保存：${name}.png`);
}
try {
  const page = await desktop.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForSelector('.pokemon-panel h1');
  await snapshot(page, 'preview-light');
  await page.evaluate(() => window.pokedex.user('settings', { theme: 'dark', imageStyle: 'sprite', versionId: 6 }));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.querySelector('.hero-art img')?.getAttribute('src')?.includes('/emerald/'));
  await snapshot(page, 'preview-dark');
  const waiting = desktop.waitForEvent('window');
  await page.evaluate(() => window.pokedex.window('mini'));
  const mini = await waiting;
  mini.setDefaultTimeout(15000);
  await mini.waitForSelector('.mini-panel');
  await mini.getByRole('textbox', { name: '搜索宝可梦', exact: true }).fill('25');
  await mini.locator('.mini-results .pokemon-row-main').click();
  await mini.getByRole('heading', { name: '皮卡丘', exact: true }).waitFor();
  await snapshot(mini, 'preview-mini');
} finally { await desktop.close(); }
