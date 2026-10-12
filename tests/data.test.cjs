const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
let data;
before(() => { data = createDataService(path.join(__dirname, '../data/pokedex.sqlite')); });
after(() => data.close());
const pokemon = (id, versionId = 27) => data.query('pokemon', { id, versionId });

test('全国图鉴包含全部 1025 个中文物种；GBA 规则包含当时的 386 个物种', () => {
  const latest = data.query('catalog', { versionId: 27 }).filter(p => p.isDefault);
  assert.equal(latest.length, 1025);
  assert.ok(latest.every(p => /[\u3400-\u9fff]/.test(p.name)));
  assert.equal(data.query('catalog', { versionId: 6 }).filter(p => p.isDefault).length, 386);
});
test('可通过拼音、首字母和 GBA 常见旧译名找到宝可梦', () => {
  const pikachu = pokemon(25);
  assert.ok(pikachu.searchKey.includes('pikaqiu'));
  assert.ok(pikachu.searchKey.includes('pkq'));
  assert.ok(pokemon(373).searchKey.includes('暴蝾螈'));
});
test('皮卡丘的历史种族值与隐藏特性按规则世代恢复', () => {
  assert.equal(pokemon(25, 6).total, 300);
  assert.equal(pokemon(25, 27).total, 320);
  assert.equal(pokemon(25, 6).abilities.filter(a => a.hidden).length, 0);
  assert.equal(pokemon(25, 27).abilities.find(a => a.hidden).name, '避雷针');
});
test('妖精属性引入前后的属性资料正确切换', () => {
  assert.deepEqual(pokemon(35, 6).types, [1]);
  assert.deepEqual(pokemon(35, 27).types, [18]);
  assert.deepEqual(pokemon(122, 6).types, [14]);
  assert.deepEqual(pokemon(122, 27).types, [14, 18]);
});
test('双属性正确叠加四倍弱点、四分之一抗性与免疫', () => {
  const values = pokemon(6, 6).matchup;
  assert.equal(values.find(t => t.id === 6).multiplier, 4);
  assert.equal(values.find(t => t.id === 12).multiplier, .25);
  assert.equal(values.find(t => t.id === 5).multiplier, 0);
});
test('钢属性在旧世代抵抗幽灵和恶；不接受重复或尚未引入的属性', () => {
  const query = versionId => data.query('matchup', { types: [9], versionId });
  assert.equal(query(6).find(t => t.id === 8).multiplier, .5);
  assert.equal(query(27).find(t => t.id === 8).multiplier, 1);
  assert.throws(() => data.query('matchup', { types: [18], versionId: 6 }));
  assert.throws(() => data.query('matchup', { types: [10, 10], versionId: 6 }));
});
test('GBA 的物理／特殊类别按属性判断，招式威力读取历史数据', () => {
  const move = (id, versionId) => data.query('entity', { kind: 'moves', id, versionId });
  assert.equal(move(7, 6).className, '特殊');
  assert.equal(move(7, 27).className, '物理');
  assert.equal(move(85, 6).power, 95);
  assert.equal(move(85, 27).power, 90);
});
test('每个学习表精确使用指定游戏的数据；DLC 引用基础版本时注明来源', () => {
  const gba = pokemon(6, 6);
  assert.equal(gba.learnsetReference, null);
  assert.ok(gba.learnset.length > 0);
  assert.equal(pokemon(6, 27).learnsetReference, '朱／紫');
  assert.ok(pokemon(6, 27).learnset.length > 0);
  assert.ok(data.query('entity', { kind: 'moves', id: 85, versionId: 27 }).learners.length > 0);
  assert.equal(pokemon(6, 30).learnset.length, 0);
});
test('进化显示完整家族、等级分支和 GBA 美丽度条件', () => {
  const charizard = pokemon(6, 6);
  assert.equal(charizard.evolution.roots[0].name, '小火龙');
  assert.equal(charizard.evolution.edges.length, 2);
  assert.ok(charizard.evolution.edges[1].conditions.join('').includes('36'));
  assert.ok(pokemon(350, 6).evolution.edges.find(e => e.pokemon.speciesId === 350).conditions.join('').includes('美丽度 ≥ 170'));
  assert.ok(!pokemon(133, 6).evolution.edges.some(e => e.pokemon.speciesId === 700));
});
test('原有图片路径可用，形态资料可跳转，资料分类有中文说明', () => {
  assert.ok(pokemon(25).images.artwork);
  assert.ok(pokemon(25, 6).images.emerald);
  assert.ok(pokemon(6).forms.length > 1);
  assert.equal(data.query('entity', { kind: 'items', id: 83, versionId: 6 }).name, '雷之石');
  assert.match(data.query('entity', { kind: 'abilities', id: 9, versionId: 6 }).text, /静电/);
  assert.ok(data.query('entities', { kind: 'items', versionId: 6 }).length > 200);
});
