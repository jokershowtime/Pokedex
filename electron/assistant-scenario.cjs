const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const BOOSTS = STATS.slice(1);
const WEATHERS = ['', 'Sun', 'Rain', 'Sand', 'Hail', 'Snow', 'Harsh Sunshine', 'Heavy Rain', 'Strong Winds'];
const TERRAINS = ['', 'Electric', 'Grassy', 'Psychic', 'Misty'];
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + '无效。');
  return value;
}
function number(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(label + '超出范围。');
  return result;
}
function text(value, fallback = '', max = 100) {
  const result = value ?? fallback;
  if (typeof result !== 'string' || result.length > max || /[\r\n]/.test(result)) throw new Error('配置名称无效或过长。');
  return result;
}
function battleState(input = {}, gen = 9) {
  object(input, '状态条件');
  const boosts = object(input.boosts ?? {}, '能力等级');
  const state = { hpPercent: number(input.hpPercent, 100, 1, 100, 'HP 百分比'), status: text(input.status),
    boosts: Object.fromEntries(BOOSTS.map(stat => [stat, number(boosts[stat], 0, -6, 6, '能力等级')])) };
  if (!['', 'slp', 'psn', 'brn', 'frz', 'par', 'tox'].includes(state.status)) throw new Error('异常状态无效。');
  for (const key of ['tailwind', 'reflect', 'lightScreen', 'auroraVeil', 'abilityOn', 'teraActive']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('状态开关无效。');
    state[key] = input[key] === true;
  }
  if (state.tailwind && gen < 4) throw new Error('顺风从第四世代引入。');
  if (state.auroraVeil && gen < 7) throw new Error('极光幕从第七世代引入。');
  if (state.teraActive && gen !== 9) throw new Error('太晶化仅适用于第九世代。');
  if (gen < 3 && state.abilityOn) throw new Error('特性从第三世代引入。');
  return state;
}
function scenario(input = {}, gen = 9) {
  object(input, '战况条件');
  const field = object(input.field ?? {}, '环境条件'), weather = field.weather ?? '', terrain = field.terrain ?? '';
  if (!WEATHERS.includes(weather) || !TERRAINS.includes(terrain)) throw new Error('天气或场地无效。');
  if (weather && gen === 1 || weather === 'Hail' && gen < 3 || weather === 'Snow' && gen < 9 ||
    ['Harsh Sunshine', 'Heavy Rain', 'Strong Winds'].includes(weather) && gen < 6) throw new Error('所选天气在计算世代尚未引入。');
  if (terrain && gen < 6) throw new Error('场地从第六世代引入。');
  for (const key of ['gravity', 'trickRoom']) if (field[key] !== undefined && typeof field[key] !== 'boolean') throw new Error('环境开关无效。');
  if (gen < 4 && (field.gravity || field.trickRoom)) throw new Error('重力和戏法空间从第四世代引入。');
  const teamState = battleState(input.teamState, gen);
  if (teamState.teraActive) throw new Error('队伍统一状态不支持同时太晶化六位成员，请在对战计算器单独核对。');
  return { field: { weather, terrain, gravity: field.gravity === true, trickRoom: field.trickRoom === true }, teamState };
}
function manualBuild(input, gen) {
  object(input, '对手配招'); const selected = object(input.selection, '培养数值');
  const selection = { level: number(selected.level, 50, 1, 100, '来源等级'), ability: text(selected.ability),
    item: text(selected.item), nature: text(selected.nature), teraType: text(selected.teraType),
    moves: selected.moves, evs: {}, ivs: {} };
  if (!Array.isArray(selection.moves) || selection.moves.length < 1 || selection.moves.length > 4 ||
    selection.moves.some(move => !text(move)) || new Set(selection.moves).size !== selection.moves.length) throw new Error('对手配招需要 1～4 个不同招式。');
  for (const stat of STATS) {
    selection.evs[stat] = number(selected.evs?.[stat], undefined, 0, gen <= 5 ? 255 : 252, '对手努力值');
    selection.ivs[stat] = number(selected.ivs?.[stat], undefined, 0, 31, '对手个体值');
  }
  if (gen >= 3 && (Object.values(selection.evs).reduce((a, b) => a + b, 0) > 510 || !selection.nature || !selection.ability)) throw new Error('请提供完整有效的对手特性、性格和努力值。');
  for (const key of ['gender', 'hpType']) if (selected[key] !== undefined) selection[key] = text(selected[key]);
  if (selected.happiness !== undefined) selection.happiness = number(selected.happiness, undefined, 0, 255, '亲密度');
  return { title: text(input.title, '指定配招'), generation: number(input.generation, gen, 1, 9, '来源世代'),
    showdownSpecies: text(input.showdownSpecies), source: text(input.source, '手动指定'), selection };
}
function snapshot(set) {
  if (set.missingFields?.length || set.generation >= 3 && (!set.evsSpecified || !set.natureOptions?.length || set.defaults?.some(value => value.includes('特性未注明')))) throw new Error('这份来源没有公开完整特性、性格或努力值，请补充后再导入。');
  return manualBuild({ title: set.title, generation: set.referenceGeneration || set.generation, showdownSpecies: set.showdownSpecies,
    source: set.source?.provider || '手动指定', selection: set.selection }, set.generation);
}
const inScenario = (fighter, state = {}) => ({ ...fighter, state: { ...state, boosts: { ...state.boosts } } });
const normal = fighter => ({ ...fighter, state: {} });
function canonicalSelection(selection, model) {
  const result = { ...selection, moves: selection.moves.map(name => {
    if (/^(?:hidden\s*power\b|觉醒力量)/i.test(name)) {
      const suffix = name.replace(/^(?:hidden\s*power|觉醒力量)/i, '').replace(/[\s·・\[\]]/g, '');
      const type = suffix && model.resolve('types', suffix);
      return type ? 'Hidden Power ' + type.english : suffix ? name : 'Hidden Power';
    }
    return model.resolve('moves', name)?.english || name;
  }) };
  for (const [field, kind] of [['ability', 'abilities'], ['item', 'items'], ['nature', 'natures'], ['teraType', 'types']]) result[field] = model.resolve(kind, selection[field])?.english || selection[field];
  return result;
}
function stateText(state = {}) {
  const labels = { tailwind: '顺风', reflect: '反射壁', lightScreen: '光墙', auroraVeil: '极光幕', abilityOn: '手动触发特性', teraActive: '太晶化' };
  const stats = { atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
  const status = { slp: '睡眠', psn: '中毒', brn: '灼伤', frz: '冰冻', par: '麻痹', tox: '剧毒' };
  return ['HP ' + (state.hpPercent ?? 100) + '%', status[state.status] || '无异常',
    ...Object.entries(labels).filter(([key]) => state[key]).map(([, label]) => label),
    ...Object.entries(state.boosts || {}).filter(([, value]) => value).map(([key, value]) => stats[key] + (value > 0 ? '+' : '') + value)].join('、');
}
function scenarioText(value) {
  const weather = { Sun: '晴天', Rain: '雨天', Sand: '沙暴', Hail: '冰雹', Snow: '雪天', 'Harsh Sunshine': '大日照', 'Heavy Rain': '大雨', 'Strong Winds': '乱流' };
  const terrain = { Electric: '电气场地', Grassy: '青草场地', Psychic: '精神场地', Misty: '薄雾场地' };
  return [weather[value.field.weather] || '无天气', terrain[value.field.terrain] || '无场地', value.field.trickRoom ? '空间已开启' : '无空间',
    ...(value.field.gravity ? ['重力'] : []), '我方统一状态：' + stateText(value.teamState)].join('；');
}
module.exports = { scenario, battleState, manualBuild, snapshot, inScenario, normal, stateText, scenarioText, canonicalSelection };
