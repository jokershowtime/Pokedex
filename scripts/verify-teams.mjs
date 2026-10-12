import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true });
const folder = mkdtempSync(path.join(qa, 'team-ui-user-'));
writeFileSync(path.join(folder, 'preferences.json'), JSON.stringify({ favorites: [25], history: [], notes: { 25: '队伍功能上线前的笔记' },
  settings: { versionId: 27, theme: 'light', imageStyle: 'artwork', shortcut: 'Ctrl+Alt+Shift+F11', keepOnTop: false, uiScale: 125 } }));
// The --live mode starts with no cache and verifies actual API requests.
if (!process.argv.includes('--live')) {
  const cache = path.join(folder, 'team-cache'); mkdirSync(cache);
  for (const key of ['index', 'gen9ou', 'gen9doublesou', 'gen3ou']) {
    const source = path.join(qa, 'team-source', key + '.json');
    if (!existsSync(source)) throw new Error('缺少真实队伍样例，请先使用 --live 验证或读取来源数据。');
    const raw = JSON.parse(readFileSync(source, 'utf8'));
    const data = key === 'index' ? Object.fromEntries(Object.entries(raw).filter(([id]) => ['gen9ou', 'gen9doublesou', 'gen3ou'].includes(id))) : raw;
    writeFileSync(path.join(cache, key + '.json'), JSON.stringify({ schemaVersion: 1, key, fetchedAt: new Date().toISOString(), data }));
  }
}
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_TEAM_SOURCES: 'samples' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
const errors = [], checks = []; let desktop, page, savedId, exported;
async function launch() {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { timeout: 45000 });
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function screenshot(name) {
  const capture = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    const picture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return picture.toPNG().toString('base64');
  }, page.url());
  await capture(); await page.waitForTimeout(200); await capture(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await capture(), 'base64'));
}
try {
  await launch(); await page.getByRole('button', { name: '队伍推荐', exact: true }).click();
  await page.getByLabel('推荐队伍规则', { exact: true }).selectOption('gen9ou');
  await check('真实样例队伍展示六人、中文道具、作者与规则；支持成员拼音搜索', async () => {
    await page.waitForSelector('.team-card', { timeout: 45000 }); await expect(page.locator('.team-cache')).toContainText('已缓存');
    expect(await page.locator('.team-card').count()).toBeGreaterThan(1);
    await expect(page.locator('.team-card').first().locator('.team-roster > div')).toHaveCount(6);
    await expect(page.locator('.team-card').first()).toContainText('达人带');
    await page.getByLabel('搜索队伍或成员', { exact: true }).fill('da ke lai yi');
    expect(await page.locator('.team-card').count()).toBeGreaterThan(0);
    const names = await page.locator('.team-card .team-roster').allTextContents(); expect(names.every(value => value.includes('达克莱伊'))).toBe(true);
    await page.getByLabel('搜索队伍或成员', { exact: true }).fill('');
  });
  await screenshot('team-source-preview');
  await check('单打双打、规则和体系筛选可组合，空结果不混入别的队伍', async () => {
    await page.getByLabel('队伍玩法筛选', { exact: true }).selectOption('doubles');
    await page.getByLabel('推荐队伍规则', { exact: true }).selectOption('gen9doublesou');
    await expect(page.getByLabel('推荐队伍规则', { exact: true })).toHaveValue('gen9doublesou');
    await page.waitForSelector('.team-card', { timeout: 45000 }); await expect(page.locator('.team-card').first()).toContainText('双打');
    await page.getByLabel('队伍体系筛选', { exact: true }).selectOption('rain');
    await expect(page.locator('.team-card')).toHaveCount(1); await expect(page.locator('.team-tags')).toContainText('推断');
    await page.getByLabel('队伍体系筛选', { exact: true }).selectOption('all');
    await page.getByLabel('搜索队伍或成员', { exact: true }).fill('不存在的队伍成员');
    await expect(page.locator('.team-card')).toHaveCount(0); await expect(page.locator('.empty-state')).toContainText('没有符合条件');
    await page.getByLabel('搜索队伍或成员', { exact: true }).fill('');
  });
  await check('完整详情显示体系依据、六个配置与学习方式，收藏原子创建六份培养计划', async () => {
    await page.locator('.team-card').first().getByRole('button', { name: '查看整队配置' }).click();
    await expect(page.locator('.team-member-build')).toHaveCount(6); await expect(page.locator('.team-clues')).toContainText('成员分工');
    await expect(page.locator('.team-member-build').first()).toContainText('学习方式');
    await page.getByRole('button', { name: '收藏整队', exact: true }).click();
    await expect(page.getByRole('button', { name: '队伍笔记', exact: true })).toBeVisible();
    const state = await page.evaluate(() => window.pokedex.user('get'));
    expect(state.teams).toHaveLength(1); expect(state.plans).toHaveLength(6); savedId = state.teams[0].id;
    expect(state.teams[0].members.map(member => member.id)).toEqual(state.plans.map(plan => plan.id));
  });
  await check('队伍笔记、成员个体值编辑和培养进度在队伍与个人方案间同步', async () => {
    await page.getByRole('button', { name: '队伍笔记', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑队伍笔记' });
    await dialog.getByLabel('收藏队伍名称').fill('我的整队作业');
    await dialog.getByLabel('队伍打法笔记').fill('先确认首发与配速，保留原队的搭配。');
    await dialog.getByRole('button', { name: '保存队伍笔记' }).click();
    await expect(dialog).not.toBeVisible(); await expect(page.locator('.team-detail-heading h1')).toHaveText('我的整队作业');
    await page.locator('.team-member-build').first().getByLabel('道具已准备', { exact: true }).check();
    await page.getByLabel('编辑队伍成员1', { exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑培养方案' });
    await editor.getByLabel('攻击个体值', { exact: true }).fill('0'); await editor.getByRole('button', { name: '保存培养方案' }).click();
    await expect(editor).not.toBeVisible();
    const state = await page.evaluate(() => window.pokedex.user('get'));
    expect(state.teams[0].members[0].selection.ivs.atk).toBe(0); expect(state.plans[0].selection.ivs.atk).toBe(0); expect(state.plans[0].progress.item).toBe(true);
  });
  await screenshot('team-personal-preview');
  await check('中文与 Showdown 整队可导出；导入先预览再收藏，非法链接不会创建计划', async () => {
    exported = await page.evaluate(async () => {
      const team = (await window.pokedex.team('personal'))[0];
      return { chinese: await window.pokedex.team('export', { team, language: 'chinese', copy: false }), showdown: await window.pokedex.team('export', { team, language: 'showdown', copy: false }) };
    });
    expect(exported.showdown.split(/\n\s*\n/)).toHaveLength(6); expect(exported.chinese).toContain('个体值');
    await page.getByRole('button', { name: '导入完整队伍', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入完整队伍' });
    await dialog.getByLabel('完整队伍导入内容').fill('https://example.com/team');
    await dialog.getByRole('button', { name: '读取并预览', exact: true }).click(); await expect(dialog.locator('.build-errors')).toContainText('仅支持');
    await dialog.getByLabel('导入队伍名称').fill('往返导入队伍'); await dialog.getByLabel('完整队伍导入内容').fill(exported.showdown);
    await dialog.getByRole('button', { name: '读取并预览', exact: true }).click();
    await expect(dialog.locator('.team-import-preview .team-roster > div')).toHaveCount(6);
    const before = await page.evaluate(() => window.pokedex.user('get')); expect(before.teams).toHaveLength(1);
    await dialog.getByRole('button', { name: '收藏整队并加入培养' }).click(); await expect(dialog).not.toBeVisible();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.teams).toHaveLength(2); expect(state.plans).toHaveLength(12);
  });
  await check('删除收藏队伍可保留成员，完整队伍与旧收藏笔记重启后保留', async () => {
    await page.getByRole('button', { name: '管理队伍收藏', exact: true }).click();
    await page.getByRole('button', { name: '取消收藏，保留培养方案', exact: true }).click();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.teams).toHaveLength(1); expect(state.plans).toHaveLength(12);
    await desktop.close(); desktop = null; await launch();
    await page.getByRole('button', { name: '队伍推荐', exact: true }).click(); await page.getByRole('button', { name: /^我的队伍/ }).click();
    await expect(page.locator('.team-card')).toHaveCount(1); await expect(page.locator('.team-card')).toContainText('我的整队作业');
    await page.getByRole('button', { name: '查看整队配置' }).click(); await expect(page.locator('.team-member-build').first().getByLabel('道具已准备')).toBeChecked();
    const restarted = await page.evaluate(() => window.pokedex.user('get')); expect(restarted.teams[0].id).toBe(savedId);
    expect(restarted.favorites).toEqual([25]); expect(restarted.notes[25]).toBe('队伍功能上线前的笔记');
  });
  await check('实际联网刷新不覆盖个人队伍，历史世代仍展示完整队伍', async () => {
    await page.getByRole('button', { name: '推荐队伍', exact: true }).click();
    if (process.argv.includes('--live')) {
      await page.getByRole('button', { name: '联网更新', exact: true }).click(); await expect(page.getByRole('button', { name: '联网更新', exact: true })).toBeEnabled({ timeout: 45000 });
      await expect(page.locator('.team-cache')).toContainText('已缓存');
    }
    await page.getByLabel('队伍来源世代').selectOption('3'); await page.waitForSelector('.team-card', { timeout: 45000 });
    await expect(page.locator('.team-card').first()).toContainText('第 3 世代'); await expect(page.locator('.team-card').first().locator('.team-roster > div')).toHaveCount(6);
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.teams[0].title).toBe('我的整队作业'); expect(state.teams[0].members[0].selection.ivs.atk).toBe(0);
  });
  await check('深色主题和 175% 缩放下队伍筛选与详情仍可操作且不横向溢出', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { theme: 'dark', uiScale: 175 }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.team-card').first().getByRole('button', { name: '查看整队配置' }).click(); await expect(page.locator('.team-member-build')).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screenshot('team-large-dark-preview');
  });
  expect(errors).toEqual([]);
  writeFileSync(path.join(qa, 'team-ui-report.json'), JSON.stringify({ checks, rendererErrors: errors, userDirectory: folder, live: process.argv.includes('--live') }, null, 2));
  console.log('完成 ' + checks.length + ' 项整队桌面验证。');
} catch (error) { if (desktop) await screenshot('team-failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
