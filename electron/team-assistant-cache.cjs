const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const VERSION = 1, MAX_BYTES = 80 * 1024 * 1024;
function preparationKey(records, c, databasePath) {
  const hash = createHash('sha256'), database = fs.statSync(databasePath);
  hash.update(JSON.stringify([VERSION, database.size, database.mtimeMs]));
  for (const file of ['team-assistant-worker.cjs', 'team-solver.cjs', 'team-quality.cjs', 'team-opponents.cjs', 'assistant-scenario.cjs', 'battle-service.cjs', 'strategy-service.cjs', 'strategy-model.cjs', 'team-library.cjs', 'team-service.cjs', 'team-model.cjs', 'data-service.cjs'])
    hash.update(fs.readFileSync(path.join(__dirname, file)));
  hash.update(fs.readFileSync(path.join(__dirname, '../package.json')));
  hash.update(JSON.stringify([c.generation, c.scopeGeneration, c.format, c.category, c.outputFormat, c.level,
    [...c.excludedIds].sort((a, b) => a - b), c.excludeLegendary, c.excludeMythical, c.uniqueItems,
    Boolean(c.fastCount), c.fastCount ? c.fastSpeed : 0, Boolean(c.slowCount), c.slowCount ? c.slowSpeed : 0, [...c.requiredMoves].sort(),
    c.opponents?.length ? c.scenario : null, (c.opponents || []).map(value => [value.id, value.pokemonId, value.reference, value.state, value.build])]));
  hash.update(JSON.stringify(records));
  return hash.digest('hex');
}
function sourcePreparationKey(c, own, generations, directory, databasePath) {
  const expected = generations.map(gen => path.join(directory, 'strategy-cache/gen' + gen + '.json'));
  if (c.format !== 'all') expected.push(path.join(directory, 'team-cache', c.format + '.json'));
  if (expected.some(file => !fs.existsSync(file))) return null;
  const files = [];
  function scan(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const stat = fs.statSync(file); files.push([path.relative(directory, file), stat.size, stat.mtimeMs, stat.ctimeMs]);
      }
    }
  }
  scan(path.join(directory, 'strategy-cache')); scan(path.join(directory, 'team-cache'));
  return preparationKey({ files, own }, c, databasePath);
}
function readPreparation(key, directory, context = {}) {
  if (!key) return null;
  const began = performance.now(), file = path.join(directory, 'assistant-cache', 'compiled-' + key + '.json');
  try {
    if (fs.statSync(file).size <= MAX_BYTES) {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value.version === VERSION && value.key === key && Array.isArray(value.prepared?.pool) && value.prepared.processed === value.prepared.total) {
        context.onProgress?.({ phase: 'preparing', message: '复用已计算的配置，正在应用本次条件…',
          prepared: value.prepared.pool.length, total: value.prepared.total, processed: value.prepared.processed, percent: 100 });
        return { ...value.prepared, elapsedMs: Math.round(performance.now() - began), cacheHit: true };
      }
    }
  } catch { /* Missing or damaged caches are rebuilt from source records. */ }
  return null;
}
function cachedPreparation(records, c, context, { directory, databasePath, compile, key: sourceKey }) {
  const began = performance.now(), key = sourceKey || preparationKey(records, c, databasePath), folder = path.join(directory, 'assistant-cache');
  const file = path.join(folder, 'compiled-' + key + '.json'), cached = readPreparation(key, directory, context);
  if (cached) return { ...cached, elapsedMs: Math.round(performance.now() - began) };
  const prepared = compile(records, c, context);
  let temporary;
  try {
    fs.mkdirSync(folder, { recursive: true });
    for (const name of fs.readdirSync(folder).filter(name => /^pending-[a-f0-9-]{36}\.tmp$/.test(name))) fs.unlinkSync(path.join(folder, name));
    const text = JSON.stringify({ version: VERSION, key, prepared });
    if (Buffer.byteLength(text) <= MAX_BYTES) {
      temporary = path.join(folder, 'pending-' + randomUUID() + '.tmp');
      fs.writeFileSync(temporary, text, 'utf8'); fs.renameSync(temporary, file);
      const files = fs.readdirSync(folder).filter(name => /^compiled-[a-f0-9]{64}\.json$/.test(name)).map(name => {
        const filename = path.join(folder, name); return { filename, time: fs.statSync(filename).mtimeMs };
      }).sort((a, b) => b.time - a.time);
      for (const old of files.slice(3)) fs.unlinkSync(old.filename);
    }
  } catch { /* A cache write failure must not prevent a valid calculation. */ }
  finally { if (temporary) { try { fs.unlinkSync(temporary); } catch { /* Already renamed. */ } } }
  return { ...prepared, elapsedMs: Math.round(performance.now() - began), cacheHit: false };
}
module.exports = { preparationKey, sourcePreparationKey, readPreparation, cachedPreparation };
