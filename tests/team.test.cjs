const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs');
const { pasteURL } = require('../electron/team-model.cjs');
const { createUserStore } = require('../electron/user-store.cjs');
const fixture = require('./fixtures/teams.json');
let data;
before(() => { data = createDataService(path.join(__dirname, '../data/pokedex.sqlite')); });
after(() => data.close());
function directory() { const root = path.join(__dirname, '../.qa/team-tests'); fs.mkdirSync(root, { recursive: true }); return fs.mkdtempSync(path.join(root, 'case-')); }
function service(fetcher, folder = directory()) {
  const strategies = createStrategyService(data, path.join(folder, 'strategies'));
  return { teams: createTeamService(strategies, path.join(folder, 'teams'), fetcher), strategies, folder };
}
const normalized = teams => teams.model.normalize(fixture, 'gen9ou', '2026-10-11T00:00:00.000Z').teams[0];
const response = value => new Response(JSON.stringify(value));

test('整队保留成员顺序、配速、特殊个体值和作者；原名标签与配置推断明确区分', () => {
  const { teams } = service(); const team = normalized(teams);
  assert.equal(team.members.length, 6); assert.equal(team.author, 'Fixture author');
  assert.deepEqual(team.members.map(member => member.pokemonId), [279, 847, 598, 145, 984, 983]);
  assert.equal(team.members[0].selection.ivs.atk, 0); assert.equal(team.members[2].selection.ivs.spe, 0);
  assert.equal(team.members[2].selection.evs.spd, 168);
  assert.equal(team.tags.find(tag => tag.id === 'rain').origin, 'source');
  const inference = teams.model.classify({ ...team, originalName: 'Sample', title: 'Sample' });
  assert.equal(inference.find(tag => tag.id === 'rain').origin, 'inferred');
  assert.equal(inference.find(tag => tag.id === 'balance').origin, 'inferred');
  const decorated = teams.model.decorate(team, 27);
  assert.equal(decorated.members[0].pokemonName, '大嘴鸥');
  assert.ok(decorated.roles[0].includes('天气启动'));
});
test('规则列表按实际接口筛选；不识别的成员导致整队跳过，保留其余完整队伍', async () => {
  const { teams } = service(async () => response({ gen9ou: [100, 50], gen9doublesou: [100, 50], gen4cap: [100, 50], '../bad': [1, 1] }));
  assert.deepEqual((await teams.formats()).formats.map(format => format.id), ['gen9ou', 'gen9doublesou']);
  const invalid = structuredClone(fixture[0]); invalid.name = 'Bad team'; invalid.data[3].species = 'CustomMon';
  const result = teams.model.normalize([...fixture, invalid], 'gen9ou', '');
  assert.equal(result.teams.length, 1); assert.equal(result.skipped.length, 1); assert.match(result.skipped[0].reason, /CustomMon/);
  assert.throws(() => teams.model.normalize([invalid], 'gen9ou', ''), /缓存已保留/);
});
test('队伍标识不受字段顺序、作者和标题变动影响', () => {
  const { teams } = service(); const renamed = structuredClone(fixture[0]); renamed.name = 'New name'; renamed.author = 'Another author';
  renamed.data = renamed.data.map(raw => Object.fromEntries(Object.entries(raw).reverse()));
  assert.equal(teams.model.normalize([renamed], 'gen9ou', '').teams[0].id, normalized(teams).id);
});
test('并发获取只请求一次，重启完全离线可读；异常刷新保留原缓存', async () => {
  let requests = 0;
  const { teams, folder } = service(async () => { requests++; await new Promise(resolve => setTimeout(resolve, 15)); return response(fixture); });
  await Promise.all([teams.list({ format: 'gen9ou', versionId: 27 }), teams.list({ format: 'gen9ou', versionId: 27 })]);
  assert.equal(requests, 1);
  const cached = fs.readFileSync(path.join(folder, 'teams/gen9ou.json'), 'utf8');
  const offline = service(async () => { throw new Error('offline'); }, folder).teams;
  assert.equal((await offline.list({ format: 'gen9ou', versionId: 27 })).teams.length, 1);
  const result = await offline.list({ format: 'gen9ou', versionId: 27, refresh: true });
  assert.match(result.error, /继续使用已有缓存/); assert.equal(result.teams.length, 1);
  const broken = service(async () => new Response('<html>unavailable</html>'), folder).teams;
  assert.ok((await broken.list({ format: 'gen9ou', versionId: 27, refresh: true })).error);
  assert.equal(fs.readFileSync(path.join(folder, 'teams/gen9ou.json'), 'utf8'), cached);
});
test('中文与 Showdown 整队往返保留六人和数值，不混入文本头或队伍笔记', async () => {
  const { teams } = service(); const team = normalized(teams); team.notes = '自己的笔记，不能被当成成员。';
  for (const language of ['chinese', 'showdown']) {
    const text = teams.export(team, language, 27);
    const imported = await teams.import({ text, format: 'gen9ou', title: '导入测试' });
    assert.equal(imported.members.length, 6);
    assert.deepEqual(imported.members.map(member => member.selection), team.members.map(member => member.selection));
    assert.equal(text.includes(team.notes), false);
  }
  await assert.rejects(teams.import({ text: Array(7).fill('Pikachu\n- Thunderbolt').join('\n\n'), format: 'gen9ou' }), /最多 6/);
  await assert.rejects(teams.import({ text: '=== [gen8ou] My Team ===\nPikachu\n- Thunderbolt', format: 'gen9ou' }), /相同规则/);
  const labeled = await teams.import({ text: '=== [gen9ou] My Team ===\nPikachu\n- Thunderbolt', format: 'gen9ou' });
  assert.equal(labeled.title, 'My Team');
});
test('PokéPaste 使用只读 JSON 接口，保留队名、作者和说明；其他主机不能被访问', async () => {
  let requested;
  const { teams } = service(async url => { requested = url; return response({ paste: 'Pikachu @ Light Ball\nAbility: Static\nTimid Nature\nIVs: 0 Atk\n- Thunderbolt', title: 'Rain import', author: 'Author', notes: 'Opening notes' }); });
  const team = await teams.import({ text: 'https://pokepast.es/0123456789abcdef', format: 'gen9battlestadiumdoubles' });
  assert.equal(requested, 'https://pokepast.es/0123456789abcdef/json');
  assert.equal(team.author, 'Author'); assert.equal(team.sourceNotes, 'Opening notes');
  assert.equal(team.title, 'Rain import'); assert.equal(team.members[0].selection.level, 50);
  for (const url of ['http://pokepast.es/0123456789abcdef', 'https://evil.test/0123456789abcdef', 'https://pokepast.es@evil.test/0123456789abcdef', 'https://pokepast.es:4433/0123456789abcdef']) assert.throws(() => pasteURL(url));
  assert.equal(pasteURL('https://pokepast.es/0123456789abcdef/raw'), 'https://pokepast.es/0123456789abcdef');
});
test('形态名称、昵称、性别、亲密度、超极巨化、觉醒力量与默认等级正确往返', async () => {
  const { teams } = service();
  const text = 'Mask (Ogerpon-Wellspring) (F) @ Wellspring Mask\nAbility: Water Absorb\nJolly Nature\nIVs: 0 SpA\n- Ivy Cudgel\n\nIndeedee-F @ Psychic Seed\nAbility: Psychic Surge\nRelaxed Nature\nIVs: 0 Atk / 0 Spe\n- Trick Room\n\nCharizard @ Life Orb\nAbility: Solar Power\nTimid Nature\nGigantamax: Yes\nDynamax Level: 0\nHidden Power: Ice\nHappiness: 0\n- Heat Wave';
  const team = await teams.import({ text, format: 'gen9ou' });
  assert.equal(team.members[0].pokemonId, 10273); assert.equal(team.members[1].pokemonId, 10186);
  assert.equal(team.members[0].selection.nickname, 'Mask'); assert.equal(team.members[0].selection.gender, 'F');
  assert.equal(team.members[2].selection.dynamaxLevel, 0); assert.equal(team.members[2].selection.happiness, 0);
  assert.deepEqual((await teams.import({ text: teams.export(team, 'showdown', 27), format: 'gen9ou' })).members.map(member => member.selection), team.members.map(member => member.selection));
  assert.deepEqual((await teams.import({ text: teams.export(team, 'chinese', 27), format: 'gen9ou' })).members.map(member => member.selection), team.members.map(member => member.selection));
  const early = teams.model.normalize([{ data: [{ species: 'Pikachu', moves: ['Thunderbolt'] }] }], 'gen1ou', '').teams[0];
  assert.equal(early.members[0].selection.evs.hp, 252);
  const lc = await teams.import({ text: 'Pikachu\n- Thunderbolt', format: 'gen9lc' }); assert.equal(lc.members[0].selection.level, 5);
});
test('收藏整队同时创建独立成员计划；编辑与进度双向同步，重启和来源更新不覆盖个人配置', async () => {
  const { teams, strategies, folder } = service(); const store = createUserStore(folder);
  store.favorite(25); store.note(25, '原有笔记'); store.settings({ uiScale: 150 });
  const team = normalized(teams), saved = store.saveTeam(teams.model.validate(team, 27));
  assert.equal(saved.teams.length, 1); assert.equal(saved.plans.length, 6);
  assert.equal(store.saveTeam(team).plans.length, 6); // Repeated source collection is idempotent.
  const member = store.get().plans[0]; member.title = '我的成员路线'; member.selection.ivs.atk = 1;
  store.savePlan(strategies.validatePersonal(member, 27)); store.progress(member.id, 'item', true);
  const state = store.get(); assert.equal(state.teams[0].members[0].selection.ivs.atk, 1); assert.equal(state.teams[0].members[0].progress.item, true);
  const edited = state.teams[0]; edited.notes = '我的队伍笔记'; edited.members[0].selection.evs.def = 248;
  store.saveTeam(teams.model.validate(edited, 27));
  const restarted = createUserStore(folder).get();
  assert.equal(restarted.teams[0].notes, '我的队伍笔记'); assert.equal(restarted.plans[0].selection.evs.def, 248);
  assert.equal(restarted.plans[0].progress.item, true); assert.equal(restarted.plans[0].progress.evs, false);
  assert.deepEqual(restarted.favorites, [25]); assert.equal(restarted.notes[25], '原有笔记'); assert.equal(restarted.settings.uiScale, 150);
  assert.equal(normalized(teams).members[0].selection.ivs.atk, 0);
});
test('共用基础资料的属性与外观形态保留原名、中文名和导出形式；不接受尚未登场的形态', async () => {
  const { teams } = service();
  const text = 'Arceus-Dark @ Dread Plate\nAbility: Multitype\nTimid Nature\n- Recover\n\nGastrodon-East @ Leftovers\nAbility: Storm Drain\nCalm Nature\n- Scald\n\nNecrozma-Dusk-Mane @ Leftovers\nAbility: Prism Armor\nAdamant Nature\n- Sunsteel Strike';
  const team = await teams.import({ text, format: 'gen9nationaldexubers' });
  const decorated = teams.model.decorate(team, 27);
  assert.match(decorated.members[0].pokemonName, /阿尔宙斯.*恶/);
  assert.match(decorated.members[1].pokemonName, /海兔兽.*东海/);
  const chinese = teams.export(team, 'chinese', 27);
  const english = teams.export(await teams.import({ text: chinese, format: team.format }), 'showdown', 27);
  assert.match(english.toLowerCase(), /arceus-dark/); assert.match(english.toLowerCase(), /gastrodon-east/); assert.match(english, /Necrozma-Dusk-Mane/);
  await assert.rejects(teams.import({ text: 'Arceus-Fairy @ Pixie Plate\nAbility: Multitype\n- Recover', format: 'gen4ou' }), /尚未登场/);
});
test('删队可保留成员计划，删单个计划仍可查看队伍快照并恢复；不连带删除独立方案', () => {
  const { teams, folder } = service(); const store = createUserStore(folder);
  const saved = store.saveTeam(teams.model.validate(normalized(teams), 27)), team = saved.teams[0];
  store.deletePlan(team.members[0].id);
  assert.equal(teams.model.decorate(store.get().teams[0], 27, store.get().plans).members.length, 6);
  assert.equal(teams.model.decorate(store.get().teams[0], 27, store.get().plans).linkedPlanIds.length, 5);
  store.saveTeam(teams.model.validate(store.get().teams[0], 27)); assert.equal(store.get().plans.length, 5);
  store.restoreTeamPlans(team.id); assert.equal(store.get().plans.length, 6);
  store.deleteTeam(team.id, false); assert.equal(store.get().plans.length, 6); assert.equal(store.get().plans[0].teamId, undefined);
  const next = store.saveTeam(teams.model.validate(normalized(teams), 27));
  assert.equal(next.plans.length, 6); // Recollect reuses the retained standalone members.
  store.deleteTeam(next.teams[0].id, true); assert.equal(store.get().plans.length, 0); assert.equal(store.get().teams.length, 0);
});
test('非法成员、跨世代配置和超额计划均不会产生半支队伍', () => {
  const { teams, folder } = service(); const store = createUserStore(folder); const team = normalized(teams);
  team.members[3].selection.evs.hp = 252; team.members[3].selection.evs.atk = 252;
  assert.throws(() => store.saveTeam(teams.model.validate(team, 27)), /第 4 位成员/);
  assert.equal(store.get().plans.length, 0); assert.equal(store.get().teams.length, 0);
  const valid = normalized(teams); valid.members[0].generation = 8; assert.throws(() => teams.model.validate(valid, 27), /世代与队伍不一致/);
  const plans = Array.from({ length: 1995 }, (_, index) => ({ ...normalized(teams).members[0], id: 'personal-existing-' + index, personal: true }));
  fs.writeFileSync(path.join(folder, 'preferences.json'), JSON.stringify({ ...store.get(), plans }));
  const full = createUserStore(folder); assert.throws(() => full.saveTeam(normalized(teams)), /2000/);
  assert.equal(full.get().teams.length, 0); assert.equal(full.get().plans.length, 1995);
});
