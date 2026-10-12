const fs = require('node:fs');
const path = require('node:path');
const { PROVIDERS, forumIndex, archiveIndex, victoryIndex, collectRecord } = require('./team-providers.cjs');
const { readRemote, sourceURL } = require('./team-network.cjs');
const { describeFormat } = require('./team-model.cjs');

async function pool(inputs, width, action) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, inputs.length) }, async () => {
    while (next < inputs.length) { const index = next++; await action(inputs[index], index); }
  }));
}
function createTeamLibrary({ model, strategies, directory, fetcher, sample, providers = PROVIDERS, onUpdate = () => {} }) {
  const states = new Map(), jobs = new Map(), sourceQueues = new Map();
  function providerState(provider) {
    if (states.has(provider.id)) return states.get(provider.id);
    let state = { schemaVersion: 1, providerId: provider.id, catalogs: {}, records: [], done: [], failed: [], fetchedAt: null };
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(directory, 'source-' + provider.id + '.json'), 'utf8'));
      if (parsed.schemaVersion === 1 && parsed.providerId === provider.id && Array.isArray(parsed.records) && Array.isArray(parsed.done) && parsed.catalogs) state = parsed;
    } catch { /* No cache yet. */ }
    states.set(provider.id, state); return state;
  }
  function saveProvider(provider, state) {
    state.fetchedAt = new Date().toISOString();
    const file = path.join(directory, 'source-' + provider.id + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(state), 'utf8'); fs.renameSync(file + '.tmp', file);
  }
  function update(job, label, delta = 0) {
    job.current = label; job.completed += delta; job.updatedAt = new Date().toISOString();
    try { onUpdate(publicJob(job)); } catch { /* A window can close while a background fetch completes. */ }
  }
  function publicJob(job) { const { operation, ...value } = job; return { ...value, errors: [...value.errors] }; }
  function eligibleEntries(provider, entries, gen) {
    return entries.filter(entry => {
      if (provider.kind === 'victoryroad') return true;
      if (entry.hintGeneration && entry.hintGeneration !== gen) return false;
      if (entry.format) { try { return describeFormat(entry.format).generation === gen; } catch { return false; } }
      return true;
    });
  }
  async function catalog(provider, gen, state, refresh, more) {
    let cached = state.catalogs[gen];
    if (cached && !refresh && (!more || !cached.next)) return cached;
    const paginating = Boolean(cached && more && cached.next);
    const url = paginating ? sourceURL(cached.next) : provider.url;
    const html = await readRemote(fetcher, url);
    let entries, next = null;
    if (provider.kind === 'victoryroad') entries = victoryIndex(html, provider.url);
    else {
      const index = forumIndex(html, url); next = index.next;
      entries = index.entries.filter(entry => !entry.index);
      if (provider.kind === 'archive' && !paginating) {
        const selected = index.entries.find(entry => entry.index && entry.hintGeneration === gen) ||
          (gen <= 3 && index.entries.find(entry => /generation-i-iii/i.test(entry.url)));
        if (selected) entries = [...archiveIndex(await readRemote(fetcher, selected.url), selected.url, gen), ...entries];
      }
    }
    const old = cached?.entries || [], merged = [...new Map([...old, ...entries].map(entry => [entry.url, entry])).values()].slice(0, 2000);
    cached = { entries: merged, next, fetchedAt: new Date().toISOString() }; state.catalogs[gen] = cached; saveProvider(provider, state); return cached;
  }
  async function collect(provider, gen, refresh, more, job) {
    if (provider.generation && provider.generation !== gen) return;
    const state = providerState(provider);
    let index;
    try { update(job, '读取 ' + provider.name + ' 目录'); index = await catalog(provider, gen, state, refresh, more); }
    catch (failure) { job.errors.push(provider.name + '：' + failure.message); update(job, provider.name + ' 暂不可用，缓存已保留'); return; }
    const eligible = eligibleEntries(provider, index.entries, gen);
    const done = new Set(state.done), failedURLs = new Set(state.failed.map(value => value.url));
    const candidates = eligible.filter(entry => !done.has(entry.url)).sort((a, b) => Number(failedURLs.has(a.url)) - Number(failedURLs.has(b.url)));
    const batch = candidates.slice(0, 12);
    // Once a catalog is exhausted, a manual refresh rechecks a small number of
    // existing entries without discarding already downloaded records.
    if (!batch.length && refresh && !more) batch.push(...eligible.slice(0, 4));
    job.total += batch.length; update(job, provider.name + '：本批 ' + batch.length + ' 个公开条目');
    let consecutiveFailures = 0;
    await pool(batch, 2, async entry => {
      if (consecutiveFailures >= 4) { update(job, provider.name + ' 暂停重试，缓存已保留', 1); return; }
      try {
        const result = await collectRecord(provider, entry, fetcher, strategies);
        state.failed = state.failed.filter(value => value.url !== entry.url);
        const records = result.records;
        for (const record of records) {
          try {
            const normalized = model.fromRecord(record);
            const key = normalized.id;
            state.records = state.records.filter(value => value.key !== key); state.records.push({ ...record, key });
          } catch (failure) { state.failed.push({ name: record.title, reason: failure.message, url: record.url, generation: gen }); }
        }
        state.failed.push(...result.skipped.map(value => ({ ...value, generation: gen }))); state.done = [...new Set([...state.done, entry.url])].slice(-3000);
        consecutiveFailures = 0;
      } catch (failure) {
        consecutiveFailures++; state.failed = state.failed.filter(value => value.url !== entry.url);
        state.failed.push({ name: entry.title, reason: failure.message, url: entry.url, generation: gen });
        // A readable entry with no supported team is examined once; network
        // failures remain retryable after the unseen entries in the next batch.
        if (!/HTTP|超时|timeout|fetch failed|网络|暂不可用|过大/i.test(failure.message)) {
          state.done = [...new Set([...state.done, entry.url])].slice(-3000); consecutiveFailures = 0;
        }
      }
      state.failed = state.failed.slice(-200); saveProvider(provider, state); update(job, provider.name + ' · ' + entry.title, 1);
    });
  }
  function queuedCollect(provider, gen, refresh, more, job) {
    const previous = sourceQueues.get(provider.id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => collect(provider, gen, refresh, more, job));
    sourceQueues.set(provider.id, operation);
    return operation.finally(() => { if (sourceQueues.get(provider.id) === operation) sourceQueues.delete(provider.id); });
  }
  function status(gen) {
    const job = jobs.get(gen);
    return job ? publicJob(job) : { generation: gen, state: 'idle', completed: 0, total: 0, current: '', errors: [], updatedAt: null };
  }
  function formats() {
    const map = new Map(sample.formats().map(format => [format.id, format]));
    for (const provider of providers) for (const record of providerState(provider).records) {
      try { const format = describeFormat(record.format); map.set(format.id, format); } catch {}
    }
    return [...map.values()];
  }
  function start(gen, { refresh = false, more = false } = {}) {
    if (!Number.isInteger(gen) || gen < 1 || gen > 9) throw new Error('请选择第 1～9 世代。');
    if (jobs.get(gen)?.state === 'running') return status(gen);
    const job = { generation: gen, state: 'running', completed: 0, total: 1, current: '准备队伍来源', errors: [], updatedAt: new Date().toISOString() };
    jobs.set(gen, job); update(job, '正在读取规则目录');
    job.operation = (async () => {
      try {
        const index = await sample.index(refresh);
        if (index.error) job.errors.push('规则目录：' + index.error);
        update(job, '规则目录已读取', 1);
        const selected = sample.formats().filter(format => format.generation === gen), missing = selected.filter(format => refresh || !sample.read(format.id));
        job.total += missing.length; update(job, '同步第 ' + gen + ' 世代的 ' + missing.length + ' 个规则');
        await pool(missing, 4, async format => {
          const result = await sample.get(format.id, refresh);
          if (result.error) job.errors.push(format.label + '：' + result.error);
          update(job, '样例队伍 · ' + format.label, 1);
        });
        const sources = await Promise.allSettled(providers.map(provider => queuedCollect(provider, gen, refresh, more, job)));
        sources.forEach((result, index) => { if (result.status === 'rejected') job.errors.push(providers[index].name + '：' + result.reason.message); });
        job.state = job.errors.length ? 'partial' : 'complete'; update(job, '本批队伍同步完成');
      } catch (failure) { job.errors.push(failure.message); job.state = 'partial'; update(job, '同步结束，已取得的队伍已缓存'); }
      finally { delete job.operation; }
    })();
    return status(gen);
  }
  function snapshot(gen, versionId) {
    const all = [], skipped = [], dates = [], sourceStats = [];
    for (const format of sample.formats().filter(format => format.generation === gen)) {
      const cached = sample.read(format.id); if (!cached) continue;
      dates.push(cached.fetchedAt); all.push(...cached.teams.map(team => ({ ...team, source: { ...team.source, providerId: 'samples' } })));
      skipped.push(...cached.skipped.map(value => ({ ...value, provider: 'Smogon 样例队伍' })));
    }
    sourceStats.push({ id: 'samples', name: 'Smogon 样例队伍', count: all.length });
    for (const provider of providers) {
      const state = providerState(provider); let count = 0;
      for (const record of state.records) {
        try { if (describeFormat(record.format).generation !== gen) continue; all.push(model.fromRecord(record)); count++; }
        catch (failure) { skipped.push({ name: record.title, reason: failure.message, provider: provider.name }); }
      }
      sourceStats.push({ id: provider.id, name: provider.name, count, fetchedAt: state.fetchedAt, checked: state.done.length,
        remaining: eligibleEntries(provider, state.catalogs[gen]?.entries || [], gen).filter(entry => !state.done.includes(entry.url)).length, hasMore: Boolean(state.catalogs[gen]?.next) });
      if (state.fetchedAt) dates.push(state.fetchedAt);
      skipped.push(...state.failed.filter(value => !value.generation || value.generation === gen).map(value => ({ ...value, provider: provider.name })));
    }
    const unique = new Map();
    for (const team of all) {
      const fingerprint = model.fingerprint(team);
      if (!unique.has(fingerprint)) unique.set(fingerprint, { ...team, fingerprint, aliases: [team.id], sources: [team.source] });
      else { const kept = unique.get(fingerprint); kept.aliases.push(team.id); kept.sources.push(team.source); }
    }
    const order = team => {
      const tier = describeFormat(team.format).tier;
      return /^(?:ou|doublesou)$/.test(tier) ? 0 : /^(?:uu|vgc)/.test(tier) ? 1 : /^(?:ru|nu|pu|zu|lc)$/.test(tier) ? 2 : tier === 'anythinggoes' ? 4 : 3;
    };
    const result = [...unique.values()].sort((a, b) => (a.completeness?.status === 'complete' ? 0 : 1) - (b.completeness?.status === 'complete' ? 0 : 1) || order(a) - order(b));
    return { teams: result.map(team => model.decorate(team, versionId)), formats: formats().filter(format => format.generation === gen),
      skipped, sources: sourceStats, duplicateCount: all.length - result.length,
      cache: { available: dates.length > 0, fetchedAt: dates.sort().at(-1) || null, totalTeams: result.length, generation: gen }, sync: status(gen) };
  }
  async function settle(gen) { await jobs.get(gen)?.operation; return status(gen); }
  function hasFetched(gen) {
    return Boolean(sample.read('index')) && sample.formats().filter(format => format.generation === gen).every(format => sample.read(format.id)) &&
      providers.filter(provider => !provider.generation || provider.generation === gen).every(provider => providerState(provider).catalogs[gen]);
  }
  return { start, status, snapshot, settle, formats, hasFetched, providers };
}
module.exports = { createTeamLibrary, pool };
