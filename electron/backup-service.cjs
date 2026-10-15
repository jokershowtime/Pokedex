const { DEFAULT_VERSIONS } = require('./strategy-model.cjs');
const { presetList } = require('./assistant-presets.cjs');
const PROGRESS_KEYS = ['item', 'nature', 'ability', 'evs', 'ivs', 'move0', 'move1', 'move2', 'move3'];
function createBackupService(data, strategies, teams) {
  function pokemonId(id) { if (!Number.isInteger(id) || !data.hasPokemon(id)) throw new Error('备份包含当前资料未收录的宝可梦编号：' + id); return id; }
  function plan(input) {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 150) throw new Error('备份中的方案编号无效。');
    pokemonId(input.pokemonId);
    const version = DEFAULT_VERSIONS[input.generation]; if (!version) throw new Error('备份中的方案世代无效。');
    const validated = strategies.validatePersonal(input, version);
    if (validated.progress && (typeof validated.progress !== 'object' || Array.isArray(validated.progress) || Object.entries(validated.progress).some(([key, value]) => !PROGRESS_KEYS.includes(key) || typeof value !== 'boolean'))) throw new Error('备份中的培养进度无效。');
    if (!validated.source || typeof validated.source.provider !== 'string' || validated.source.provider.length > 200 || validated.source.url !== null && (typeof validated.source.url !== 'string' || validated.source.url.length > 2048)) throw new Error('备份中的来源记录无效。');
    validated.personal = true; return validated;
  }
  function validate(document) {
    if (!document || document.kind !== 'pokedex-user-backup' || document.schemaVersion !== 1 || !document.data || typeof document.data !== 'object') throw new Error('请选择由本图鉴导出的备份文件。');
    const saved = document.data;
    if (!Array.isArray(saved.favorites) || !Array.isArray(saved.history) || !saved.notes || typeof saved.notes !== 'object' || Array.isArray(saved.notes) ||
        !Array.isArray(saved.plans) || saved.plans.length > 2000 || !Array.isArray(saved.teams) || saved.teams.length > 200) throw new Error('备份结构或记录数量无效。');
    const favorites = [...new Set(saved.favorites.map(pokemonId))];
    const history = saved.history.slice(0, 50).map(entry => {
      if (!entry || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at))) throw new Error('备份中的查询历史无效。');
      return { id: pokemonId(entry.id), at: entry.at };
    });
    const notes = Object.fromEntries(Object.entries(saved.notes).map(([key, value]) => {
      if (!/^\d+$/.test(key) || typeof value !== 'string' || value.length > 5000) throw new Error('备份中的宝可梦笔记无效。');
      pokemonId(Number(key)); return [key, value];
    }));
    const plans = saved.plans.map(plan), ids = new Set(plans.map(value => value.id));
    if (ids.size !== plans.length) throw new Error('备份含重复方案编号。');
    const restoredTeams = saved.teams.map(input => {
      if (typeof input?.id !== 'string' || !input.id || input.id.length > 150) throw new Error('备份中的队伍编号无效。');
      const validated = teams.model.validate(input, DEFAULT_VERSIONS[input.generation]);
      validated.members = validated.members.map(plan); validated.personal = true;
      if (typeof validated.source.provider !== 'string' || validated.source.provider.length > 200 || validated.source.url !== null && (typeof validated.source.url !== 'string' || validated.source.url.length > 2048)) throw new Error('备份中的队伍来源记录无效。');
      for (const member of validated.members) {
        const linked = plans.find(value => value.id === member.id);
        if (linked && linked.teamId !== validated.id) throw new Error('备份中的队伍与成员培养计划关联不一致。');
      }
      return validated;
    });
    if (new Set(restoredTeams.map(value => value.id)).size !== restoredTeams.length) throw new Error('备份含重复队伍编号。');
    for (const member of plans) if (member.teamId && !restoredTeams.some(team => team.id === member.teamId && team.members.some(value => value.id === member.id))) throw new Error('备份中的成员所属队伍不存在。');
    return { favorites, history, notes, plans, teams: restoredTeams, assistantPresets: presetList(saved.assistantPresets) };
  }
  function encode(state) {
    return JSON.stringify({ kind: 'pokedex-user-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), data: state }, null, 2);
  }
  function decode(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 20 * 1024 * 1024) throw new Error('备份文件为空或超过 20 MB。');
    let document; try { document = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('备份不是有效的 JSON 文件。'); }
    const state = validate(document);
    return { state, summary: { exportedAt: typeof document.exportedAt === 'string' ? document.exportedAt : null,
      favorites: state.favorites.length, history: state.history.length, notes: Object.keys(state.notes).length, plans: state.plans.length, teams: state.teams.length, assistantPresets: state.assistantPresets.length } };
  }
  return { encode, decode };
}
module.exports = { createBackupService };
