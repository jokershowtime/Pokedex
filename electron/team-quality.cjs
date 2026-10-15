const ROLE_IDS = ['physical', 'special', 'hazards', 'removal', 'pivot', 'speed', 'support', 'setup', 'recovery', 'priority', 'room', 'tailwind', 'screens'];
const WEATHER = ['rain', 'sun', 'sand', 'snow'];
const ROLE_NAMES = ['物理攻击', '特殊攻击', '布置场地', '清理场地', '轮转中转', '速度控制', '队友辅助', '强化', '回复续航', '先制攻击'];
const has = (value, index) => Boolean(value & (1 << index));
function structureFlags(entry) {
  let value = 0;
  ROLE_IDS.forEach((id, index) => { if (entry.traits.includes(id)) value |= 1 << index; });
  WEATHER.forEach((id, index) => {
    if (entry.traits.includes(id + '-start')) value |= 1 << (13 + index);
    if (entry.traits.includes(id + '-user')) value |= 1 << (17 + index);
  });
  return value | (1 << (entry.speed <= 80 ? 21 : entry.speed >= 150 ? 23 : 22));
}
function structureParts(value, c) {
  const roles = (has(value, 0) ? 4 : 0) + (has(value, 1) ? 4 : 0) + (has(value, 0) && has(value, 1) ? 4 : 0) +
    (has(value, 8) ? 4 : 0) + (has(value, 4) ? 4 : 0) + (has(value, 3) ? c.category === 'doubles' ? 1 : 4 : 0) +
    (has(value, 2) && c.category !== 'doubles' ? 3 : 0) + (has(value, 6) && c.category === 'doubles' ? 5 : 0);
  const speed = c.style === 'room' ? (has(value, 21) ? 6 : 0) + (has(value, 10) ? 6 : 0) :
    (has(value, 23) ? 4 : 0) + (has(value, 22) ? 2 : 0) + (has(value, 5) ? 4 : 0) + (has(value, 9) ? 2 : 0);
  let synergy = 0, starters = 0;
  WEATHER.forEach((id, index) => {
    if (has(value, 13 + index)) { starters++; if (has(value, 17 + index)) synergy = 8; }
  });
  synergy -= Math.max(0, starters - 1) * 4;
  if (has(value, 12) && has(value, 7)) synergy += 4;
  if (has(value, 11) && has(value, 0) && has(value, 1)) synergy += 4;
  return { roles, speed, synergy };
}
function structureBonus(value, c) { const parts = structureParts(value, c); return parts.roles + parts.speed + parts.synergy; }
function assessment(members, metrics, c, shared) {
  const flags = members.reduce((value, entry) => value | structureFlags(entry), 0), parts = structureParts(flags, c);
  const count = id => members.filter(entry => entry.traits.includes(id)).length;
  const components = c.preference === 'balanced' ? [
    ['打击面', metrics.coverage * 12], ['抵抗与免疫', metrics.resistances * 6], ['成员属性', metrics.distinctTypes * 3],
    ['共同弱点', -shared * 5], ['功能分工', parts.roles], ['速度结构', parts.speed], ['体系联动', parts.synergy],
  ] : c.preference === 'defense' ? [
    ['抵抗与免疫', metrics.resistances * 20], ['打击面', metrics.coverage * 3], ['成员属性', metrics.distinctTypes], ['共同弱点', -shared * 17],
  ] : c.preference === 'types' ? [
    ['成员属性', metrics.distinctTypes * 20], ['打击面', metrics.coverage * 3], ['抵抗与免疫', metrics.resistances], ['共同弱点', -shared * 2],
  ] : [['打击面', metrics.coverage * 20], ['抵抗与免疫', metrics.resistances * 3], ['成员属性', metrics.distinctTypes], ['共同弱点', -shared * 2]];
  const weak = new Map();
  members.forEach(entry => entry.weakIds.forEach(id => weak.set(id + 1, (weak.get(id + 1) || 0) + 1)));
  const warnings = [];
  if (!count('physical') || !count('special')) warnings.push('攻击类别较集中，需留意对应防御侧较强的对手。');
  if (!count('recovery')) warnings.push('没有识别到主动回复招式，需留意续航。');
  if (c.category === 'singles' && !count('removal')) warnings.push('没有识别到清理场地招式。');
  if (!has(flags, 23) && !count('speed') && !count('priority') && c.style !== 'room') warnings.push('缺少高速成员、速度控制与先制攻击。');
  if (WEATHER.filter((id, index) => has(flags, 13 + index)).length > 1) warnings.push('存在多种天气启动，需留意天气互相覆盖。');
  const synergies = WEATHER.filter((id, index) => has(flags, 13 + index) && has(flags, 17 + index)).map(id =>
    ({ rain: '雨天启动与受益', sun: '晴天启动与受益', sand: '沙暴启动与受益', snow: '雪天启动与受益' })[id]);
  if (has(flags, 12) && has(flags, 7)) synergies.push('双墙／极光幕与强化');
  if (has(flags, 11) && has(flags, 0) && has(flags, 1)) synergies.push('顺风与物理／特殊攻击');
  if (c.style === 'room' && has(flags, 21) && has(flags, 10)) synergies.push('戏法空间与低速成员');
  return { score: components.reduce((sum, [, points]) => sum + points, 0),
    components: components.map(([label, points]) => ({ label, points })), physical: count('physical'), special: count('special'),
    roles: ROLE_IDS.slice(0, 10).flatMap((id, index) => count(id) ? [{ id, label: ROLE_NAMES[index], count: count(id) }] : []),
    speeds: members.map(entry => ({ pokemonId: entry.pokemonId, name: entry.name, value: entry.speed })).sort((a, b) => b.value - a.value),
    attackTypes: Array.from({ length: 18 }, (_, i) => i + 1).filter(id => members.some(entry => entry.attackMask & (1 << (id - 1)))),
    resistTypes: Array.from({ length: 18 }, (_, i) => i + 1).filter(id => members.some(entry => entry.resistMask & (1 << (id - 1)))),
    sharedWeaknesses: [...weak].filter(([, count]) => count >= 2).map(([typeId, count]) => ({ typeId, count })), synergies, warnings };
}
function teamDistance(left, right) {
  const ids = new Set(left.map(entry => entry.speciesId));
  return 6 - right.filter(entry => ids.has(entry.speciesId)).length;
}
function diverseTeams(teams, count, difference) {
  const selected = [];
  for (const team of teams) {
    if (selected.every(old => teamDistance(old.members, team.members) >= difference)) selected.push(team);
    if (selected.length >= count) break;
  }
  return selected;
}
module.exports = { structureFlags, structureBonus, assessment, teamDistance, diverseTeams };
