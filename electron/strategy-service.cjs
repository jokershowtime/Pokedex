const fs = require('node:fs');
const path = require('node:path');
const { createStrategyModel } = require('./strategy-model.cjs');
const { importSets, exportSet } = require('./strategy-text.cjs');

function createStrategyService(data, directory, fetcher = globalThis.fetch) {
  const model = createStrategyModel(data);
  fs.mkdirSync(directory, { recursive: true });
  const memory = new Map(), pending = new Map();
  function generation(value) {
    const result = Number(value);
    if (!Number.isInteger(result) || result < 1 || result > 9) throw new Error('请选择第 1～9 世代。');
    return result;
  }
  function read(gen) {
    if (memory.has(gen)) return memory.get(gen);
    const file = path.join(directory, `gen${gen}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cached.schemaVersion !== 1 || cached.generation !== gen || typeof cached.fetchedAt !== 'string') return null;
      const snapshot = { ...cached, sets: model.normalizeDataset(cached.data, gen, cached.fetchedAt) };
      memory.set(gen, snapshot); return snapshot;
    } catch { return null; }
  }
  async function sync(gen) {
    if (pending.has(gen)) return pending.get(gen);
    const operation = (async () => {
      const response = await fetcher(`https://data.pkmn.cc/sets/gen${gen}.json`, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`配招来源暂时不可用（HTTP ${response.status}）。`);
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.length;
          if (bytes > 15 * 1024 * 1024) throw new Error('配招来源数据过大，原有缓存已保留。');
          chunks.push(Buffer.from(next.value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('配招来源返回的内容无法读取，原有缓存已保留。'); }
      const fetchedAt = new Date().toISOString();
      const sets = model.normalizeDataset(payload, gen, fetchedAt);
      const snapshot = { schemaVersion: 1, generation: gen, fetchedAt, data: payload, sets };
      const file = path.join(directory, `gen${gen}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ schemaVersion: 1, generation: gen, fetchedAt, data: payload }), 'utf8');
      fs.renameSync(`${file}.tmp`, file); memory.set(gen, snapshot);
      return snapshot;
    })();
    pending.set(gen, operation);
    try { return await operation; } finally { pending.delete(gen); }
  }
  async function list({ pokemonId, generation: input, versionId, refresh = false }) {
    if (!data.hasPokemon(pokemonId)) throw new Error('请选择有效的宝可梦。');
    const gen = generation(input); let cached = read(gen); let error = null;
    if (refresh || !cached) {
      try { cached = await sync(gen); }
      catch (failure) { error = `联网获取失败：${failure.name === 'TimeoutError' ? '请求超时' : failure.message}。${cached ? '继续使用已有缓存。' : '可以重试，或导入自己的配招。'}`; }
    }
    const sets = (cached?.sets || []).filter(set => set.pokemonId === Number(pokemonId)).map(set => model.decorate(set, versionId));
    const formats = [...new Map(sets.map(set => [set.format, { id: set.format, label: set.formatLabel, category: set.category }])).values()];
    return { sets, formats, error, cache: { fetchedAt: cached?.fetchedAt || null, totalSets: cached?.sets.length || 0, generation: gen, available: Boolean(cached) } };
  }
  function validatePersonal(input, versionId) {
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 50000) throw new Error('培养方案内容无效或过长。');
    const set = structuredClone(input);
    if (typeof set.title !== 'string' || !set.title.trim() || set.title.length > 100) throw new Error('方案名称需要 1～100 字。');
    if (typeof set.notes !== 'undefined' && (typeof set.notes !== 'string' || set.notes.length > 5000)) throw new Error('方案备注最多 5000 字。');
    generation(set.generation);
    const errors = model.validate(set, versionId).errors;
    if (errors.length) throw new Error(errors.join(' '));
    for (const field of ['ability', 'item', 'nature', 'teraType']) if (typeof set.selection[field] !== 'string' || set.selection[field].length > 100) throw new Error('配置名称无效或过长。');
    if (set.selection.moves.some(move => typeof move !== 'string' || move.length > 100)) throw new Error('招式名称无效或过长。');
    for (const field of ['nickname', 'hpType', 'pokeball']) if (set.selection[field] !== undefined && (typeof set.selection[field] !== 'string' || set.selection[field].length > 100 || /[\r\n]/.test(set.selection[field]))) throw new Error('附加配置名称无效或过长。');
    if (set.showdownSpecies && (typeof set.showdownSpecies !== 'string' || set.showdownSpecies.length > 100 || model.resolve('pokemon', set.showdownSpecies)?.id !== set.pokemonId)) throw new Error('导出物种名称与当前宝可梦形态不一致。');
    set.selection.moves = set.selection.moves.filter(Boolean);
    set.abilityOptions = set.selection.ability ? [set.selection.ability] : [];
    set.itemOptions = set.selection.item ? [set.selection.item] : [];
    set.natureOptions = set.selection.nature ? [set.selection.nature] : [];
    set.teraOptions = set.selection.teraType ? [set.selection.teraType] : [];
    set.moveOptions = set.selection.moves.map(move => [move]);
    set.evSpreads = [structuredClone(set.selection.evs)]; set.ivSpreads = [structuredClone(set.selection.ivs)];
    set.defaults = Array.isArray(set.defaults) ? set.defaults.filter(text => typeof text === 'string').slice(0, 10) : [];
    if (!set.source || typeof set.source !== 'object') set.source = { provider: '自建', url: null, fetchedAt: null };
    delete set.labels; delete set.validation;
    return set;
  }
  return {
    model, list, validatePersonal,
    references: () => model.refs,
    decorate: (set, versionId) => model.decorate(set, versionId),
    import: (text, gen) => importSets(text, generation(gen), model),
    export: (set, language) => exportSet(set, model, language),
  };
}
module.exports = { createStrategyService };
