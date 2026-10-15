const LABELS = { pokemon: '宝可梦', moves: '招式', abilities: '特性', items: '道具' };
const METHODS = { 1: '升级', 2: '遗传', 3: '教学', 4: '招式机', 5: '活动', 6: '电气球遗传', 7: '净化', 8: '暗影', 9: '净化', 10: '形态变化', 11: '特殊', 12: '训练' };
const normalize = value => value.toLowerCase().replace(/[\s·・\-_'’./＇#]/g, '');
function integer(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(label + '超出可选范围。');
  return result;
}
function ids(value, max, label) {
  if (!Array.isArray(value) || value.length > max || value.some(id => !Number.isInteger(id) || id < 1)) throw new Error(label + '无效。');
  return [...new Set(value)];
}
function text(value = '') {
  if (typeof value !== 'string' || value.length > 100) throw new Error('查询文字最多 100 字。');
  return normalize(value.trim());
}
function createDexQueries({ getVersion, catalog, entityList, learnsetVersion, moveAt, matchup, all, machineMap }) {
  const learningCache = new Map();
  function learning(version) {
    const source = learnsetVersion(version);
    const info = { status: !source ? 'missing' : source.id === version.id ? 'exact' : 'reference',
      version: source?.name || null, versionId: source?.id || null };
    if (!source) return { ...info, records: new Map() };
    if (!learningCache.has(source.id)) {
      const records = new Map();
      for (const row of all('SELECT pokemon_id, move_id, pokemon_move_method_id, level FROM pokemon_moves WHERE version_group_id=? ORDER BY pokemon_id, move_id, pokemon_move_method_id, level', source.id)) {
        if (!records.has(row.pokemon_id)) records.set(row.pokemon_id, new Map());
        const moves = records.get(row.pokemon_id);
        if (!moves.has(row.move_id)) moves.set(row.move_id, []);
        const methods = moves.get(row.move_id), method = { id: row.pokemon_move_method_id, name: METHODS[row.pokemon_move_method_id] || '特殊',
          level: row.level, machineNumber: machineMap.get(source.id + ':' + row.move_id) ?? null };
        if (!methods.some(value => value.id === method.id && value.level === method.level)) methods.push(method);
      }
      learningCache.set(source.id, records);
      if (learningCache.size > 3) learningCache.delete(learningCache.keys().next().value);
    }
    return { ...info, records: learningCache.get(source.id) };
  }
  const publicLearning = ({ records, ...value }) => value;
  function discover(input = {}) {
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 10000) throw new Error('反查条件无效或过长。');
    const version = getVersion(input.versionId), types = ids(input.types ?? [], 2, '属性条件'), requested = ids(input.moves ?? [], 4, '招式条件');
    const availableMoves = new Set(entityList('moves', version.id).map(value => value.id));
    if (requested.some(id => !availableMoves.has(id))) throw new Error('所选招式在当前资料世代尚未登场。');
    if (types.some(id => id > 18 || version.generation === 1 && [9, 17, 18].includes(id) || version.generation < 6 && id === 18)) throw new Error('所选属性在当前资料世代尚未登场。');
    const abilityId = integer(input.abilityId, 0, 0, 10000, '特性编号'), scope = input.abilityScope ?? 'any';
    if (!['any', 'normal', 'hidden'].includes(scope)) throw new Error('特性范围无效。');
    if (abilityId && !entityList('abilities', version.id).some(ability => ability.id === abilityId)) throw new Error('所选特性不在当前资料世代。');
    if (version.generation < 3 && scope !== 'any') throw new Error('当前世代没有特性机制。');
    if (input.showForms !== undefined && typeof input.showForms !== 'boolean') throw new Error('形态开关无效。');
    const ranges = input.stats ?? {}, allowed = version.generation === 1 ? [1, 2, 3, 6, 9] : [1, 2, 3, 4, 5, 6];
    if (!ranges || typeof ranges !== 'object' || Array.isArray(ranges) || Object.keys(ranges).some(key => !allowed.includes(Number(key)))) throw new Error('种族值条件无效。');
    function range(value = {}, max = 999) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('种族值范围无效。');
      const minValue = integer(value.min, 0, 0, max, '种族值下限'), maxValue = integer(value.max, max, 0, max, '种族值上限');
      if (minValue > maxValue) throw new Error('种族值下限不能大于上限。');
      return { min: minValue, max: maxValue };
    }
    const statRanges = Object.entries(ranges).map(([key, value]) => [Number(key), range(value)]), totalRange = range(input.total, 2000);
    const query = text(input.query), page = integer(input.page, 0, 0, 10000, '页码'), size = integer(input.size, 30, 1, 60, '每页数量');
    const base = catalog(version.id).filter(pokemon => (input.showForms || pokemon.isDefault) &&
      (!query || pokemon.searchKey.includes(query) || String(pokemon.speciesId) === query || String(pokemon.id) === query) &&
      types.every(type => pokemon.types.includes(type)) && pokemon.total >= totalRange.min && pokemon.total <= totalRange.max &&
      statRanges.every(([id, range]) => pokemon.stats.some(stat => stat.id === id && stat.value >= range.min && stat.value <= range.max)) &&
      (!abilityId && scope === 'any' || pokemon.abilities.some(ability => (!abilityId || ability.id === abilityId) && (scope === 'any' || (scope === 'hidden') === ability.hidden))));
    const table = requested.length ? learning(version) : null;
    const matches = table ? base.filter(pokemon => requested.every(id => table.records.get(pokemon.id)?.has(id))) : base;
    const results = matches.slice(page * size, (page + 1) * size).map(pokemon => ({ pokemon,
      moves: requested.map(id => ({ ...moveAt(id, version.id), methods: table.records.get(pokemon.id).get(id) })) }));
    const source = learnsetVersion(version);
    return { version, page, size, total: matches.length, results, unknown: table ? base.filter(pokemon => !table.records.has(pokemon.id)).length : 0,
      learning: table ? publicLearning(table) : { status: !source ? 'missing' : source.id === version.id ? 'exact' : 'reference', version: source?.name || null, versionId: source?.id || null } };
  }
  function compare(input = {}) {
    const version = getVersion(input.versionId), selected = ids(input.ids, 4, '对比列表');
    if (selected.length < 2 || selected.length !== input.ids.length) throw new Error('请选择 2～4 只不同的宝可梦或形态。');
    const available = catalog(version.id), table = learning(version);
    const columns = selected.map(id => {
      const pokemon = available.find(value => value.id === id);
      if (!pokemon) throw new Error('对比成员未在当前资料版本登场，请切换版本或移除该成员。');
      const records = table.records.get(id);
      return { pokemon, matchup: matchup(pokemon.types, version.id), recorded: Boolean(records?.size),
        moves: [...(records?.entries() || [])].map(([id, methods]) => ({ ...moveAt(id, version.id), methods })) };
    });
    const complete = columns.every(column => column.recorded);
    const common = complete ? columns[0].moves.filter(move => columns.every(column => column.moves.some(value => value.id === move.id))).map(move => move.id) : [];
    return { version, columns, learning: publicLearning(table), complete, common,
      unique: complete ? columns.map(column => column.moves.filter(move => columns.filter(other => other !== column).every(other => !other.moves.some(value => value.id === move.id))).map(move => move.id)) : columns.map(() => []) };
  }
  function search(input = {}) {
    const version = getVersion(input.versionId), query = text(input.query), kind = input.kind ?? 'all';
    if (kind !== 'all' && !Object.hasOwn(LABELS, kind)) throw new Error('搜索分类无效。');
    const page = integer(input.page, 0, 0, 10000, '页码'), size = integer(input.size, 8, 1, 50, '每页数量');
    if (!query) return { version, groups: [], total: 0, page, size };
    const groups = (kind === 'all' ? Object.keys(LABELS) : [kind]).map(kind => {
      const list = kind === 'pokemon' ? catalog(version.id) : entityList(kind, version.id);
      const ranked = list.flatMap(value => {
        const numberMatch = /^\d+$/.test(query) && (String(value.id) === query || kind === 'pokemon' && String(value.speciesId) === query);
        if (!numberMatch && !value.searchKey.includes(query)) return [];
        const name = kind === 'pokemon' && value.formName ? value.name + ' · ' + value.formName : value.name;
        const exact = numberMatch || [name, value.englishName, value.identifier].filter(Boolean).some(value => normalize(value) === query);
        return [{ kind, id: value.id, name, subtitle: kind === 'pokemon' ? value.identifier : value.identifier.replace(/-/g, ' '),
          number: kind === 'pokemon' ? value.speciesId : value.id, types: kind === 'pokemon' ? value.types : value.type ? [value.type] : [],
          rank: exact ? 0 : normalize(name).startsWith(query) ? 1 : 2, form: kind === 'pokemon' && !value.isDefault ? 1 : 0 }];
      }).sort((a, b) => a.rank - b.rank || a.number - b.number || a.form - b.form || a.id - b.id);
      return { kind, label: LABELS[kind], total: ranked.length, entries: ranked.slice(page * size, (page + 1) * size).map(({ rank, form, ...value }) => value) };
    });
    return { version, groups, total: groups.reduce((sum, group) => sum + group.total, 0), page, size };
  }
  return { discover, compare, search };
}
module.exports = { createDexQueries };
