const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs');
const { createBattleService } = require('../electron/battle-service.cjs');
let data, strategies, teams, battle;
before(() => {
  const directory = path.join(__dirname, '../.qa/battle-tests'); fs.mkdirSync(directory, { recursive: true });
  data = createDataService(path.join(__dirname, '../data/pokedex.sqlite'));
  strategies = createStrategyService(data, path.join(directory, 'strategies'));
  teams = createTeamService(strategies, path.join(directory, 'teams'));
  battle = createBattleService(data, strategies, teams);
});
after(() => data.close());
const draft = (id, generation = 9) => battle.draft({ pokemonId: id, generation });
const stats = (fighter, generation = 9, field = {}) => battle.stats({ fighter, generation, field });
function sourceTeam(raw, generation) { return teams.model.normalize([{ name: 'Regression team', data: raw }], 'gen' + generation + 'ou', '').teams[0]; }

test('道具列表使用各世代游戏索引，全部资料版本非空；缺少说明文本的朱紫与复刻不再被筛空', () => {
  for (const version of data.query('bootstrap').versions) {
    assert.ok(data.query('entities', { kind: 'items', versionId: version.id }).length >= 100, version.name);
    assert.equal(data.query('itemScope', { versionId: version.id }).indexed, true);
  }
  assert.ok(data.query('entities', { kind: 'items', versionId: 27 }).length > 2000);
  assert.ok(data.query('entities', { kind: 'items', versionId: 16 }).length > 700);
  assert.ok(!data.query('entities', { kind: 'items', versionId: 6 }).some(item => item.identifier === 'life-orb'));
  assert.ok(data.query('entities', { kind: 'items', versionId: 27 }).some(item => item.identifier === 'life-orb'));
  const item = data.query('entity', { kind: 'items', id: 83, versionId: 27 });
  assert.ok(item.text); assert.ok(item.referenceVersion); // Available even without a matching description.
});
test('50／100级能力实数、性格加成、0个体值和脱壳忍者特殊HP准确，计算不改写输入', () => {
  const pokemon = draft(6), before = JSON.stringify(pokemon);
  assert.deepEqual(stats(pokemon).stats, { hp: 153, atk: 104, def: 98, spa: 129, spd: 105, spe: 120 });
  pokemon.selection.evs.spe = 252; pokemon.selection.nature = 'Timid';
  assert.equal(stats(pokemon).stats.spe, 167);
  pokemon.selection.level = 100; assert.equal(stats(pokemon).stats.spe, 328);
  pokemon.selection.ivs.atk = 0; assert.equal(stats(pokemon).stats.atk, 155);
  assert.equal(stats(draft(292)).stats.hp, 1);
  assert.equal(JSON.stringify(draft(6)), before);
});
test('历史种族值和早期DV机制按计算世代读取，HP DV推导与特殊能力共用一致', () => {
  const old = draft(26, 3), modern = draft(26, 6);
  assert.equal(stats(old, 3).baseStats.spe, 100); assert.equal(stats(modern, 6).baseStats.spe, 110);
  const early = draft(25, 1); early.selection.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  early.selection.ivs = { hp: 31, atk: 26, def: 28, spa: 16, spd: 31, spe: 30 };
  const result = stats(early, 1);
  assert.equal(result.ivsUsed.hp, 20); assert.equal(result.stats.hp, 105); assert.equal(result.stats.spa, result.stats.spd);
  const gsc = draft(25, 2); gsc.selection.ivs.spa = 0;
  assert.equal(stats(gsc, 2).ivsUsed.spd, 0); assert.ok(stats(gsc, 2).warnings.some(text => text.includes('共用')));
});
test('讲究围巾、顺风、天气特性、能力等级与麻痹的世代差异参与速度计算', () => {
  const pokemon = draft(6); const base = stats(pokemon).finalSpeed;
  pokemon.selection.item = 'Choice Scarf'; assert.equal(stats(pokemon).finalSpeed, 180);
  pokemon.state.tailwind = true; assert.equal(stats(pokemon).finalSpeed, 360);
  pokemon.state.boosts.spe = 1; assert.equal(stats(pokemon).finalSpeed, 540);
  const rain = draft(230, 3); rain.selection.ability = 'Swift Swim';
  assert.equal(stats(rain, 3, { weather: 'Rain' }).finalSpeed, stats(rain, 3).finalSpeed * 2);
  const par = draft(25, 9); par.state.status = 'par';
  assert.equal(stats(par, 9).finalSpeed, Math.floor(stats(draft(25, 9), 9).finalSpeed / 2));
  const gsc = draft(25, 2); gsc.state.status = 'par';
  assert.equal(stats(gsc, 2).finalSpeed, Math.floor(stats(draft(25, 2), 2).finalSpeed / 4));
  assert.equal(base, 120);
});
test('伤害范围和满血／残血击倒概率准确，晴天、光墙和变化招式得到相应结果', () => {
  const attacker = draft(6), defender = draft(3), args = { generation: 9, attacker, defender, move: 'Flamethrower' };
  const first = battle.damage(args).results[0]; assert.deepEqual([first.min, first.max], [110, 132]); assert.equal(first.oneHitChance, 0);
  assert.ok(first.description.includes('70.9')); assert.equal(first.rolls.length, 16);
  defender.state.hpPercent = 50; assert.equal(battle.damage(args).results[0].oneHitChance, 1);
  defender.state.hpPercent = 100;
  assert.ok(battle.damage({ ...args, field: { weather: 'Sun' } }).results[0].min > first.min);
  defender.state.lightScreen = true; assert.ok(battle.damage(args).results[0].max < first.min);
  assert.equal(battle.damage({ ...args, move: 'Swords Dance' }).results[0].category, 'Status');
});
test('第三世代按属性区分物理／特殊；太晶化、极巨化、双打群攻和多段命中均参与计算', () => {
  for (const gen of [3, 4]) {
    const result = battle.damage({ generation: gen, attacker: draft(94, gen), defender: draft(143, gen), move: 'Fire Punch' }).results[0];
    assert.equal(result.category, gen === 3 ? 'Special' : 'Physical');
  }
  const attacker = draft(6), defender = draft(3), normal = battle.damage({ generation: 9, attacker, defender, move: 'Flamethrower' }).results[0];
  attacker.selection.teraType = 'Fire'; attacker.state.teraActive = true;
  assert.ok(battle.damage({ generation: 9, attacker, defender, move: 'Flamethrower' }).results[0].min > normal.min);
  const single = battle.damage({ generation: 9, attacker: draft(6), defender, move: 'Heat Wave' }).results[0];
  const spread = battle.damage({ generation: 9, attacker: draft(6), defender, move: 'Heat Wave', field: { gameType: 'Doubles' } }).results[0];
  assert.ok(spread.max < single.max);
  const hits2 = battle.damage({ generation: 9, attacker: draft(91), defender, move: 'Icicle Spear', hits: 2 }).results[0];
  const hits5 = battle.damage({ generation: 9, attacker: draft(91), defender, move: 'Icicle Spear', hits: 5 }).results[0];
  assert.ok(hits5.max > hits2.max);
  assert.equal(battle.damage({ generation: 9, attacker: draft(6), defender, move: 'Flamethrower', hits: 5 }).results[0].max, normal.max);
  const giant = draft(3, 8); giant.state.dynamax = true;
  assert.equal(battle.damage({ generation: 8, attacker: draft(6, 8), defender: giant, move: 'Flamethrower' }).results[0].targetHP, stats(giant, 8).stats.hp * 2);
});
test('共同弱点、固定免疫、历史钢属性抗性与引水／避雷针历史差异正确，不捏造伤害评分', () => {
  const team = teams.model.normalize(require('./fixtures/teams.json'), 'gen9ou', '').teams[0], before = JSON.stringify(team);
  const result = battle.analyze({ team, level: 50, field: { weather: 'Rain' } });
  assert.equal(result.members.length, 6); assert.equal(result.defensive.length, 18); assert.equal(result.offensive.length, 18);
  assert.equal(result.members[1].finalSpeed, stats({ ...team.members[1], state: {}, selection: { ...team.members[1].selection, level: 50 } }, 9, { weather: 'Rain' }).finalSpeed);
  assert.equal(JSON.stringify(team), before);
  for (const gen of [3, 6]) {
    const steel = sourceTeam([{ species: 'Metagross', ability: 'Clear Body', nature: 'Adamant', evs: { hp: 0 }, moves: ['Meteor Mash'] }], gen);
    assert.equal(battle.analyze({ team: steel }).defensive.find(row => row.id === 8).values[0], gen === 3 ? 1 : 2);
    const rod = sourceTeam([{ species: 'Manectric', ability: 'Lightning Rod', nature: 'Timid', evs: { hp: 0 }, moves: ['Thunderbolt'] }], gen);
    assert.equal(battle.analyze({ team: rod }).defensive.find(row => row.id === 13).values[0], gen === 3 ? .5 : 0);
  }
});
test('无效数值、未来世代、未收录配置与越界战斗条件不会返回误导性旧结果', () => {
  const pokemon = draft(6); pokemon.selection.evs = { hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 0 };
  assert.throws(() => stats(pokemon), /510/);
  assert.throws(() => battle.draft({ pokemonId: 445, generation: 1 }), /尚未登场/);
  assert.throws(() => stats(draft(6), 9, { weather: 'Unknown' }), /天气/);
  assert.throws(() => stats(draft(6, 3), 3, { terrain: 'Electric' }), /第六世代/);
  assert.throws(() => battle.damage({ generation: 9, attacker: draft(6), defender: draft(3), move: 'Not a move' }), /未收录/);
  const wrong = draft(6); wrong.state.hpPercent = 0; assert.throws(() => stats(wrong), /当前 HP/);
  assert.throws(() => battle.damage({ generation: 9, attacker: draft(91), defender: draft(3), move: 'Icicle Spear', hits: 10 }), /次数/);
});
