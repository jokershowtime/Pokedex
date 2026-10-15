const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createTeamModel, describeFormat, pasteURL, TAGS } = require('./team-model.cjs');
const { importSets } = require('./strategy-text.cjs');
const { createTeamLibrary } = require('./team-library.cjs');
const { PROVIDERS } = require('./team-providers.cjs');
const { shareURL, readPaste } = require('./team-network.cjs');

async function readJSON(fetcher, url, limit = 5 * 1024 * 1024) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' }, redirect: 'error' });
  if (!response.ok) throw new Error('来源暂时不可用（HTTP ' + response.status + '）');
  if (!response.body) throw new Error('来源返回空内容');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) throw new Error('来源内容过大');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('来源内容无法读取为 JSON'); }
}
function createTeamService(strategies, directory, fetcher = globalThis.fetch, options = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const model = createTeamModel(strategies), memory = new Map(), pending = new Map();
  const fileFor = key => path.join(directory, key + '.json');
  function normalizeIndex(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('队伍规则列表格式不正确');
    const formats = [];
    for (const [id, sizes] of Object.entries(payload)) {
      try { if (Array.isArray(sizes) && sizes.every(Number.isFinite)) formats.push(describeFormat(id)); } catch { /* Formats containing custom species are outside this Pokédex. */ }
    }
    if (!formats.length) throw new Error('没有可识别的队伍规则');
    return formats;
  }
  function materialize(key, snapshot) {
    if (snapshot.schemaVersion !== 1 || snapshot.key !== key || typeof snapshot.fetchedAt !== 'string') throw new Error('缓存格式无效');
    return { ...snapshot, ...(key === 'index' ? { formats: normalizeIndex(snapshot.data) } : model.normalize(snapshot.data, key, snapshot.fetchedAt)) };
  }
  function read(key) {
    if (memory.has(key)) return memory.get(key);
    try { const value = materialize(key, JSON.parse(fs.readFileSync(fileFor(key), 'utf8'))); memory.set(key, value); return value; }
    catch { return null; }
  }
  async function sync(key) {
    if (pending.has(key)) return pending.get(key);
    const operation = (async () => {
      // data.pkmn.cc redirects here; use the canonical URL so redirect rejection
      // can still protect read-only PokéPaste imports from leaving their host.
      const data = await readJSON(fetcher, 'https://pkmn.github.io/smogon/data/teams/' + key + '.json');
      const snapshot = materialize(key, { schemaVersion: 1, key, fetchedAt: new Date().toISOString(), data });
      const temporary = fileFor(key) + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, key, fetchedAt: snapshot.fetchedAt, data }), 'utf8');
        fs.renameSync(temporary, fileFor(key));
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      memory.set(key, snapshot); return snapshot;
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  }
  async function get(key, refresh) {
    let cached = read(key), error = null;
    if (refresh || !cached) {
      try { cached = await sync(key); }
      catch (failure) { error = '联网获取失败：' + (failure.name === 'TimeoutError' ? '请求超时' : failure.message) + '。' + (cached ? '继续使用已有缓存。' : '可重试或导入分享队伍。'); }
    }
    return { cached, error };
  }
  const fallbackFormats = () => Array.from({ length: 9 }, (_, index) => describeFormat('gen' + (index + 1) + 'ou'));
  const library = createTeamLibrary({ model, strategies, directory, fetcher, providers: options.providers ?? PROVIDERS, onUpdate: options.onUpdate,
    sample: { read, get, index: refresh => get('index', refresh), formats: () => read('index')?.formats || fallbackFormats() } });
  return {
    model, library,
    compose(args, user, versionId) {
      if (!args || typeof args !== 'object' || JSON.stringify(args).length > 20000) throw new Error('队伍工作台内容无效或过长。');
      if (args.id && args.copyFrom) throw new Error('请选择编辑队伍或创建副本。');
      const existing = args.id ? user.teams.find(team => team.id === args.id) : null;
      const copied = args.copyFrom ? user.teams.find(team => team.id === args.copyFrom) : null;
      if (args.id && !existing || args.copyFrom && !copied) throw new Error('这支队伍已被移除，请重新打开工作台。');
      if (!Array.isArray(args.slots) || args.slots.length > 6) throw new Error('每队最多选择 6 位成员。');
      const base = existing || copied, rule = describeFormat(args.format);
      const members = args.slots.filter(slot => slot !== null).map((slot, index) => {
        if (!slot || typeof slot.id !== 'string' || !['member', 'plan'].includes(slot.kind)) throw new Error('请选择有效的培养方案。');
        const member = slot.kind === 'member' ? base?.members.find(member => member.id === slot.id) : user.plans.find(plan => plan.id === slot.id);
        if (!member) throw new Error('第 ' + (index + 1) + ' 位成员的方案已被移除，请重新选择。');
        return { ...structuredClone(member), originId: member.originId || member.id };
      });
      if (new Set(members.map(member => member.id)).size !== members.length) throw new Error('同一套培养方案不能在队伍中重复选择，可选择同物种的另一条路线。');
      const team = {
        ...(base ? structuredClone(base) : {}), id: existing?.id || 'workbench-new', title: args.title, notes: args.notes || '',
        originalName: '', author: base?.author || '', sourceNotes: base?.sourceNotes || '',
        generation: rule.generation, format: rule.id, formatLabel: rule.label, category: rule.category, members,
        source: base?.source || { provider: '自组队伍', url: null, fetchedAt: null }, originId: existing?.originId || null,
        tags: [], personal: true,
      };
      if (!existing) { delete team.aliases; delete team.createdAt; delete team.updatedAt; }
      return model.validate(team, versionId);
    },
    metadata() {
      return { formats: library.formats(), tags: TAGS.map(({ id, label }) => ({ id, label })), error: null,
        fetchedAt: read('index')?.fetchedAt || null };
    },
    async formats(refresh = false) {
      const { cached, error } = await get('index', refresh);
      return { formats: library.formats(), tags: TAGS.map(({ id, label }) => ({ id, label })), providers: [{ id: 'samples', name: 'Smogon 样例队伍' }, ...library.providers], 
        error, fetchedAt: cached?.fetchedAt || null };
    },
    async list({ format, versionId, refresh = false }) {
      describeFormat(format);
      const { cached, error } = await get(format, refresh);
      return { teams: (cached?.teams || []).map(team => model.decorate(team, versionId)), skipped: cached?.skipped || [], error,
        cache: { available: Boolean(cached), fetchedAt: cached?.fetchedAt || null, totalTeams: cached?.teams.length || 0, format } };
    },
    browse({ generation, versionId, start = true }) {
      const gen = Number(generation);
      if (!Number.isInteger(gen) || gen < 1 || gen > 9) throw new Error('请选择第 1～9 世代。');
      const snapshot = library.snapshot(gen, versionId);
      if (start && !library.hasFetched(gen) && library.status(gen).state === 'idle') library.start(gen);
      return { ...snapshot, sync: library.status(gen), error: null };
    },
    sync({ generation, refresh = true, more = false }) { return library.start(Number(generation), { refresh, more }); },
    async import({ text, format, title }) {
      const rule = describeFormat(format);
      if (typeof text !== 'string' || text.length > 120000) throw new Error('导入内容最多 120000 字。');
      const cleaned = text.trim();
      let metadata = { title }, content = cleaned;
      if (/^https?:\/\//i.test(cleaned)) {
        const url = shareURL(cleaned);
        if (!url) pasteURL(cleaned);
        const payload = await readPaste(fetcher, url);
        if (payload.open) throw new Error('这份开放队单隐藏了培养数值，不能作为完整培养方案导入。');
        if (payload.format && payload.format !== format) throw new Error('分享标注规则为 ' + payload.format + '，请先选择相同规则。');
        content = payload.data ? JSON.stringify(payload.data) : payload.text;
        metadata = { title: title?.trim() || payload.title || '分享导入队伍', originalName: payload.title || '', author: payload.author, notes: payload.notes,
          source: { provider: url.includes('vrpastes.com') ? 'VR Pastes 导入' : 'PokéPaste 导入', url, fetchedAt: new Date().toISOString() } };
      }
      const header = content.match(/^===\s*\[([a-z0-9]+)\]\s*(.*?)\s*===\s*(?:\r?\n|$)/);
      if (header) {
        if (header[1] !== format) throw new Error('文本标注规则为 ' + header[1] + '，请先选择相同规则。');
        if (!metadata.title) metadata.title = header[2]; metadata.originalName ||= header[2]; content = content.slice(header[0].length);
      }
      if (/^\s*[\[{]/.test(content)) {
        let raw; try { raw = JSON.parse(content); } catch { throw new Error('JSON 格式不正确。'); }
        if (Array.isArray(raw) && raw.length > 6) throw new Error('一次导入一支队伍，最多 6 位成员。');
      } else if (content.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).length > 6) throw new Error('一次导入一支队伍，最多 6 位成员。');
      const sets = importSets(content, rule.generation, strategies.model);
      // Showdown omits the default level for formats such as VGC and Little Cup.
      const raw = /^\s*[\[{]/.test(content) ? JSON.parse(content) : null;
      const blocks = !raw ? content.replace(/\r/g, '').trim().split(/\n\s*\n/).filter(Boolean) : [];
      sets.forEach((set, index) => {
        const explicit = raw ? (Array.isArray(raw) ? raw[index] : raw).level !== undefined : /^(?:Level|等级)[:：]/im.test(blocks[index] || '');
        if (!explicit) set.selection.level = set.level = /vgc|battlestadium|battlespot/.test(rule.tier) ? 50 : rule.tier === 'lc' ? 5 : 100;
      });
      return model.fromImport(sets, format, metadata);
    },
    export(team, language, versionId) {
      const validated = model.validate(team, versionId);
      return validated.members.map(member => strategies.export(member, language)).join('\n\n');
    },
  };
}
module.exports = { createTeamService, readJSON };
