const { describeFormat } = require('./team-model.cjs');
const { structureFlags, structureBonus, teamDistance } = require('./team-quality.cjs');
const { scenario, battleState, manualBuild } = require('./assistant-scenario.cjs');

const ROLES = [
  ['physical', '物理攻击'], ['special', '特殊攻击'], ['hazards', '布置场地'], ['removal', '清理场地'],
  ['pivot', '轮转中转'], ['speed', '速度控制'], ['support', '队友辅助'], ['setup', '强化'],
  ['recovery', '回复续航'], ['priority', '先制攻击'],
].map(([id, label]) => ({ id, label }));
const STYLES = [
  { id: 'any', label: '不限体系', note: '按所选条件组合成员。' },
  { id: 'rain', label: '雨天', note: '至少一位雨天启动者和一位具有雨天受益特性的成员；排除其他天气启动配置。' },
  { id: 'sun', label: '晴天', note: '至少一位晴天启动者和一位晴天受益成员；排除其他天气启动配置。' },
  { id: 'sand', label: '沙暴', note: '至少一位沙暴启动者和一位具有沙暴受益特性的成员；排除其他天气启动配置。' },
  { id: 'snow', label: '雪天／冰雹', note: '至少一位雪天／冰雹启动者和一位具有对应特性或极光幕的成员；排除其他天气启动配置。' },
  { id: 'room', label: '戏法空间', note: '至少一位戏法空间使用者和两位在所选等级下、常态速度不超过 80 的成员。' },
  { id: 'tailwind', label: '顺风', note: '至少一位顺风使用者；速度门槛按常态速度计算。' },
  { id: 'screens', label: '双墙／极光幕', note: '至少一位同时携带反射壁与光墙，或携带极光幕的成员。' },
];
const bit = id => 1 << (id - 1);
const mask = ids => ids.reduce((value, id) => value | bit(id), 0);
function popcount(value) { let count = 0; for (; value; value &= value - 1) count++; return count; }
function integer(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(label + '超出可选范围。');
  return result;
}
function constraints(input) {
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 50000) throw new Error('配队条件无效或过长。');
  const format = input.format ?? 'all', rule = format === 'all' ? null : describeFormat(format);
  const scopeGeneration = integer(input.scopeGeneration, rule?.generation ?? 0, 0, 9, '资料世代');
  if (rule && scopeGeneration && scopeGeneration !== rule.generation) throw new Error('参考规则与资料世代不一致。');
  const generation = rule?.generation || scopeGeneration || 9, category = rule?.category || input.category || 'singles';
  if (!['singles', 'doubles'].includes(category) || rule?.tier === '1v1' || category === 'doubles' && generation < 3) throw new Error('请选择支持六人队伍的单打或双打玩法。');
  const result = { format, scopeGeneration, generation, category,
    outputFormat: rule?.id || 'gen' + generation + (category === 'doubles' ? 'freedoubles' : 'free'),
    level: integer(input.level, 50, 1, 100, '计算等级'),
    resultCount: integer(input.resultCount, 20, 1, 50, '返回队伍数量'),
    minDifference: integer(input.minDifference, 2, 1, 3, '队伍最少不同成员数'),
    minCoverage: integer(input.minCoverage, 0, 0, generation === 1 ? 15 : generation < 6 ? 17 : 18, '打击面数量'),
    maxWeak: integer(input.maxWeak, 3, 0, 6, '共同弱点上限'),
    maxSameType: integer(input.maxSameType, 6, 1, 6, '同属性成员上限'),
    fastCount: integer(input.fastCount, 0, 0, 6, '高速成员数量'),
    fastSpeed: integer(input.fastSpeed, 150, 1, 999, '高速门槛'),
    slowCount: integer(input.slowCount, 0, 0, 6, '低速成员数量'),
    slowSpeed: integer(input.slowSpeed, 80, 1, 999, '低速门槛'),
    style: input.style ?? 'any', preference: input.preference ?? 'balanced',
  };
  if (!STYLES.some(style => style.id === result.style)) throw new Error('请选择支持的队伍体系。');
  if (!['balanced', 'coverage', 'defense', 'types'].includes(result.preference)) throw new Error('请选择支持的排序偏好。');
  for (const name of ['excludeLegendary', 'excludeMythical', 'noFourfold', 'uniqueItems']) {
    if (input[name] !== undefined && typeof input[name] !== 'boolean') throw new Error('筛选开关无效。');
    result[name] = input[name] === true;
  }
  for (const name of ['requiredIds', 'excludedIds', 'targetTypes', 'attackTypes', 'resistTypes', 'immuneTypes', 'memberTypes', 'excludedTypes']) {
    const values = input[name] ?? [], types = name.endsWith('Types');
    if (!Array.isArray(values) || values.length > (name === 'requiredIds' ? 6 : types ? 18 : 100) ||
      values.some(value => !Number.isInteger(value) || value < 1 || value > (types ? 18 : 20000))) throw new Error('宝可梦或属性条件无效。');
    if (types && values.some(id => generation === 1 && [9, 17, 18].includes(id) || generation < 6 && id === 18)) throw new Error('所选属性在这个世代尚未登场。');
    result[name] = [...new Set(values)];
  }
  result.roles = input.roles ?? [];
  if (!Array.isArray(result.roles) || result.roles.length > ROLES.length || result.roles.some(id => !ROLES.some(role => role.id === id))) throw new Error('队伍功能条件无效。');
  result.roles = [...new Set(result.roles)];
  const counts = input.roleCounts ?? {};
  if (!counts || typeof counts !== 'object' || Array.isArray(counts) || Object.keys(counts).some(id => !ROLES.some(role => role.id === id))) throw new Error('职责人数条件无效。');
  result.roleCounts = Object.fromEntries(ROLES.map(role => [role.id, Math.max(integer(counts[role.id], 0, 0, 6, role.label + '人数'), result.roles.includes(role.id) ? 1 : 0)]));
  const opponents = input.opponents ?? [];
  if (!Array.isArray(opponents) || opponents.length > 6) throw new Error('最多选择 6 位需要应对的对手。');
  result.opponents = opponents.map(value => {
    if (!value || typeof value !== 'object') throw new Error('对手条件无效。');
    const reference = value.reference ?? 'fastest';
    if (!['source', 'fastest', 'manual'].includes(reference)) throw new Error('对手参考配招选择方式无效。');
    const opponent = { pokemonId: integer(value.pokemonId, undefined, 1, 20000, '对手编号'), reference,
      minAttack: integer(value.minAttack, 1, 0, 6, '对手克制打点人数'),
      minResist: integer(value.minResist, 0, 0, 6, '对手抗性人数'), minFaster: integer(value.minFaster, 0, 0, 6, '对手速度优势人数') };
    opponent.id = value.id ?? 'opponent-' + opponent.pokemonId;
    if (typeof opponent.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(opponent.id)) throw new Error('对手路线编号无效。');
    opponent.state = battleState(value.state, generation);
    if (reference === 'manual') opponent.build = manualBuild(value.build, generation);
    if (!opponent.minAttack && !opponent.minResist && !opponent.minFaster) throw new Error('每位对手至少设置一项应对人数要求，或移除该对手。');
    return opponent;
  });
  if (new Set(result.opponents.map(value => value.id)).size !== result.opponents.length) throw new Error('对手路线编号不能重复，请用添加另一条路线。');
  result.scenario = scenario(input.scenario, generation);
  result.requiredMoves = input.requiredMoves ?? [];
  if (!Array.isArray(result.requiredMoves) || result.requiredMoves.length > 12 || result.requiredMoves.some(value => typeof value !== 'string' || !value || value.length > 100)) throw new Error('必备招式最多选择 12 个。');
  result.requiredMoves = [...new Set(result.requiredMoves)];
  return result;
}
function traits(set, features) {
  const moves = set.selection.moves, ability = set.selection.ability, has = names => moves.some(move => names.includes(move));
  const result = [];
  if (features.attacks.some(move => move.category === 'Physical')) result.push('physical');
  if (features.attacks.some(move => move.category === 'Special')) result.push('special');
  if (has(['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'])) result.push('hazards');
  if (has(['Rapid Spin', 'Defog', 'Mortal Spin', 'Tidy Up'])) result.push('removal');
  if (has(['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Chilly Reception', 'Teleport'])) result.push('pivot');
  if (has(['Trick Room', 'Tailwind', 'Icy Wind', 'Electroweb', 'Thunder Wave'])) result.push('speed');
  if (has(['Follow Me', 'Rage Powder', 'Fake Out', 'Helping Hand', 'Wide Guard', 'Reflect', 'Light Screen', 'Aurora Veil'])) result.push('support');
  if (has(['Swords Dance', 'Dragon Dance', 'Nasty Plot', 'Calm Mind', 'Quiver Dance', 'Shell Smash', 'Bulk Up', 'Iron Defense'])) result.push('setup');
  if (has(['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Wish', 'Milk Drink', 'Synthesis', 'Rest', 'Strength Sap', 'Shore Up', 'Moonlight', 'Morning Sun'])) result.push('recovery');
  if (features.attacks.some(move => move.category !== 'Status' && move.priority > 0)) result.push('priority');
  const weather = {
    rain: [['Drizzle', 'Primordial Sea'], ['Rain Dance'], ['Swift Swim', 'Rain Dish', 'Hydration', 'Dry Skin']],
    sun: [['Drought', 'Desolate Land', 'Orichalcum Pulse'], ['Sunny Day'], ['Chlorophyll', 'Solar Power', 'Protosynthesis', 'Flower Gift', 'Harvest']],
    sand: [['Sand Stream'], ['Sandstorm'], ['Sand Rush', 'Sand Force', 'Sand Veil']],
    snow: [['Snow Warning'], ['Snowscape', 'Hail', 'Chilly Reception'], ['Slush Rush', 'Ice Body', 'Snow Cloak']],
  };
  for (const [id, [abilities, starters, users]] of Object.entries(weather)) {
    if (abilities.includes(ability) || has(starters)) result.push(id + '-start');
    if (users.includes(ability) || id === 'sun' && has(['Solar Beam', 'Solar Blade']) || id === 'snow' && has(['Aurora Veil'])) result.push(id + '-user');
  }
  if (has(['Trick Room'])) result.push('room');
  if (has(['Tailwind'])) result.push('tailwind');
  if (has(['Aurora Veil']) || moves.includes('Reflect') && moves.includes('Light Screen')) result.push('screens');
  return result;
}

// Keep only the best bounded frontier, rather than allocating all N^6 combinations.
class Frontier {
  constructor(width, perGroup) { this.width = width; this.perGroup = perGroup; this.heap = []; this.keys = new Set(); this.groups = new Map(); this.clipped = false; }
  cutoff() { return this.heap.length < this.width ? -Infinity : this.heap[0].score; }
  up(at) {
    while (at && this.heap[at].score < this.heap[(at - 1) >> 1].score) {
      const next = (at - 1) >> 1; [this.heap[at], this.heap[next]] = [this.heap[next], this.heap[at]]; at = next;
    } return at;
  }
  down(at) {
    while (true) {
      const left = at * 2 + 1, right = left + 1; let next = at;
      if (left < this.heap.length && this.heap[left].score < this.heap[next].score) next = left;
      if (right < this.heap.length && this.heap[right].score < this.heap[next].score) next = right;
      if (next === at) return;
      [this.heap[at], this.heap[next]] = [this.heap[next], this.heap[at]]; at = next;
    }
  }
  remove(state) {
    const at = this.heap.indexOf(state), last = this.heap.pop();
    this.keys.delete(state.key); this.groups.get(state.group).delete(state);
    if (at < this.heap.length) { this.heap[at] = last; this.down(this.up(at)); }
  }
  add(state) {
    if (this.keys.has(state.key)) return;
    const bucket = this.groups.get(state.group);
    if (bucket?.size >= this.perGroup) {
      this.clipped = true; let worst = null;
      for (const value of bucket) if (!worst || value.score < worst.score) worst = value;
      if (state.score <= worst.score) return;
      this.remove(worst);
    }
    if (this.heap.length === this.width) {
      this.clipped = true; if (state.score <= this.heap[0].score) return; this.remove(this.heap[0]);
    }
    if (!this.groups.has(state.group)) this.groups.set(state.group, new Set());
    this.groups.get(state.group).add(state); this.keys.add(state.key); this.heap.push(state); this.up(this.heap.length - 1);
  }
}
function requirements(pool, c, names = {}) {
  const list = [], typeName = id => names.types?.[id] || '属性 ' + id, pokemonName = id => names.pokemon?.[id] || '宝可梦 ' + id;
  const add = (key, label, test, count = 1, forced = false) => list.push({ key, label, count, forced, providers: pool.flatMap((entry, index) => test(entry) ? [index] : []) });
  for (const id of c.requiredIds) add('pokemon-' + id, '包含' + pokemonName(id), entry => entry.pokemonId === id, 1, true);
  for (const id of c.targetTypes) add('target-' + id, '克制' + typeName(id), entry => Boolean(entry.attackMask & bit(id)));
  for (const id of c.attackTypes) add('attack-' + id, '携带' + typeName(id) + '属性攻击招式', entry => Boolean(entry.moveMask & bit(id)));
  for (const id of c.resistTypes) add('resist-' + id, '有成员抵抗／免疫' + typeName(id), entry => Boolean(entry.resistMask & bit(id)));
  for (const id of c.immuneTypes) add('immune-' + id, '有成员免疫' + typeName(id), entry => Boolean(entry.immuneMask & bit(id)));
  for (const id of c.memberTypes) add('type-' + id, '包含' + typeName(id) + '属性成员', entry => Boolean(entry.typeMask & bit(id)));
  for (const role of ROLES) {
    const count = Math.max(c.roleCounts?.[role.id] || 0, c.roles.includes(role.id) ? 1 : 0);
    if (count) add('role-' + role.id, '具备' + role.label, entry => entry.traits.includes(role.id), count);
  }
  (c.opponents || []).forEach((opponent, index) => {
    const name = pokemonName(opponent.pokemonId) + (c.opponents.filter(value => value.pokemonId === opponent.pokemonId).length > 1 ? '（路线 ' + (index + 1) + '）' : ''), flag = 1 << index;
    const key = opponent.id || opponent.pokemonId;
    if (opponent.minAttack) add('opponent-attack-' + key, '对' + name + '有可命中的克制打点', entry => Boolean(entry.opponentAttackMask & flag), opponent.minAttack);
    if (opponent.minResist) add('opponent-resist-' + key, '抵抗／免疫' + name + '参考配招的全部攻击', entry => Boolean(entry.opponentResistMask & flag), opponent.minResist);
    if (opponent.minFaster) add('opponent-speed-' + key, '选定战况下先于' + name + '行动（同优先度）', entry => Boolean(entry.opponentFasterMask & flag), opponent.minFaster);
  });
  for (const name of c.requiredMoves) add('move-' + name, '携带' + (names.moves?.[name] || name), entry =>
    entry.moves.some(move => move === name || name === 'Hidden Power' && /^Hidden Power(?:\s|$)/i.test(move)));
  if (c.fastCount) add('fast', c.fastCount + ' 位常态速度 ≥ ' + c.fastSpeed, entry => entry.speed >= c.fastSpeed, c.fastCount);
  if (c.slowCount) add('slow', c.slowCount + ' 位常态速度 ≤ ' + c.slowSpeed, entry => entry.speed <= c.slowSpeed, c.slowCount);
  if (['rain', 'sun', 'sand', 'snow'].includes(c.style)) {
    const label = STYLES.find(style => style.id === c.style).label;
    add('style-start', label + '启动', entry => entry.traits.includes(c.style + '-start'));
    add('style-user', label + '受益配置', entry => entry.traits.includes(c.style + '-user'));
  } else if (c.style === 'room') {
    add('style-start', '戏法空间启动', entry => entry.traits.includes('room'));
    add('style-user', '两位空间低速成员（常态速度 ≤ 80）', entry => entry.speed <= 80, 2);
  } else if (c.style !== 'any') add('style', STYLES.find(style => style.id === c.style).label, entry => entry.traits.includes(c.style));
  return list;
}
function filteredPool(pool, c) {
  const excluded = mask(c.excludedTypes);
  return pool.filter(entry => !(c.excludeLegendary && entry.legendary || c.excludeMythical && entry.mythical ||
    c.excludedIds.some(id => entry.excludedBy?.includes(id) || entry.pokemonId === id) || entry.typeMask & excluded ||
    c.noFourfold && entry.fourfold || c.maxWeak === 0 && entry.weakIds.length ||
    ['rain', 'sun', 'sand', 'snow'].includes(c.style) && entry.traits.some(trait => /-start$/.test(trait) && trait !== c.style + '-start')));
}
function seedSolve(inputPool, c, { names = {}, now = () => performance.now(), onProgress = () => {}, width = 64, round = 1, cancelled = () => false, avoidTeams = [], excludedRosters = [] } = {}) {
  const start = now(), allMask = mask(Array.from({ length: 18 }, (_, i) => i + 1));
  const pool = filteredPool(inputPool, c);
  const reqs = requirements(pool, c, names), diagnostics = [], forcedSpecies = [];
  if (new Set(pool.map(entry => entry.speciesId)).size < 6) diagnostics.push('当前规则和排除条件下，完整配置不足六个不同物种。可放宽排除条件或更新配招资料。');
  for (const req of reqs) {
    const species = new Set(req.providers.map(index => pool[index].speciesId));
    if (species.size < req.count) diagnostics.push('条件“' + req.label + '”需要 ' + req.count + ' 位成员，资料中只有 ' + species.size + ' 个可用物种。');
    if (req.forced && species.size) forcedSpecies.push([...species][0]);
  }
  if (new Set(forcedSpecies).size < forcedSpecies.length) diagnostics.push('必带成员包含同物种的多个形态；助手每队只安排一位同物种成员。');
  const unionAttack = pool.reduce((value, entry) => value | entry.attackMask, 0);
  if (popcount(unionAttack) < c.minCoverage) diagnostics.push('当前资料最多覆盖 ' + popcount(unionAttack) + ' 种单属性目标，达不到所需的 ' + c.minCoverage + ' 种。');
  const finish = (results, reason, clipped) => ({ results, reason, diagnostics, clipped, examined, pruned,
    availableSpecies: new Set(pool.map(entry => entry.speciesId)).size, elapsedMs: Math.round(now() - start) });
  let examined = 0, pruned = 0;
  if (diagnostics.length) return finish([], 'impossible', false);
  const overlaps = new Map(), excludedTeams = new Set(excludedRosters);
  avoidTeams.forEach((team, index) => team.members.forEach(entry => {
    if (!overlaps.has(entry.speciesId)) overlaps.set(entry.speciesId, []);
    overlaps.get(entry.speciesId).push(index);
  }));
  pool.forEach(entry => { entry.covers = []; entry.structureMask = structureFlags(entry); });
  reqs.forEach((req, index) => req.providers.forEach(provider => pool[provider].covers.push(index)));
  let states = [{ selected: [], counts: new Uint8Array(reqs.length), weak: new Uint8Array(18), types: new Uint8Array(18),
    attack: 0, resist: 0, typeMask: 0, structureMask: 0, overlap: new Uint8Array(avoidTeams.length), commonType: allMask, score: 0, key: '' }], clipped = false;
  let lastUpdate = start, stopped = false, evaluated = 0;
  let stageTotal = 0, stageProcessed = 0;
  const report = (depth, force = false) => {
    const current = now();
    if (force || current - lastUpdate >= 250) {
      onProgress({ phase: 'searching', strategy: 'guided', round, stage: '第 ' + round + ' 轮 · 组队 ' + (depth + 1) + '/6',
        total: String(stageTotal), processed: String(stageProcessed), percent: stageTotal ? stageProcessed / stageTotal * 100 : 100,
        examined, evaluated: String(evaluated), prunedCombinations: String(pruned), found: 0 }); lastUpdate = current;
    }
  };
  const scoreFor = (state, entry, counts) => {
    const coverage = popcount(state.attack | entry.attackMask), resist = popcount(state.resist | entry.resistMask);
    const diversity = popcount(state.typeMask | entry.typeMask);
    let shared = 0;
    for (let i = 0; i < 18; i++) shared += Math.max(0, state.weak[i] - 1) + (entry.weakIds.includes(i) && state.weak[i] ? 1 : 0);
    const progress = counts.reduce((sum, count, index) => sum + Math.min(count, reqs[index].count), 0);
    if (c.preference === 'balanced') return progress * 1000 + coverage * 12 + resist * 6 + diversity * 3 - shared * 5 + structureBonus(state.structureMask | entry.structureMask, c);
    return progress * 1000 + (c.preference === 'coverage' ? coverage * 20 + resist * 3 + diversity :
      c.preference === 'defense' ? resist * 20 + coverage * 3 + diversity - shared * 15 : diversity * 20 + coverage * 3 + resist) - shared * 2;
  };
  for (let depth = 0; depth < 6 && states.length; depth++) {
    const frontier = new Frontier(width, depth === 5 ? 1 : Math.max(2, Math.floor(width / 8)));
    const work = states.map(state => {
      let anchor = null;
      for (let i = 0; i < reqs.length; i++) if (state.counts[i] < reqs[i].count && (!anchor || reqs[i].providers.length < anchor.providers.length)) anchor = reqs[i];
      return { state, choices: anchor ? anchor.providers : Array.from(pool.keys()) };
    });
    stageTotal = work.reduce((sum, row) => sum + row.choices.length, 0); stageProcessed = 0; report(depth, true);
    for (const { state, choices } of work) {
      for (const index of choices) {
        if ((examined++ & 127) === 0) { report(depth); if (cancelled()) { stopped = true; break; } }
        stageProcessed++; if (depth === 5) evaluated++;
        const entry = pool[index], chosen = state.selected.map(value => pool[value]);
        const overlapping = overlaps.get(entry.speciesId) || [];
        if (overlapping.some(index => state.overlap[index] >= 6 - c.minDifference)) { pruned++; continue; }
        if (chosen.some(value => value.speciesId === entry.speciesId) ||
          c.uniqueItems && entry.item && chosen.some(value => value.item === entry.item) ||
          /monotype/.test(c.format) && !(state.commonType & entry.typeMask) ||
          entry.weakIds.some(id => state.weak[id] >= c.maxWeak) ||
          entry.typeIds.some(id => state.types[id] >= c.maxSameType)) { pruned++; continue; }
        const counts = state.counts.slice();
        for (const req of entry.covers) counts[req]++;
        const remaining = 5 - depth;
        if (reqs.some((req, i) => req.count - counts[i] > remaining) ||
          reqs.filter((req, i) => req.forced && !counts[i]).length > remaining) { pruned++; continue; }
        if (!remaining && (reqs.some((req, i) => counts[i] < req.count) || popcount(state.attack | entry.attackMask) < c.minCoverage)) { pruned++; continue; }
        const score = scoreFor(state, entry, counts);
        if (score < frontier.cutoff()) { frontier.clipped = true; continue; }
        const selected = [...state.selected, index].sort((a, b) => a - b), key = selected.join(',');
        if (frontier.keys.has(key)) continue;
        const weak = state.weak.slice(), types = state.types.slice(), overlap = state.overlap.slice();
        overlapping.forEach(index => overlap[index]++);
        for (const id of entry.weakIds) weak[id]++;
        for (const id of entry.typeIds) types[id]++;
        const group = selected.map(value => pool[value].speciesId).sort((a, b) => a - b).join(',');
        if (depth === 5 && excludedTeams.has(group)) { pruned++; continue; }
        frontier.add({ selected, key, group, counts, weak, types, attack: state.attack | entry.attackMask, resist: state.resist | entry.resistMask,
          typeMask: state.typeMask | entry.typeMask, structureMask: state.structureMask | entry.structureMask, overlap, commonType: state.commonType & entry.typeMask, score });
      }
    }
    report(depth, true); if (stopped) break;
    clipped ||= frontier.clipped;
    states = frontier.heap.sort((a, b) => b.score - a.score);
  }
  const distinct = new Set(), results = [];
  for (const state of states) {
    if (state.selected.length !== 6) continue;
    const members = state.selected.map(index => pool[index]), species = members.map(entry => entry.speciesId).sort((a, b) => a - b).join(',');
    if (distinct.has(species) || results.some(old => teamDistance(old.members, members) < c.minDifference)) continue; distinct.add(species);
    const checks = reqs.map((req, i) => ({ label: req.label, count: state.counts[i], required: req.count,
      members: members.filter(entry => entry.covers.includes(i)).map(entry => entry.name) }));
    checks.push({ label: '单属性目标打击面', count: popcount(state.attack), ...(c.minCoverage ? { required: c.minCoverage } : {}), members: [] },
      { label: '每种属性最多 ' + c.maxWeak + ' 位弱点成员', count: Math.max(...state.weak), maximum: c.maxWeak, members: [] },
      { label: '同属性成员最多 ' + c.maxSameType + ' 位', count: Math.max(...state.types), maximum: c.maxSameType, members: [] });
    if (c.uniqueItems) checks.push({ label: '携带道具不重复（无道具不计）', count: new Set(members.map(entry => entry.item).filter(Boolean)).size, members: [] });
    for (const [enabled, label] of [[c.excludeLegendary, '已排除传说宝可梦'], [c.excludeMythical, '已排除幻之宝可梦'],
      [c.noFourfold, '全部成员无四倍及以上弱点'], [c.excludedIds.length, '未使用禁用宝可梦（含同物种形态）'],
      [c.excludedTypes.length, '未使用排除属性的成员']]) if (enabled) checks.push({ label, count: 6, members: [] });
    results.push({ members, checks, metrics: { coverage: popcount(state.attack), resistances: popcount(state.resist),
      distinctTypes: popcount(state.typeMask), maxWeak: Math.max(...state.weak) } });
    if (results.length === c.resultCount) break;
  }
  if (!results.length) diagnostics.push(clipped ? '初始试算没有找到符合条件的队伍，继续完整搜索。' :
    '当前完整配置无法同时满足这些条件；可放宽共同弱点、道具或成员要求。');
  return { ...finish(results, stopped ? 'cancelled' : clipped ? 'bounded' : 'exhausted', clipped), evaluated, total: String(stageTotal), processed: String(stageProcessed) };
}
function solve(pool, c, options) { return require('./team-search.cjs').solve(pool, c, options); }
module.exports = { ROLES, STYLES, bit, mask, popcount, constraints, traits, solve, seedSolve, requirements, filteredPool };

