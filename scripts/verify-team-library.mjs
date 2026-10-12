import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, existsSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true });
const folder = mkdtempSync(path.join(qa, 'team-library-ui-')), cache = path.join(folder, 'team-cache');
const live = process.argv.includes('--live'), savedCache = path.join(qa, 'team-expansion-live/team');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs');
if (live) {
  const data = createDataService(path.join(root, 'data/pokedex.sqlite'));
  const teams = createTeamService(createStrategyService(data, path.join(folder, 'strategy-cache')), cache);
  teams.sync({ generation: 9, refresh: true }); await teams.library.settle(9);
  const snapshot = teams.browse({ generation: 9, versionId: 27, start: false });
  writeFileSync(path.join(qa, 'team-library-live-report.json'), JSON.stringify({ count: snapshot.teams.length, sources: snapshot.sources, sync: snapshot.sync }, null, 2));
  console.log('LIVE ' + snapshot.teams.length + ' 队：' + snapshot.sources.map(value => value.name + ' ' + value.count).join(' / '));
  cpSync(cache, savedCache, { recursive: true }); data.close();
} else {
  if (!existsSync(savedCache)) throw new Error('请先运行 node scripts/verify-team-library.mjs --live 获取真实来源缓存。');
  cpSync(savedCache, cache, { recursive: true });
}
// This incomplete record only exists in the isolated QA profile. Real source
// records above remain untouched; it verifies that hidden values never appear.
const partialTitle = '验证：数值未公开队单', sourceFile = path.join(cache, 'source-victoryroad.json');
const state = JSON.parse(readFileSync(sourceFile, 'utf8'));
if (!state.records.length) throw new Error('真实 Victory Road 队伍未获取成功。');
const partial = structuredClone(state.records[0]);
partial.title = partialTitle; partial.originalName = 'Open Team Sheet'; partial.url = 'https://www.vrpastes.com/qaTest12';
partial.open = true; delete partial.key;
for (const member of partial.data) { delete member.evs; delete member.ivs; delete member.nature; }
state.records.push(partial); writeFileSync(sourceFile, JSON.stringify(state));
writeFileSync(path.join(folder, 'preferences.json'), JSON.stringify({ favorites: [25], notes: { 25: '扩充前的笔记' },
  settings: { versionId: 27, theme: 'light', uiScale: 125, shortcut: 'Ctrl+Alt+Shift+F9', imageStyle: 'artwork', keepOnTop: false } }));
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL; delete env.POKEDEX_TEAM_SOURCES;
const errors = [], checks = []; let desktop, page;
async function launch() {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
  await page.getByRole('button', { name: '队伍推荐', exact: true }).click();
  await page.waitForSelector('.team-card', { timeout: 45000 });
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function capture(name) {
  const screenshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, page.url());
  await screenshot(); await page.waitForTimeout(180); await screenshot(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await screenshot(), 'base64'));
}
let total, selectedSource, savedId;
try {
  await launch();
  await check('默认同世代跨规则浏览，真实样例、精选与比赛来源均收录，缓存立即可用', async () => {
    await expect(page.getByLabel('推荐队伍规则')).toHaveValue('all');
    await expect(page.getByLabel('队伍玩法筛选')).toHaveValue('singles');
    await expect(page.getByLabel('队伍配置完整度')).toHaveValue('complete');
    const snapshot = await page.evaluate(() => window.pokedex.team('browse', { generation: 9, start: false }));
    total = snapshot.teams.length; expect(total).toBeGreaterThan(140); expect(snapshot.sync.state).toBe('idle');
    expect(snapshot.sources.filter(value => value.count > 0)).toHaveLength(4);
    expect(snapshot.duplicateCount).toBeGreaterThan(0);
    await expect(page.locator('.team-cache')).toContainText('已缓存');
    expect(Number((await page.locator('.team-result-count').textContent()).match(/\d+/)[0])).toBeGreaterThan(10);
    await expect(page.getByRole('button', { name: '继续收录精选', exact: true })).toBeEnabled();
  });
  await capture('team-library-source-preview');
  await check('精确规则、拼音成员与动态体系数量准确，零数量体系禁用', async () => {
    await page.getByLabel('推荐队伍规则').selectOption('gen9ou');
    const counts = await page.getByLabel('队伍体系筛选').locator('option').evaluateAll(options => options.map(option => ({ text: option.textContent, disabled: option.disabled })));
    expect(counts.filter(value => /（0）/.test(value.text)).every(value => value.disabled)).toBe(true);
    await page.getByLabel('搜索队伍或成员').fill('da ke lai yi');
    await page.waitForSelector('.team-card');
    const rosters = await page.locator('.team-card .team-roster').allTextContents();
    expect(rosters.length).toBeGreaterThan(0); expect(rosters.every(text => text.includes('达克莱伊'))).toBe(true);
    await page.getByLabel('搜索队伍或成员').fill('');
    await page.getByLabel('推荐队伍规则').selectOption('all');
    await page.getByLabel('队伍来源筛选').selectOption('showcase');
    await expect(page.locator('.team-card').first()).toContainText('Smogon 精选展示');
  });
  await check('精选详情显示原帖日期与分享出处，整队收藏原子创建成员计划并保留个人进度', async () => {
    await page.locator('.team-card').first().getByRole('button', { name: '查看整队配置' }).click();
    await expect(page.locator('.team-member-build')).toHaveCount(6);
    await expect(page.locator('.team-quality')).toContainText('发表于');
    await expect(page.getByRole('button', { name: '查看配招分享', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '收藏整队', exact: true }).click();
    await expect(page.getByRole('button', { name: '队伍笔记', exact: true })).toBeVisible();
    const saved = await page.evaluate(() => window.pokedex.user('get'));
    expect(saved.teams).toHaveLength(1); expect(saved.plans).toHaveLength(6); savedId = saved.teams[0].id;
    selectedSource = saved.teams[0].originId;
    await page.locator('.team-member-build').first().getByLabel('道具已准备').check();
    await page.getByRole('button', { name: '返回队伍列表', exact: true }).click();
    await page.getByRole('button', { name: '推荐队伍', exact: true }).click();
    await page.getByLabel('队伍来源筛选').selectOption('showcase');
    await expect(page.locator('.team-card').first().locator('.team-own-label')).toContainText('已收藏整队');
    await expect(page.locator('.team-card').first().getByRole('button', { name: '取消收藏', exact: true })).toBeEnabled();
    const rows = await page.evaluate(() => window.pokedex.team('browse', { generation: 9, start: false }));
    const original = rows.teams.find(team => team.id === selectedSource || team.aliases.includes(selectedSource));
    const before = await page.evaluate(() => window.pokedex.user('get'));
    await page.evaluate(team => window.pokedex.team('save', { team }), original);
    const after = await page.evaluate(() => window.pokedex.user('get'));
    expect(after.plans).toEqual(before.plans); expect(after.teams).toEqual(before.teams);
  });
  await check('双打比赛规则可浏览，开放队单隐藏培养数值，阻止收藏、完整导出与数值分析', async () => {
    await page.getByLabel('队伍玩法筛选').selectOption('doubles');
    await page.getByLabel('队伍来源筛选').selectOption('victoryroad');
    await page.waitForSelector('.team-card'); await expect(page.locator('.team-card').first()).toContainText('VGC');
    await page.getByLabel('队伍配置完整度').selectOption('partial');
    await page.getByLabel('搜索队伍或成员').fill(partialTitle);
    await expect(page.locator('.team-card')).toHaveCount(1);
    await expect(page.locator('.team-card').getByRole('button', { name: '培养数值未公开', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '查看公开阵容' }).click();
    await expect(page.locator('.team-partial-member')).toHaveCount(6);
    await expect(page.locator('.team-partial-member').first()).toContainText('未公开');
    await expect(page.getByRole('button', { name: '复制中文整队' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '收藏整队', exact: true })).toBeDisabled();
    await expect(page.locator('.team-analysis-disclosure')).toHaveCount(0);
    await expect(page.locator('.team-partial-member').first()).not.toContainText('认真');
    await expect(page.locator('.team-partial-vector').first()).not.toContainText('0 /');
  });
  await capture('team-library-partial-preview');
  await check('200%深色显示下筛选和部分队单可操作，页面不横向溢出', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '返回队伍列表', exact: true }).click();
    await page.getByLabel('搜索队伍或成员').fill('');
    await page.getByLabel('队伍配置完整度').selectOption('complete');
    await page.getByLabel('队伍来源筛选').selectOption('all');
    await expect(page.locator('.team-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture('team-library-large-dark-preview');
  });
  await check('重启后缓存队伍与规则、额外来源、原收藏笔记和六份培养计划完整保留', async () => {
    await desktop.close(); desktop = null; await launch();
    const snapshot = await page.evaluate(() => window.pokedex.team('browse', { generation: 9, start: false }));
    expect(snapshot.teams.length).toBe(total); expect(snapshot.sync.state).toBe('idle');
    const state = await page.evaluate(() => window.pokedex.user('get'));
    expect(state.teams[0].id).toBe(savedId); expect(state.plans).toHaveLength(6);
    expect(state.plans[0].progress.item).toBe(true); expect(state.favorites).toEqual([25]); expect(state.notes[25]).toBe('扩充前的笔记');
  });
  const classic = await page.evaluate(() => window.pokedex.team('browse', { generation: 3, start: false }));
  if (classic.teams.some(team => team.title === 'querencia - McMeghan')) {
    await check('历史世代经典队伍按原规则展示六人配置，旧速度分配与目录出处保留', async () => {
      await page.getByLabel('队伍来源世代').selectOption('3');
      await page.getByLabel('队伍来源筛选').selectOption('archive');
      await page.getByLabel('队伍配置完整度').selectOption('all');
      await page.getByLabel('搜索队伍或成员').fill('querencia');
      await expect(page.locator('.team-card')).toHaveCount(1);
      await page.locator('.team-card').getByRole('button', { name: '查看公开阵容' }).click();
      await expect(page.locator('.team-member-build')).toHaveCount(6);
      const team = classic.teams.find(team => team.title === 'querencia - McMeghan');
      expect(team.members[0].selection.evs.spe).toBe(208);
      expect(team.members[0].selection.evs.spd).toBe(0);
      await expect(page.locator('.team-partial-member').first()).toContainText('个体值');
      await expect(page.locator('.team-partial-member').first().locator('.team-partial-vector').last()).toContainText('未公开');
      await expect(page.getByRole('button', { name: '查看来源目录', exact: true }).first()).toBeVisible();
      await capture('team-library-classic-preview');
    });
  }
  expect(errors).toEqual([]);
  writeFileSync(path.join(qa, 'team-library-ui-report.json'), JSON.stringify({ checks, rendererErrors: errors, cachedTeams: total, userDirectory: folder, live }, null, 2));
  console.log('完成 ' + checks.length + ' 项扩充队伍桌面验证。');
} catch (error) { if (desktop) await capture('team-library-failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
