const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createUserStore } = require('../electron/user-store.cjs');
const fixture = require('./fixtures/strategies.json');
let data;
before(() => { data = createDataService(path.join(__dirname, '../data/pokedex.sqlite')); });
after(() => data.close());
function directory() { const parent = path.join(__dirname, '../.qa/strategy-tests'); fs.mkdirSync(parent, { recursive: true }); return fs.mkdtempSync(path.join(parent, 'case-')); }
const fixtureFetcher = async () => new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
const service = (fetcher = fixtureFetcher, folder = directory()) => createStrategyService(data, folder, fetcher);
const generationData = s => s.model.normalizeDataset(fixture, 9, '2026-10-11T00:00:00.000Z');

test('多路线、四个独立招式槽位与整组数值备选保留；不混入任意特性玩法', () => {
  const s = service(); const sets = generationData(s);
  assert.equal(sets.length, 3); assert.equal(sets.filter(set => set.pokemonId === 6).length, 2);
  assert.equal(sets.some(set => set.tier === 'almostanyability'), false);
  const alternative = sets.find(set => set.tier === 'nationaldexdoubles');
  assert.equal(alternative.evSpreads.length, 2); assert.equal(alternative.evSpreads[1].hp, 192);
  assert.equal(alternative.ivSpreads[0].atk, 0);
  assert.deepEqual(sets[0].moveOptions[2], ['Focus Blast', 'Scorching Sands']);
});
test('兼容世代数据的两种布局，并正确转成中文与当前版本核对结果', () => {
  const s = service(); const old = { ou: { Garchomp: fixture.Garchomp.ou } };
  assert.equal(s.model.normalizeDataset(old, 9, new Date().toISOString()).length, 1);
  const set = s.decorate(generationData(s)[0], 27);
  assert.equal(set.labels.natures.Timid.name, '胆小');
  assert.equal(set.labels.items['Choice Specs'].name, '讲究眼镜');
  assert.equal(set.labels.moves['Weather Ball'].name, '气象球');
  assert.ok(set.labels.moves['Weather Ball'].learning.length > 0);
  assert.equal(set.selection.ivs.atk, 31); assert.ok(set.defaults.some(text => text.includes('31')));
  assert.equal(set.validation.errors.length, 0);
  assert.ok(s.decorate(generationData(s)[1], 27).validation.warnings.some(text => text.includes('全国规则')));
});
test('初次联网保存缓存，后续完全离线可读；刷新失败不会覆盖旧缓存', async () => {
  const folder = directory(); let requests = 0;
  const s = service(async () => { requests++; return fixtureFetcher(); }, folder);
  const first = await s.list({ pokemonId: 6, generation: 9, versionId: 27 });
  assert.equal(first.sets.length, 2); assert.equal(requests, 1);
  await s.list({ pokemonId: 445, generation: 9, versionId: 27 }); assert.equal(requests, 1);
  const bytes = fs.readFileSync(path.join(folder, 'gen9.json'), 'utf8');
  const offline = service(async () => { throw new Error('offline'); }, folder);
  assert.equal((await offline.list({ pokemonId: 6, generation: 9, versionId: 27 })).sets.length, 2);
  const refreshed = await offline.list({ pokemonId: 6, generation: 9, versionId: 27, refresh: true });
  assert.match(refreshed.error, /继续使用已有缓存/); assert.equal(refreshed.sets.length, 2);
  assert.equal(fs.readFileSync(path.join(folder, 'gen9.json'), 'utf8'), bytes);
});
test('异常来源内容保留缓存；同一世代的并发首次查询只发送一次请求', async () => {
  const folder = directory(); let requests = 0;
  const s = service(async () => { requests++; await new Promise(resolve => setTimeout(resolve, 20)); return fixtureFetcher(); }, folder);
  await Promise.all([s.list({ pokemonId: 6, generation: 9, versionId: 27 }), s.list({ pokemonId: 445, generation: 9, versionId: 27 })]);
  assert.equal(requests, 1);
  const invalid = service(async () => new Response('<html>unavailable</html>'), folder);
  const result = await invalid.list({ pokemonId: 6, generation: 9, versionId: 27, refresh: true });
  assert.ok(result.error); assert.equal(result.sets.length, 2);
  assert.throws(() => s.model.normalizeDataset({ error: 'bad payload' }, 9, ''), /缓存已保留/);
});
test('英文与中文配招往返保留性格、特性、道具和 0 攻击个体值', () => {
  const s = service();
  const text = 'Gengar @ Leftovers\nAbility: Levitate\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\nIVs: 0 Atk\n- Thunderbolt\n- Ice Punch\n- Will-O-Wisp\n- Explosion';
  const imported = s.import(text, 3)[0];
  assert.equal(imported.pokemonId, 94); assert.equal(imported.selection.ivs.atk, 0); assert.equal(imported.selection.ivs.hp, 31);
  const chinese = s.export(imported, 'chinese'); assert.match(chinese, /特性: 飘浮/); assert.match(chinese, /性格: 胆小/);
  assert.deepEqual(s.import(chinese, 3)[0].selection, imported.selection);
  assert.deepEqual(s.import(s.export(imported, 'showdown'), 3)[0].selection, imported.selection);
});
test('觉醒力量属性与特殊个体值保留，多只宝可梦可一起导入', () => {
  const s = service();
  const text = 'Jolteon @ Leftovers\nAbility: Volt Absorb\nTimid Nature\nIVs: 30 Atk / 30 Def\n- Thunderbolt\n- Hidden Power Ice';
  const first = s.import(text, 3)[0];
  assert.equal(first.selection.moves[1], 'Hidden Power Ice'); assert.equal(first.selection.ivs.def, 30);
  assert.deepEqual(s.import(s.export(first, 'chinese'), 3)[0].selection, first.selection);
  assert.equal(s.import(`${text}\n\n${text}`, 3).length, 2);
});
test('非法数值、重复招式、不存在的性格及未来世代物种不会被保存或导出', () => {
  const s = service(); const set = generationData(s)[0];
  set.selection.evs.hp = 252;
  assert.throws(() => s.validatePersonal(set, 27), /510/);
  set.selection.evs.hp = 0; set.selection.ivs.spe = 40;
  assert.throws(() => s.export(set, 'showdown'), /0～31/);
  set.selection.ivs.spe = 31; set.selection.moves[1] = set.selection.moves[0];
  assert.throws(() => s.validatePersonal(set, 27), /重复/);
  assert.throws(() => s.import('Garchomp\n- Earthquake', 1), /尚未登场/);
  assert.throws(() => s.import('Pikachu\nInvalid Nature\n- Thunderbolt', 9), /性格/);
});
test('自己的修改和培养进度重启后保留；再次更新来源不会更改个人方案', async () => {
  const s = service(); const folder = directory(); const store = createUserStore(folder);
  const incoming = generationData(s)[0];
  const state = store.savePlan(s.validatePersonal(incoming, 27)); const plan = state.plans[0];
  assert.equal(plan.originId, incoming.id); assert.ok(plan.personal);
  store.progress(plan.id, 'item', true); store.progress(plan.id, 'move0', true);
  const changed = store.get().plans[0]; changed.title = '我自己的晴天路线'; changed.notes = '保留自己的改法'; changed.selection.moves[0] = 'Flamethrower'; changed.selection.moves[3] = 'Fire Blast';
  store.savePlan(s.validatePersonal(changed, 27));
  await s.list({ pokemonId: 6, generation: 9, versionId: 27, refresh: true });
  const saved = createUserStore(folder).get().plans[0];
  assert.equal(saved.title, '我自己的晴天路线'); assert.equal(saved.notes, '保留自己的改法');
  assert.equal(saved.progress.item, true); assert.equal(saved.progress.move0, false);
  assert.deepEqual(saved.moveOptions[0], ['Flamethrower']);
});
