const { popcount, requirements, seedSolve, filteredPool } = require('./team-solver.cjs');
const { structureFlags, structureBonus, assessment, teamDistance, diverseTeams } = require('./team-quality.cjs');

function combinationTable(groups) {
  const suffix = Array.from({ length: groups.length + 1 }, () => Array(7).fill(0n));
  suffix[groups.length][0] = 1n;
  for (let i = groups.length - 1; i >= 0; i--) {
    suffix[i][0] = 1n;
    for (let count = 1; count <= 6; count++)
      suffix[i][count] = suffix[i + 1][count] + BigInt(groups[i].entries.length) * suffix[i + 1][count - 1];
  }
  return suffix;
}
function percentage(processed, total) { return total ? Math.min(100, Number(processed) / Number(total) * 100) : 100; }
function resultTarget(speciesCount, requiredCount, requested, difference) {
  if (difference > Math.min(6 - requiredCount, speciesCount - 6)) return 1;
  let combinations = 1n;
  for (let i = 0; i < 6 - requiredCount; i++)
    combinations = combinations * BigInt(Math.max(0, speciesCount - requiredCount - i)) / BigInt(i + 1);
  return Number(combinations < BigInt(requested) ? combinations : BigInt(requested)) || 1;
}
function score(attack, resist, typeMask, shared, preference, structureMask = 0, c = {}) {
  const a = popcount(attack), r = popcount(resist), t = popcount(typeMask);
  if (preference === 'balanced') return a * 12 + r * 6 + t * 3 - shared * 5 + structureBonus(structureMask, c);
  return (preference === 'coverage' ? a * 20 + r * 3 + t :
    preference === 'defense' ? r * 20 + a * 3 + t - shared * 15 : t * 20 + a * 3 + r) - shared * 2;
}
function teamResult(state, reqs, c) {
  const checks = reqs.map((req, index) => ({ label: req.label, count: state.counts[index], required: req.count,
    members: state.members.filter(entry => entry.covers.includes(index)).map(entry => entry.name) }));
  checks.push({ label: '单属性目标打击面', count: popcount(state.attack), ...(c.minCoverage ? { required: c.minCoverage } : {}), members: [] },
    { label: '每种属性最多 ' + c.maxWeak + ' 位弱点成员', count: Math.max(...state.weak), maximum: c.maxWeak, members: [] },
    { label: '同属性成员最多 ' + c.maxSameType + ' 位', count: Math.max(...state.types), maximum: c.maxSameType, members: [] });
  for (const [enabled, label] of [[c.uniqueItems, '携带道具不重复（无道具不计）'], [c.excludeLegendary, '已排除传说宝可梦'],
    [c.excludeMythical, '已排除幻之宝可梦'], [c.noFourfold, '全部成员无四倍及以上弱点'],
    [c.excludedIds.length, '未使用禁用宝可梦（含同物种形态）'], [c.excludedTypes.length, '未使用排除属性的成员']])
    if (enabled) checks.push({ label, count: 6, members: [] });
  const metrics = { coverage: popcount(state.attack), resistances: popcount(state.resist), distinctTypes: popcount(state.typeMask), maxWeak: Math.max(...state.weak) };
  return { members: state.members, checks, metrics, assessment: assessment(state.members, metrics, c, state.shared) };
}
function previewReporter(callback, now, reqs, c) {
  let last = -Infinity, signature = '';
  return states => {
    if (!callback || !states.length) return;
    const time = now(); if (time - last < 750) return;
    const selected = states.slice(0, 3), key = selected.map(state => state.score + ':' + state.members.map(entry => entry.id).sort().join(',')).join('|');
    if (key === signature) return;
    signature = key; last = time;
    callback(selected.map(state => teamResult(state, reqs, c)));
  };
}
function exactSolve(inputPool, c, { names = {}, onProgress = () => {}, now = () => performance.now(), cancelled = () => false, excludedRosters = [], onPreview } = {}) {
  const began = now();
  let pool = filteredPool(inputPool, c);
  const forcedSpecies = new Map(), diagnostics = [];
  for (const id of c.requiredIds) {
    const entry = pool.find(entry => entry.pokemonId === id);
    if (!entry) diagnostics.push('条件“包含' + (names.pokemon?.[id] || id) + '”没有可用的完整配置。');
    else if (forcedSpecies.has(entry.speciesId)) diagnostics.push('必带成员含同物种的多个形态，每队只安排一位同物种成员。');
    else forcedSpecies.set(entry.speciesId, id);
  }
  pool = pool.filter(entry => !forcedSpecies.has(entry.speciesId) || entry.pokemonId === forcedSpecies.get(entry.speciesId));
  if (forcedSpecies.size === 6) pool = pool.filter(entry => forcedSpecies.has(entry.speciesId));
  const reqs = requirements(pool, c, names), groupsBySpecies = new Map();
  pool.forEach(entry => {
    entry.covers = []; entry.structureMask = structureFlags(entry);
    if (!groupsBySpecies.has(entry.speciesId)) groupsBySpecies.set(entry.speciesId, { speciesId: entry.speciesId, entries: [] });
    groupsBySpecies.get(entry.speciesId).entries.push(entry);
  });
  reqs.forEach((req, i) => {
    req.providers.forEach(index => pool[index].covers.push(i));
    if (new Set(req.providers.map(index => pool[index].speciesId)).size < req.count)
      diagnostics.push('条件“' + req.label + '”需要 ' + req.count + ' 位成员，当前资料不足。');
  });
  if (groupsBySpecies.size < 6) diagnostics.push('当前筛选范围中的完整配置不足六个不同物种。');
  if (popcount(pool.reduce((bits, entry) => bits | entry.attackMask, 0)) < c.minCoverage) diagnostics.push('当前配置的打击面无法达到所需数量。');
  const forced = [], free = [];
  for (const group of groupsBySpecies.values()) (forcedSpecies.has(group.speciesId) ? forced : free).push(group);
  const desirability = entry => score(entry.attackMask, entry.resistMask, entry.typeMask, 0, c.preference, entry.structureMask, c) + entry.covers.length * 40;
  for (const group of [...forced, ...free]) {
    group.entries.sort((a, b) => desirability(b) - desirability(a));
    group.guaranteedWeak = group.entries[0].weakIds.filter(id => group.entries.every(entry => entry.weakIds.includes(id)));
  }
  forced.sort((a, b) => a.entries.length - b.entries.length);
  free.sort((a, b) => desirability(b.entries[0]) - desirability(a.entries[0]));
  const ways = combinationTable(free), forcedProducts = Array(forced.length + 1).fill(1n), freeCount = 6 - forced.length;
  for (let i = forced.length - 1; i >= 0; i--) forcedProducts[i] = forcedProducts[i + 1] * BigInt(forced[i].entries.length);
  const total = diagnostics.length || freeCount < 0 ? 0n : forcedProducts[0] * ways[0][freeCount];
  let processed = 0n, evaluated = 0n, prunedCombinations = 0n, examined = 0, lastUpdate = began, stopped = false, seedTeams = 0;
  const best = new Map();
  // Keep the best configuration of each distinct species composition, up to the requested count.
  const target = resultTarget(groupsBySpecies.size, forcedSpecies.size, c.resultCount, c.minDifference);
  const ranked = () => diverseTeams([...best.values()].sort((a, b) => b.score - a.score), target, c.minDifference);
  const publishPreview = previewReporter(onPreview, now, reqs, c);
  const progress = (force = false, phase = 'searching') => {
    const current = now();
    if (force || current - lastUpdate >= 250) {
      publishPreview(ranked());
      onProgress({ phase, total: total.toString(), processed: processed.toString(), evaluated: evaluated.toString(),
        prunedCombinations: prunedCombinations.toString(), percent: percentage(processed, total),
        examined, found: ranked().length, seedTeams, elapsedMs: Math.round(current - began) });
      lastUpdate = current;
    }
  };
  const finish = reason => {
    progress(true);
    return { results: ranked().map(result => teamResult(result, reqs, c)), reason, diagnostics, total: total.toString(), processed: processed.toString(), evaluated: evaluated.toString(),
      prunedCombinations: prunedCombinations.toString(), percent: percentage(processed, total), examined,
      pruned: prunedCombinations.toString(), seedTeams, availableSpecies: groupsBySpecies.size, elapsedMs: Math.round(now() - began) };
  };
  progress(true);
  if (diagnostics.length) return finish('impossible');
  const empty = { members: [], counts: new Uint8Array(reqs.length), weak: new Uint8Array(18), types: new Uint8Array(18),
    attack: 0, resist: 0, typeMask: 0, structureMask: 0, commonType: (1 << 18) - 1, shared: 0 };
  function extend(state, entry) {
    if (c.uniqueItems && entry.item && state.members.some(member => member.item === entry.item) ||
      /monotype/.test(c.format) && !(state.commonType & entry.typeMask) ||
      entry.weakIds.some(id => state.weak[id] >= c.maxWeak) || entry.typeIds.some(id => state.types[id] >= c.maxSameType)) return null;
    const counts = state.counts.slice(), weak = state.weak.slice(), types = state.types.slice();
    for (const i of entry.covers) counts[i]++;
    let shared = state.shared;
    for (const id of entry.weakIds) { if (weak[id]) shared++; weak[id]++; }
    for (const id of entry.typeIds) types[id]++;
    return { members: [...state.members, entry], counts, weak, types, shared, attack: state.attack | entry.attackMask,
      resist: state.resist | entry.resistMask, typeMask: state.typeMask | entry.typeMask, structureMask: state.structureMask | entry.structureMask, commonType: state.commonType & entry.typeMask };
  }
  function remember(state) {
    if (reqs.some((req, i) => state.counts[i] < req.count) || popcount(state.attack) < c.minCoverage) return;
    const key = state.members.map(entry => entry.speciesId).sort((a, b) => a - b).join(',');
    if (excludedRosters.includes(key)) return;
    const value = score(state.attack, state.resist, state.typeMask, state.shared, c.preference, state.structureMask, c);
    if (best.has(key) && best.get(key).score >= value) return;
    best.set(key, { ...state, score: value });
    if (c.minDifference === 1 && best.size > target) {
      const ordered = [...best.entries()].sort((a, b) => b[1].score - a[1].score); best.delete(ordered.at(-1)[0]);
    }
  }
  // Seed a useful lower bound, then account for every combination with exact subtree counts.
  progress(true, 'seeding');
  const seed = seedSolve(pool, c, { names, width: Math.max(16, target), cancelled, excludedRosters });
  seedTeams = seed.results.length;
  // seedSolve populates the same requirement indices.
  for (const result of seed.results) {
    let state = empty;
    for (const entry of result.members) { state = extend(state, entry); if (!state) break; }
    if (state?.members.length === 6) remember(state);
  }
  const suffix = Array.from({ length: free.length + 1 }, () => ({ attack: 0, resist: 0, types: 0, counts: new Uint16Array(reqs.length) }));
  for (let i = free.length - 1; i >= 0; i--) {
    const row = suffix[i], next = suffix[i + 1]; row.attack = next.attack; row.resist = next.resist; row.types = next.types; row.counts.set(next.counts);
    const covered = new Set();
    for (const entry of free[i].entries) {
      row.attack |= entry.attackMask; row.resist |= entry.resistMask; row.types |= entry.typeMask;
      entry.covers.forEach(index => covered.add(index));
    }
    for (const index of covered) row.counts[index]++;
  }
  const future = (forcedAt, freeAt, state) => {
    const base = freeCount ? suffix[freeAt] : { attack: 0, resist: 0, types: 0, counts: new Uint16Array(reqs.length) };
    const row = { ...base, counts: base.counts.slice() }, guaranteed = state.weak.slice();
    for (let i = forcedAt; i < forced.length; i++) {
      const covered = new Set();
      for (const entry of forced[i].entries) {
        row.attack |= entry.attackMask; row.resist |= entry.resistMask; row.types |= entry.typeMask;
        entry.covers.forEach(index => covered.add(index));
      }
      for (const index of covered) row.counts[index]++;
      for (const id of forced[i].guaranteedWeak) guaranteed[id]++;
    }
    row.minShared = guaranteed.reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    row.impossibleWeak = guaranteed.some(count => count > c.maxWeak);
    return row;
  };
  function canImprove(state, available, remaining) {
    if (available.impossibleWeak) return false;
    if (reqs.some((req, i) => state.counts[i] + Math.min(remaining, available.counts[i]) < req.count)) return false;
    const a = popcount(state.attack | available.attack);
    if (a < c.minCoverage) return false;
    // Diverse selection depends on more than the top scores; the exact path is limited to small inputs.
    if (c.minDifference > 1) return true;
    if (best.size < target) return true;
    const r = popcount(state.resist | available.resist);
    const t = Math.min(popcount(state.typeMask | available.types), popcount(state.typeMask) + remaining * 2);
    const shared = available.minShared ?? state.shared;
    const upper = c.preference === 'balanced' ? a * 12 + r * 6 + t * 3 - shared * 5 + 80 : (c.preference === 'coverage' ? a * 20 + r * 3 + t :
      c.preference === 'defense' ? r * 20 + a * 3 + t - shared * 15 : t * 20 + a * 3 + r) - shared * 2;
    return upper > ranked().at(-1).score;
  }
  function skip(count) { processed += count; prunedCombinations += count; }
  function check() {
    if ((examined++ & 255) === 0) { progress(); if (cancelled()) stopped = true; }
    return stopped;
  }
  function visitFree(start, remaining, state) {
    if (check()) return;
    if (!remaining) {
      evaluated++; processed++; remember(state); return;
    }
    const count = ways[start][remaining];
    if (!count) return;
    if (!canImprove(state, suffix[start], remaining)) { skip(count); return; }
    for (let i = start; i <= free.length - remaining && !stopped; i++) {
      const children = ways[i + 1][remaining - 1];
      for (const entry of free[i].entries) {
        if (check()) return;
        const next = extend(state, entry);
        if (!next) skip(children); else visitFree(i + 1, remaining - 1, next);
      }
    }
  }
  function visitForced(index, state) {
    if (check()) return;
    if (index === forced.length) { visitFree(0, freeCount, state); return; }
    const count = forcedProducts[index] * ways[0][freeCount], remaining = 6 - state.members.length;
    if (!canImprove(state, future(index, 0, state), remaining)) { skip(count); return; }
    const children = forcedProducts[index + 1] * ways[0][freeCount];
    for (const entry of forced[index].entries) {
      if (check()) return;
      const next = extend(state, entry);
      if (!next) skip(children); else visitForced(index + 1, next);
    }
  }
  progress(true);
  visitForced(0, empty);
  if (!best.size && !stopped) diagnostics.push('当前完整配置无法同时满足这些条件，可调整成员、弱点、速度或功能要求。');
  if (!stopped && processed !== total) throw new Error('搜索组合计数不一致，请重新计算。');
  return finish(stopped ? 'cancelled' : 'exhausted');
}

function guidedSearch(inputPool, c, { names = {}, onProgress = () => {}, now = () => performance.now(), cancelled = () => false, excludedRosters = [], onPreview } = {}) {
  const began = now(), diagnostics = [], requiredSpecies = new Map();
  let pool = filteredPool(inputPool, c);
  for (const id of c.requiredIds) {
    const entry = pool.find(entry => entry.pokemonId === id);
    if (!entry) diagnostics.push('条件“包含' + (names.pokemon?.[id] || id) + '”没有可用完整配置。');
    else if (requiredSpecies.has(entry.speciesId)) diagnostics.push('必带成员含同物种的多个形态，每队只安排一位同物种成员。');
    else requiredSpecies.set(entry.speciesId, id);
  }
  pool = pool.filter(entry => !requiredSpecies.has(entry.speciesId) || entry.pokemonId === requiredSpecies.get(entry.speciesId));
  if (requiredSpecies.size === 6) pool = pool.filter(entry => requiredSpecies.has(entry.speciesId));
  const reqs = requirements(pool, c, names), species = new Set(pool.map(entry => entry.speciesId));
  pool.forEach(entry => { entry.covers = []; entry.structureMask = structureFlags(entry); });
  reqs.forEach((req, index) => {
    req.providers.forEach(provider => pool[provider].covers.push(index));
    if (new Set(req.providers.map(index => pool[index].speciesId)).size < req.count) diagnostics.push('条件“' + req.label + '”需要 ' + req.count + ' 位成员，当前资料不足。');
  });
  if (species.size < 6) diagnostics.push('当前筛选范围中的完整配置不足六个不同物种。');
  if (species.size === 6 && excludedRosters.includes([...species].sort((a, b) => a - b).join(','))) diagnostics.push('当前资料只能组成原来的六位成员，没有可替换成员的队伍。');
  if (popcount(pool.reduce((value, entry) => value | entry.attackMask, 0)) < c.minCoverage) diagnostics.push('当前配置的打击面无法达到所需数量。');
  if (c.fastSpeed > c.slowSpeed && c.fastCount + c.slowCount > 6) diagnostics.push('高速与低速条件互不重叠，所需成员数量超过六位。');
  if (c.uniqueItems) {
    const items = new Set(pool.map(entry => entry.item).filter(Boolean)), empty = new Set(pool.filter(entry => !entry.item).map(entry => entry.speciesId));
    if (items.size + empty.size < 6) diagnostics.push('可用的不同道具与无道具成员不足六位，无法满足道具不重复条件。');
  }
  let examined = 0, evaluated = 0n, pruned = 0n, round = 0, lastUpdate = began;
  let workTotal = 0, workDone = 0, stage = '条件检查', stopped = false;
  const best = new Map(), target = resultTarget(species.size, requiredSpecies.size, c.resultCount, c.minDifference);
  let cutoff = -Infinity;
  const ranked = () => [...best.values()].sort((a, b) => b.score - a.score);
  const publishPreview = previewReporter(onPreview, now, reqs, c);
  const stateFor = members => {
    const state = { members: [], counts: new Uint8Array(reqs.length), weak: new Uint8Array(18), types: new Uint8Array(18),
      attack: 0, resist: 0, typeMask: 0, structureMask: 0, commonType: (1 << 18) - 1, shared: 0 };
    for (const entry of members) {
      if (state.members.some(member => member.speciesId === entry.speciesId) ||
        c.uniqueItems && entry.item && state.members.some(member => member.item === entry.item) ||
        /monotype/.test(c.format) && !(state.commonType & entry.typeMask) ||
        entry.weakIds.some(id => state.weak[id] >= c.maxWeak) || entry.typeIds.some(id => state.types[id] >= c.maxSameType)) return null;
      state.members.push(entry); entry.covers.forEach(index => state.counts[index]++);
      entry.weakIds.forEach(id => { if (state.weak[id]) state.shared++; state.weak[id]++; });
      entry.typeIds.forEach(id => state.types[id]++);
      state.attack |= entry.attackMask; state.resist |= entry.resistMask; state.typeMask |= entry.typeMask; state.structureMask |= entry.structureMask; state.commonType &= entry.typeMask;
    }
    return state;
  };
  const valid = state => state && state.members.length === 6 && !reqs.some((req, index) => state.counts[index] < req.count) && popcount(state.attack) >= c.minCoverage;
  function remember(state) {
    if (!valid(state)) return false;
    const key = state.members.map(entry => entry.speciesId).sort((a, b) => a - b).join(',');
    if (excludedRosters.includes(key)) return false;
    const value = score(state.attack, state.resist, state.typeMask, state.shared, c.preference, state.structureMask, c);
    if (best.has(key) && best.get(key).score >= value || best.size === target && !best.has(key) && value <= cutoff) return false;
    const close = [...best.entries()].filter(([oldKey, old]) => oldKey !== key && teamDistance(old.members, state.members) < c.minDifference);
    if (close.length > 1 || close.some(([, old]) => old.score >= value)) return false;
    close.forEach(([oldKey]) => best.delete(oldKey));
    best.set(key, { ...state, score: value });
    if (best.size > target) {
      const ordered = [...best.entries()].sort((a, b) => b[1].score - a[1].score); best.delete(ordered.at(-1)[0]);
    }
    cutoff = best.size === target ? ranked().at(-1).score : -Infinity;
    return true;
  }
  function report(force = false) {
    const time = now();
    if (force || time - lastUpdate >= 250) {
      publishPreview(ranked());
      onProgress({ phase: best.size ? 'improving' : 'searching', strategy: 'guided', stage, round, found: best.size,
        total: String(workTotal), processed: String(workDone), percent: workTotal ? workDone / workTotal * 100 : 100,
        examined, evaluated: evaluated.toString(), prunedCombinations: pruned.toString() });
      lastUpdate = time;
    }
  }
  const finish = reason => {
    if (reason !== 'cancelled') workDone = workTotal;
    report(true);
    return { results: ranked().map(state => teamResult(state, reqs, c)), diagnostics, reason, strategy: 'guided', stage, round, total: String(workTotal), processed: String(workDone),
      evaluated: evaluated.toString(), prunedCombinations: pruned.toString(), examined, availableSpecies: species.size,
      percent: workTotal ? workDone / workTotal * 100 : 100, elapsedMs: Math.round(now() - began) };
  };
  if (diagnostics.length) return finish('impossible');
  // Widen only when no solution exists in the current frontier; never wait for global optimality.
  let width = Math.max(64, target * 2);
  while (!best.size) {
    round++; stage = '第 ' + round + ' 轮 · 按条件组队'; report(true);
    const baseExamined = examined, baseEvaluated = evaluated, basePruned = pruned;
    const seed = seedSolve(pool, c, { names, width, round, cancelled, now, excludedRosters, onProgress: value => {
      workTotal = Number(value.total); workDone = Number(value.processed); stage = value.stage;
      examined = baseExamined + value.examined; evaluated = baseEvaluated + BigInt(value.evaluated); pruned = basePruned + BigInt(value.prunedCombinations);
      report(true);
    } });
    examined = baseExamined + seed.examined; evaluated = baseEvaluated + BigInt(seed.evaluated || 0); pruned = basePruned + BigInt(seed.pruned || 0);
    if (seed.reason === 'cancelled' || cancelled()) return finish('cancelled');
    for (const result of seed.results) remember(stateFor(result.members));
    if (!best.size && !seed.clipped) {
      diagnostics.push('当前完整配置无法同时满足这些条件，可调整成员、弱点、速度或功能要求。'); return finish('exhausted');
    }
    if (!best.size) width *= 4;
  }
  // Search directly for compositions different from those already retained.
  while (best.size < target) {
    const before = best.size, baseExamined = examined, baseEvaluated = evaluated, basePruned = pruned;
    round++;
    const seed = seedSolve(pool, c, { names, width, round, cancelled, now, excludedRosters, avoidTeams: ranked(), onProgress: value => {
      workTotal = Number(value.total); workDone = Number(value.processed); stage = '补充差异队伍 · ' + value.stage;
      examined = baseExamined + value.examined; evaluated = baseEvaluated + BigInt(value.evaluated); pruned = basePruned + BigInt(value.prunedCombinations);
      report(true);
    } });
    examined = baseExamined + seed.examined; evaluated = baseEvaluated + BigInt(seed.evaluated || 0); pruned = basePruned + BigInt(seed.pruned || 0);
    if (seed.reason === 'cancelled' || cancelled()) return finish('cancelled');
    for (const result of seed.results) remember(stateFor(result.members));
    if (best.size === before) break;
  }
  // Coordinate descent: every proposed replacement is checked against every hard condition.
  let changed = true, pass = 0;
  while (changed && !stopped) {
    changed = false; pass++;
    const teams = ranked(), jobs = teams.flatMap(team => team.members.map((_, slot) => ({ team, slot })));
    workTotal = jobs.length * pool.length; workDone = 0; stage = '改进第 ' + pass + ' 轮 · 替换成员'; report(true);
    for (const { team, slot } of jobs) {
      const others = team.members.filter((_, index) => index !== slot);
      const base = stateFor(others), occupied = new Set(others.map(entry => entry.speciesId)), items = new Set(others.map(entry => entry.item).filter(Boolean));
      const missing = reqs.flatMap((req, index) => base.counts[index] < req.count ? [index] : []);
      const currentKey = team.members.map(entry => entry.speciesId).sort((a, b) => a - b).join(',');
      for (const entry of pool) {
        if ((examined++ & 127) === 0) { report(); if (cancelled()) { stopped = true; break; } }
        workDone++; evaluated++;
        if (occupied.has(entry.speciesId) || c.uniqueItems && entry.item && items.has(entry.item) ||
          /monotype/.test(c.format) && !(base.commonType & entry.typeMask) ||
          entry.weakIds.some(id => base.weak[id] >= c.maxWeak) || entry.typeIds.some(id => base.types[id] >= c.maxSameType) ||
          missing.some(index => !entry.covers.includes(index))) { pruned++; continue; }
        const attack = base.attack | entry.attackMask, resist = base.resist | entry.resistMask, typeMask = base.typeMask | entry.typeMask;
        if (popcount(attack) < c.minCoverage) { pruned++; continue; }
        const shared = base.shared + entry.weakIds.reduce((count, id) => count + (base.weak[id] ? 1 : 0), 0);
        const value = score(attack, resist, typeMask, shared, c.preference, base.structureMask | entry.structureMask, c);
        if (entry.speciesId === team.members[slot].speciesId && value <= (best.get(currentKey)?.score ?? -Infinity) ||
          entry.speciesId !== team.members[slot].speciesId && value <= cutoff) continue;
        const state = stateFor([...others, entry]);
        if (remember(state)) changed = true;
      }
      if (stopped) break;
    }
    report(true);
  }
  return finish(stopped ? 'cancelled' : 'satisfied');
}

function solve(pool, c, options = {}) {
  const { diagnoseConditions, diagnosticReport } = require('./team-diagnostics.cjs');
  const issues = diagnoseConditions(pool, c, options);
  if (issues.length) return diagnosticReport(issues, pool);
  const groups = new Map();
  for (const entry of pool) {
    if (!groups.has(entry.speciesId)) groups.set(entry.speciesId, { entries: [] });
    groups.get(entry.speciesId).entries.push(entry);
  }
  const estimate = combinationTable([...groups.values()])[0][6];
  if (estimate <= BigInt(options.exactThreshold ?? 20000)) {
    const report = exactSolve(pool, c, { ...options, onProgress: value => options.onProgress?.({
      ...value, strategy: 'exact', stage: '小范围精确搜索',
    }) });
    return { ...report, strategy: 'exact', stage: '小范围精确搜索' };
  }
  return guidedSearch(pool, c, options);
}
module.exports = { solve, exactSolve, guidedSearch, combinationTable, percentage };

