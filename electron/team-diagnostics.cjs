const { popcount, requirements, filteredPool } = require('./team-solver.cjs');
function diagnoseConditions(inputPool, c, { names = {}, references = [], availability = true } = {}) {
  const issues = [], byId = new Map(references.map(entry => [entry.id, entry]));
  inputPool.forEach(entry => { if (!byId.has(entry.pokemonId)) byId.set(entry.pokemonId, { id: entry.pokemonId, speciesId: entry.speciesId }); });
  const pokemon = id => names.pokemon?.[id] || '宝可梦 ' + id, type = id => names.types?.[id] || '属性 ' + id;
  const add = (kind, title, conditions, explanation, suggestions) => issues.push({ kind, title, conditions, explanation, suggestions });
  const required = new Map();
  for (const id of c.requiredIds) {
    const species = byId.get(id)?.speciesId;
    const excluded = c.excludedIds.find(other => other === id || species && byId.get(other)?.speciesId === species);
    if (excluded) add('conflict', '“包含' + pokemon(id) + '”与禁用成员冲突', ['必带／锁定 ' + pokemon(id), '禁用 ' + pokemon(excluded)],
      '禁用成员包含该物种的其他形态，无法同时安排进队伍。', ['移除对应禁用条件，或调整必带／锁定成员。']);
    if (species && required.has(species)) add('conflict', '必带成员包含同物种的多个形态', [pokemon(required.get(species)), pokemon(id)],
      '一队只安排一位同物种成员，不能同时使用这两个形态。', ['保留其中一个形态。']);
    if (species) required.set(species, id);
  }
  for (const id of c.memberTypes.filter(id => c.excludedTypes.includes(id))) add('conflict', type(id) + '属性成员要求互相冲突',
    ['必须有' + type(id) + '属性成员', '排除' + type(id) + '属性成员'], '同一种成员属性同时被要求包含和排除。', ['取消其中一项属性条件。']);
  if (c.fastSpeed > c.slowSpeed && c.fastCount + c.slowCount > 6) add('conflict', '高速与低速成员数量超过六个位置',
    ['至少 ' + c.fastCount + ' 位速度 ≥ ' + c.fastSpeed, '至少 ' + c.slowCount + ' 位速度 ≤ ' + c.slowSpeed],
    '这两个速度区间没有重叠，至少需要 ' + (c.fastCount + c.slowCount) + ' 个位置。', ['减少高速或低速成员数量，使总数不超过 6；也可调整速度门槛。']);
  if (!availability) return issues;
  const eligible = filteredPool(inputPool, c);
  let pool = eligible.filter(entry => !required.has(entry.speciesId) || entry.pokemonId === required.get(entry.speciesId));
  if (required.size === 6) pool = pool.filter(entry => required.has(entry.speciesId));
  const filters = [];
  if (c.excludeLegendary) filters.push('排除传说');
  if (c.excludeMythical) filters.push('排除幻之宝可梦');
  if (c.excludedIds.length) filters.push('禁用成员');
  if (c.excludedTypes.length) filters.push('排除 ' + c.excludedTypes.map(type).join('、') + ' 属性成员');
  if (c.noFourfold) filters.push('排除四倍及以上弱点');
  if (c.style !== 'any') filters.push('队伍体系要求');
  if (required.size === 6) filters.push('必带／锁定的六位成员');
  if (c.maxWeak === 0) filters.push('共同弱点上限为 0');
  const causes = entries => {
    const labels = [];
    if (c.excludeLegendary && entries.some(entry => entry.legendary)) labels.push('排除传说');
    if (c.excludeMythical && entries.some(entry => entry.mythical)) labels.push('排除幻之宝可梦');
    if (entries.some(entry => c.excludedIds.some(id => entry.pokemonId === id || entry.excludedBy?.includes(id)))) labels.push('禁用成员');
    const blockedTypes = c.excludedTypes.filter(id => entries.some(entry => entry.typeMask & (1 << (id - 1))));
    if (blockedTypes.length) labels.push('排除 ' + blockedTypes.map(type).join('、') + ' 属性成员');
    if (c.noFourfold && entries.some(entry => entry.fourfold)) labels.push('排除四倍及以上弱点');
    if (c.maxWeak === 0 && entries.some(entry => entry.weakIds.length)) labels.push('共同弱点上限为 0');
    if (['rain', 'sun', 'sand', 'snow'].includes(c.style) && entries.some(entry => entry.traits.some(trait => /-start$/.test(trait) && trait !== c.style + '-start')))
      labels.push('队伍体系排除其他天气启动配置');
    if (entries.some(entry => required.has(entry.speciesId) && entry.pokemonId !== required.get(entry.speciesId))) labels.push('指定的必带形态');
    if (required.size === 6 && entries.some(entry => !required.has(entry.speciesId))) labels.push('必带／锁定的六位成员');
    return labels;
  };
  const originalRequirements = new Map(requirements(inputPool, c, names).map(req => [req.key, req]));
  const reqs = requirements(pool, c, names);
  for (const req of reqs) {
    const count = new Set(req.providers.map(index => pool[index].speciesId)).size;
    if (count >= req.count) continue;
    const original = originalRequirements.get(req.key), providers = (original?.providers || []).map(index => inputPool[index]);
    const limited = new Set(providers.map(entry => entry.speciesId)).size >= req.count;
    if (req.forced && issues.some(issue => issue.conditions.includes('必带／锁定 ' + pokemon(Number(req.key.slice(8)))))) continue;
    add(limited ? 'range' : 'data', '条件“' + req.label + '”缺少可用配置', [req.label, ...(limited ? causes(providers) : [])],
      limited ? '在当前成员范围与排除条件下，只有 ' + count + ' 个物种能满足，需要至少 ' + req.count + ' 个。' :
        '当前资料世代与规则下，没有收录足够的完整配置来满足这项要求；这不代表官方不存在对应的宝可梦或招式。',
      limited ? ['尝试放宽上述成员范围或排除条件，或调整这项要求。'] : ['尝试更换资料世代／规则，或补充完整配招后重新计算。']);
  }
  const forced = [...required].map(([speciesId, id]) => ({ id, speciesId, entries: pool.filter(entry => entry.speciesId === speciesId) })).filter(group => group.entries.length);
  for (const [field, maximum, label] of [['weakIds', c.maxWeak, '共同弱点'], ['typeIds', c.maxSameType, '同属性成员']]) {
    for (let index = 0; index < 18; index++) {
      const groups = forced.filter(group => group.entries.every(entry => entry[field].includes(index)));
      if (groups.length > maximum) add('conflict', '必带／锁定成员与' + type(index + 1) + '的' + label + '上限冲突',
        [...groups.map(group => '必带／锁定 ' + pokemon(group.id)), label + '最多 ' + maximum + ' 位'],
        groups.length + ' 位成员的全部可用配置都' + (field === 'weakIds' ? '具有这个弱点。' : '具有这个属性。'),
        ['可尝试将该上限调整到 ' + groups.length + '，或调整对应必带成员／解除配置锁定；其他条件仍需满足。']);
    }
  }
  if (c.uniqueItems) {
    const items = new Map();
    for (const group of forced) {
      const choices = new Set(group.entries.map(entry => entry.item));
      if (choices.size !== 1 || !group.entries[0].item) continue;
      const item = group.entries[0].item;
      if (!items.has(item)) items.set(item, []); items.get(item).push(group.id);
    }
    for (const ids of items.values()) if (ids.length > 1) add('conflict', '必带／锁定成员的固定道具重复',
      [...ids.map(id => pokemon(id)), '携带道具不重复'], '这些成员的可用配置必须使用相同道具。', ['调整对应配招或解除锁定，或取消道具不重复要求。']);
  }
  const singles = reqs.filter(req => req.count === 1 && req.providers.length && new Set(req.providers.map(index => pool[index].speciesId)).size === 1);
  for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) {
    const a = singles[i], b = singles[j];
    if (pool[a.providers[0]].speciesId !== pool[b.providers[0]].speciesId || a.providers.some(index => b.providers.includes(index))) continue;
    add('range', '两项要求依赖同物种的不同配置', [a.label, b.label],
      '当前资料只有 ' + pool[a.providers[0]].name + ' 能提供这些功能，但没有一份配置能同时提供；同队不能安排两个同物种成员。',
      ['调整其中一项要求，或补充能同时满足要求的完整配招。']);
  }
  const species = new Set(pool.map(entry => entry.speciesId)).size;
  if (species < 6 && !issues.length) add(new Set(inputPool.map(entry => entry.speciesId)).size >= 6 ? 'range' : 'data', '可用完整配置不足六个不同物种', filters,
    '当前范围只有 ' + species + ' 个可用物种。', ['放宽成员范围，或补充完整配招。']);
  const coverage = popcount(pool.reduce((value, entry) => value | entry.attackMask, 0));
  const originalCoverage = popcount(inputPool.reduce((value, entry) => value | entry.attackMask, 0));
  if (coverage < c.minCoverage) add(originalCoverage >= c.minCoverage ? 'range' : 'data', '打击面数量超过当前配置能达到的上限', ['至少克制 ' + c.minCoverage + ' 种属性', ...filters],
    '即使合并全部可用配置，也最多克制 ' + coverage + ' 种单属性目标。', ['将打击面要求调整到 ' + coverage + ' 或更低，或扩大成员范围。']);
  if (c.uniqueItems && species >= 6) {
    const choices = new Set(pool.map(entry => entry.item).filter(Boolean)), empty = new Set(pool.filter(entry => !entry.item).map(entry => entry.speciesId));
    if (choices.size + empty.size < 6) add('range', '道具不重复要求与现有配置范围不兼容', ['携带道具不重复', ...filters],
      '现有不同道具与无道具物种合计只有 ' + (choices.size + empty.size) + ' 种选择，无法安排六位成员。',
      ['补充不同道具的完整配招，扩大成员范围，或取消道具不重复要求。']);
  }
  return issues.slice(0, 20);
}
function diagnosticReport(issues, pool = []) {
  return { results: [], issues, diagnostics: issues.map(issue => issue.title + '：' + issue.explanation), reason: 'impossible',
    strategy: 'checks', stage: '条件冲突检查', total: '0', processed: '0', evaluated: '0', prunedCombinations: '0',
    percent: 100, examined: 0, availableSpecies: new Set(pool.map(entry => entry.speciesId)).size, elapsedMs: 0 };
}
module.exports = { diagnoseConditions, diagnosticReport };
