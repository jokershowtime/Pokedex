const { constraints } = require('./team-solver.cjs');
function validatePreset(input) {
  if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 100 || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 60)
    throw new Error('条件模板的编号或名称无效，名称需为 1～60 字。');
  const { generation, outputFormat, ...conditions } = constraints(input.conditions);
  return { id: input.id, title: input.title.trim(), conditions };
}
function presetList(input, strict = true) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 30) { if (strict) throw new Error('条件模板最多保存 30 个。'); return []; }
  const result = [], ids = new Set();
  for (const value of input) {
    try {
      const preset = validatePreset(value);
      if (ids.has(preset.id)) throw new Error('条件模板编号重复。');
      ids.add(preset.id); result.push(preset);
    } catch (error) { if (strict) throw error; }
  }
  return result;
}
module.exports = { validatePreset, presetList };
