import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true }); const folder = mkdtempSync(path.join(qa, 'assistant-ui-'));
const { createDataService } = require('../electron/data-service.cjs'), { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs'), { createUserStore } = require('../electron/user-store.cjs');
const data = createDataService(path.join(root, 'data/pokedex.sqlite')), strategies = createStrategyService(data, path.join(folder, 'strategy-cache'));
const teams = createTeamService(strategies, path.join(folder, 'team-cache'), undefined, { providers: [] }), store = createUserStore(folder);
const fixture = require('../tests/fixtures/teams.json'), source = teams.model.normalize(fixture, 'gen9ou', '').teams[0];
store.savePlans(source.members.map(member => strategies.validatePersonal({ ...member, id: 'new', title: '助手前的方案' }, 27)));
store.progress(store.get().plans[0].id, 'item', true); store.favorite(25); store.note(25, '助手上线前的笔记');
store.settings({ versionId: 27, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F7' });
const original = store.get();
writeFileSync(path.join(folder, 'strategy-cache/gen9.json'), JSON.stringify({ schemaVersion: 1, generation: 9, fetchedAt: '', data: require('../tests/fixtures/strategies.json') }));
const realCache = path.join(qa, 'strategy-ui-user/strategy-cache/gen9.json');
if (existsSync(realCache)) copyFileSync(realCache, path.join(folder, 'strategy-cache/gen9.json'));
writeFileSync(path.join(folder, 'team-cache/gen9ou.json'), JSON.stringify({ schemaVersion: 1, key: 'gen9ou', fetchedAt: '', data: fixture }));
writeFileSync(path.join(folder, 'team-cache/index.json'), JSON.stringify({ schemaVersion: 1, key: 'index', fetchedAt: '', data: { gen9ou: [1, 1], gen9doublesou: [1, 1] } }));
const olderData = { Charizard: { ou: { '测试来源': { ability: 'Blaze', item: 'Leftovers', nature: 'Timid', evs: { spa: 252, spe: 252, hp: 4 }, moves: ['Flamethrower', 'Dragon Claw', 'Earthquake', 'Protect'] } } } };
for (let gen=1;gen<=8;gen++) writeFileSync(path.join(folder, 'strategy-cache/gen'+gen+'.json'), JSON.stringify({schemaVersion:1,generation:gen,fetchedAt:'',data:olderData}));
data.close();
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_TEAM_SOURCES: 'samples' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
const quick = process.argv.includes('--quick');
let desktop, page, lastRun;
const errors = [], checks = [], reports = [];
const state = () => page.evaluate(() => window.pokedex.user('get'));
async function launch() {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
  await page.getByRole('button', { name: '阵容助手', exact: true }).click();
  await expect(page.getByRole('button', { name: '计算队伍', exact: true })).toBeEnabled();
}
async function capture(name) {
  if (quick) return;
  const screenshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, page.url());
  await screenshot(); await page.waitForTimeout(150); await screenshot(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await screenshot(), 'base64'));
}
async function calculate(button = '计算队伍') {
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.locator('.assistant-status.complete')).toBeVisible({ timeout: 30000 });
  // Results are held only by the main process, no local state writes.
  const runId = await page.locator('.assistant-status').getAttribute('data-run-id');
  lastRun = await page.evaluate(runId => window.pokedex.team('assistant-status', { runId }), runId);
  reports.push({ elapsedMs: lastRun.elapsedMs, searchMs: lastRun.searchMs, configurations: lastRun.prepared, results: lastRun.results.length });
  await expect(page.locator('.assistant-results')).toBeVisible();
}
async function check(name, action, extended = false) {
  if (quick && extended) return;
  await action(); checks.push(name); console.log('PASS ' + name);
}
try {
  await launch();
  await check('只填写条件即可计算，选择目标打击面、功能和必带成员，结果逐项核对', async () => {
    await page.getByLabel('每种属性最多几位弱点成员', { exact: true }).selectOption('6');
    await expect(page.getByLabel('助手世代')).toHaveValue('0'); await expect(page.getByLabel('助手参考规则')).toHaveValue('all');
    await expect(page.getByLabel('返回队伍数量', { exact: true })).toHaveValue('20');
    for(const id of [279,847,598,145,984,983]) {
      await page.getByLabel('搜索必带宝可梦', { exact: true }).fill(String(id));
      await page.getByLabel('添加必带宝可梦', { exact: true }).selectOption(String(id));
    }
    await page.getByLabel('必须克制的目标属性·火', { exact: true }).check();
    await page.getByLabel('必须克制的目标属性·水', { exact: true }).check();
    await page.getByLabel('必须携带的攻击属性·钢', { exact: true }).check();
    await page.getByLabel('必须具备清理场地', { exact: true }).check();
    await calculate();
    await expect(page.locator('.assistant-checks')).toContainText('包含大嘴鸥');
    await expect(page.locator('.assistant-checks')).toContainText('克制火');
    await expect(page.locator('.assistant-roster-slot > button:first-child')).toHaveCount(6);
    await expect(page.locator('.team-member-build')).toHaveCount(6);
    expect(lastRun.percent).toBe(100); expect(lastRun.processed).toBe(lastRun.total);
    expect(lastRun.results).toHaveLength(1); expect(lastRun.constraints.resultCount).toBe(20);
    if (lastRun.strategy === 'exact') expect(BigInt(lastRun.evaluated)+BigInt(lastRun.prunedCombinations)).toBe(BigInt(lastRun.total));
    expect((await state()).teams).toHaveLength(0); expect((await state()).plans).toEqual(original.plans);
    await capture('assistant-results');
  });
  await check('条件改变后清除旧结果，资料和个人方案保持原状', async () => {
    await page.getByLabel('助手队伍体系', { exact: true }).selectOption('rain');
    await expect(page.locator('.assistant-results')).toHaveCount(0);
    await calculate(); await expect(page.locator('.assistant-checks')).toContainText('雨天启动');
    await expect(page.locator('.assistant-checks')).toContainText('雨天受益配置');
    expect((await state()).plans).toEqual(original.plans);
  }, true);
  await check('取消计算立即恢复按钮，不产生半支队伍', async () => {
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消当前计算', exact: true })).toBeEnabled();
    const busy = await page.evaluate(() => ({
      startDisabled: [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '计算队伍').disabled,
      generationDisabled: document.querySelector('[aria-label="助手世代"]').matches(':disabled'),
      countDisabled: document.querySelector('[aria-label="返回队伍数量"]').matches(':disabled'),
      progress: Boolean(document.querySelector('progress[aria-label="阵容计算进度"]')),
    }));
    expect(busy).toEqual({ startDisabled: true, generationDisabled: true, countDisabled: true, progress: true });
    await page.getByRole('button', { name: '取消当前计算', exact: true }).evaluate(button => button.click());
    await expect(page.locator('.assistant-status.cancelled')).toBeVisible();
    await expect(page.getByRole('button', { name: '计算队伍', exact: true })).toBeEnabled();
    expect((await state()).teams).toHaveLength(0);
  });
  await check('约束冲突有具体原因且不保留旧队伍', async () => {
    await page.getByLabel('搜索禁用宝可梦', { exact: true }).fill('da zui ou');
    await page.getByLabel('添加禁用宝可梦', { exact: true }).selectOption('279');
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.locator('.assistant-status.complete')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.assistant-diagnostics')).toContainText('包含大嘴鸥');
    await expect(page.locator('.assistant-results')).toHaveCount(0);
    await capture('assistant-conflict');
    await page.getByRole('button', { name: /移除禁用宝可梦条件大嘴鸥/ }).click();
  }, true);
  await check('200%深色界面条件与计算按钮不超出可用区域', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.locator('.assistant-page').evaluate(element => element.scrollTo({ top: 0 }));
    await capture('assistant-large-dark');
    const overflow = await page.locator('.assistant-page').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: '计算队伍', exact: true }).scrollIntoViewIfNeeded();
    const bounds = await page.getByRole('button', { name: '计算队伍', exact: true }).boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 125, theme: 'light' }));
  }, true);
  await check('保存完整六人配置并跳到整队培养，新方案独立且培养数值保留', async () => {
    await calculate();
    await page.getByRole('button', { name: '保存到我的培养', exact: true }).click();
    await expect(page.locator('.team-detail-heading h1')).toContainText('条件配队');
    const saved = await state();
    expect(saved.teams).toHaveLength(1); expect(saved.plans).toHaveLength(12);
    expect(saved.teams[0].members).toHaveLength(6);
    expect(saved.teams[0].members.every(member => Object.keys(member.progress).length === 0)).toBe(true);
    expect(saved.teams[0].members.map(member => member.selection)).toEqual(lastRun.results[0].team.members.map(member => member.selection));
    for (const plan of original.plans) expect(saved.plans.find(value => value.id === plan.id)).toEqual(plan);
    expect(saved.favorites).toEqual(original.favorites); expect(saved.notes['25']).toBe(original.notes['25']);
    expect(saved.teams[0].notes).toContain('克制火');
    await page.getByRole('button', { name: '调整成员', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '队伍工作台', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭队伍工作台', exact: true }).click();
  });
  await check('结果数量可选，宽条件默认返回 20 支不同队伍并可切换末队', async () => {
    await page.getByRole('button', { name: '阵容助手', exact: true }).click();
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByLabel('助手世代', { exact: true }).selectOption('9');
    await page.getByLabel('每种属性最多几位弱点成员', { exact: true }).selectOption('6');
    await expect(page.getByLabel('返回队伍数量', { exact: true })).toHaveValue('20');
    await calculate();
    expect(lastRun.results).toHaveLength(20);
    expect(lastRun.constraints.minDifference).toBe(2); expect(lastRun.constraints.preference).toBe('balanced');
    const references = await page.evaluate(() => window.pokedex.strategy('references'));
    const species = new Map(references.pokemon.map(pokemon => [pokemon.id, pokemon.speciesId]));
    for (let i = 0; i < lastRun.results.length; i++) for (let j = i + 1; j < lastRun.results.length; j++) {
      const left = new Set(lastRun.results[i].team.members.map(member => species.get(member.pokemonId)));
      expect(lastRun.results[j].team.members.filter(member => !left.has(species.get(member.pokemonId))).length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(lastRun.results.map(result => result.team.members.map(member => member.pokemonId).sort((a, b) => a - b).join(','))).size).toBe(20);
    await expect(page.getByRole('button', { name: /^查看计算队伍/ })).toHaveCount(20);
    await page.getByRole('button', { name: '查看计算队伍20', exact: true }).click();
    await expect(page.locator('.assistant-result-heading h3')).toHaveText(lastRun.results[19].team.title);
    await capture('assistant-twenty-results');
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('50');
    await expect(page.locator('.assistant-results')).toHaveCount(0);
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('10');
    await calculate();
    expect(lastRun.results).toHaveLength(10);
    expect(lastRun.constraints.resultCount).toBe(10);
    expect(lastRun.cacheHit).toBe(true);
    await expect(page.locator('.assistant-status')).toContainText('已复用缓存');
  }, true);
  await check('评分分项可查看，支持三队并排比较与移出，200%深色界面不溢出', async () => {
    await expect(page.locator('.assistant-score')).toContainText('功能分工');
    expect(lastRun.results[0].assessment.components.reduce((sum, part) => sum + part.points, 0)).toBe(lastRun.results[0].assessment.score);
    for (const index of [1, 2, 3]) {
      await page.getByRole('button', { name: '查看计算队伍' + index, exact: true }).click();
      await page.getByRole('button', { name: /^加入对比/ }).click();
    }
    await expect(page.locator('.assistant-comparison')).toBeVisible();
    await expect(page.locator('.assistant-comparison thead th')).toHaveCount(4);
    await page.getByRole('button', { name: '查看计算队伍4', exact: true }).click();
    await expect(page.getByRole('button', { name: /^加入对比/ })).toBeDisabled();
    await page.locator('.assistant-comparison').scrollIntoViewIfNeeded(); await capture('assistant-three-team-comparison');
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.locator('.assistant-comparison').scrollIntoViewIfNeeded(); await capture('assistant-comparison-large-dark');
    expect(await page.locator('.assistant-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 125, theme: 'light' }));
    await page.getByRole('button', { name: '移出对比队伍2', exact: true }).click();
    await expect(page.locator('.assistant-comparison thead th')).toHaveCount(3);
    await page.getByRole('button', { name: '清空对比', exact: true }).click();
    await expect(page.locator('.assistant-comparison')).toHaveCount(0);
  }, true);
  await check('锁定两位成员后重算，其全部配置保留且其余成员组合发生变化', async () => {
    const originalTeam = lastRun.results[3].team, pinned = originalTeam.members.slice(0, 2);
    for (const member of pinned) await page.getByRole('button', { name: '锁定成员' + member.pokemonName, exact: true }).click();
    await calculate('保留锁定成员重新计算');
    expect(lastRun.lockedPokemonIds).toEqual(pinned.map(member => member.pokemonId));
    expect(lastRun.cacheHit).toBe(true);
    for (const result of lastRun.results) {
      expect(result.team.members.map(member => member.pokemonId).sort((a, b) => a - b)).not.toEqual(originalTeam.members.map(member => member.pokemonId).sort((a, b) => a - b));
      for (const member of pinned) expect(result.team.members.find(candidate => candidate.pokemonId === member.pokemonId).selection).toEqual(member.selection);
    }
    for (const member of pinned) await expect(page.getByRole('button', { name: '锁定成员' + member.pokemonName, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await capture('assistant-locked-rebuild');
    await page.getByRole('button', { name: '解除全部锁定', exact: true }).click();
    await expect(page.getByRole('button', { name: '保留锁定成员重新计算', exact: true })).toBeDisabled();
  }, true);
  await check('离开助手继续异步计算，返回恢复条件和进度，全局禁止重算，手动取消后重启保留队伍', async () => {
    await page.getByRole('button', { name: '阵容助手', exact: true }).click();
    await expect(page.getByRole('button', { name: '计算队伍', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByLabel('助手世代', { exact: true }).selectOption('9');
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消计算', exact: true })).toBeEnabled();
    const runId = await page.locator('.assistant-status').getAttribute('data-run-id');
    const rejected = await page.evaluate(async () => { try { await window.pokedex.team('assistant-start', {format:'all',scopeGeneration:9});return false; } catch {return true;} });
    expect(rejected).toBe(true);
    await page.getByRole('button', { name: '宝可梦图鉴', exact: true }).click();
    await page.waitForTimeout(500);
    const running = await page.evaluate(runId => window.pokedex.team('assistant-status', { runId }), runId);
    expect(['running', 'complete']).toContain(running.state);
    if (running.state === 'running') await expect(page.getByRole('button', { name: '返回正在计算的阵容', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '阵容助手', exact: true }).click();
    await expect(page.getByLabel('助手世代')).toHaveValue('9'); await expect(page.getByLabel('助手参考规则')).toHaveValue('all');
    await expect(page.getByLabel('返回队伍数量', { exact: true })).toHaveValue('20');
    const resumed = await page.evaluate(runId => window.pokedex.team('assistant-status', { runId }), runId);
    if (resumed.state === 'running') await expect(page.getByLabel('助手世代')).toBeDisabled();
    await expect(page.getByRole('progressbar', {name:'阵容计算进度'})).toBeVisible();
    await expect.poll(async () => ['searching', 'improving', 'finished'].includes((await page.evaluate(runId => window.pokedex.team('assistant-status', { runId }), runId)).phase),
      { timeout: 20000 }).toBe(true);
    await page.locator('.assistant-status').scrollIntoViewIfNeeded();
    await capture('assistant-search-progress');
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.locator('.assistant-status').evaluate(element => {
      const parent = element.closest('.assistant-page');
      parent.scrollTo({ top: parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top });
    });
    await capture('assistant-search-progress-large-dark');
    expect(await page.locator('.assistant-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
    const afterCapture = await page.evaluate(runId => window.pokedex.team('assistant-status', { runId }), runId);
    if (afterCapture.state === 'running') await expect(page.getByRole('button', {name:'取消当前计算', exact:true})).toBeVisible();
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 125, theme: 'light' }));
    if (afterCapture.state === 'running') {
      await page.getByRole('button', { name: '取消当前计算', exact: true }).click();
      await expect(page.locator('.assistant-status.cancelled')).toBeVisible();
    } else {
      expect(afterCapture.state).toBe('complete'); expect(afterCapture.results).toHaveLength(20);
    }
    expect((await state()).teams).toHaveLength(1);
    await desktop.close(); desktop = null;
    await launch(); const saved = await state(); expect(saved.teams).toHaveLength(1); expect(saved.plans).toHaveLength(12);
    const text = await page.evaluate(team => window.pokedex.team('export', { team, language: 'showdown', copy: false }), saved.teams[0]);
    expect(text.trim().split(/\n\s*\n/)).toHaveLength(6);
    for (const member of saved.teams[0].members) expect(text).toContain(member.showdownSpecies);
  }, true);
  expect(errors).toEqual([]);
  writeFileSync(path.join(qa, quick ? 'assistant-ui-quick-report.json' : 'assistant-ui-report.json'), JSON.stringify({ userDirectory: folder, mode: quick ? 'quick' : 'full', checks, reports, rendererErrors: errors }, null, 2));
} catch (error) {
  if (desktop) await capture('assistant-failure').catch(() => {});
  writeFileSync(path.join(qa, quick ? 'assistant-ui-quick-report.json' : 'assistant-ui-report.json'), JSON.stringify({ userDirectory: folder, mode: quick ? 'quick' : 'full', checks, reports, rendererErrors: errors,
    status: await page?.locator('.assistant-status').textContent().catch(() => null), failure: error.message }, null, 2));
  throw error;
} finally { await desktop?.close(); }
