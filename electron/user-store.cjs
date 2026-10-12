const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UI_SCALES = [100, 125, 150, 175, 200];
const DEFAULT_SETTINGS = { versionId: 27, theme: 'light', imageStyle: 'artwork', shortcut: 'Ctrl+Alt+P', keepOnTop: false, uiScale: 125 };
function createUserStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'preferences.json');
  let state = { favorites: [], history: [], notes: {}, plans: [], teams: [], settings: { ...DEFAULT_SETTINGS } };
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = {
        favorites: Array.isArray(saved.favorites) ? saved.favorites.filter(Number.isInteger) : [],
        history: Array.isArray(saved.history) ? saved.history.filter(entry => Number.isInteger(entry.id)).slice(0, 50) : [],
        notes: saved.notes && typeof saved.notes === 'object' ? saved.notes : {},
        plans: Array.isArray(saved.plans) ? saved.plans.filter(plan => plan && typeof plan.id === 'string' && Number.isInteger(plan.pokemonId) && plan.selection && Array.isArray(plan.moveOptions)).slice(0, 2000) : [],
        teams: Array.isArray(saved.teams) ? saved.teams.filter(team => team && typeof team.id === 'string' && typeof team.format === 'string' && Array.isArray(team.members) && team.members.length > 0 && team.members.length <= 6 && team.members.every(member => member && Number.isInteger(member.pokemonId) && member.selection)).slice(0, 200) : [],
        settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      };
      if (!UI_SCALES.includes(state.settings.uiScale)) state.settings.uiScale = DEFAULT_SETTINGS.uiScale;
    } catch {
      // Preserve a damaged file so it can be recovered manually.
      fs.copyFileSync(file, `${file}.recovery-${Date.now()}`);
    }
  }
  // Older team saves discarded the source member ID when assigning personal
  // IDs. Recover that lineage so cancelling and recollecting can retain work.
  for (const team of state.teams) if (/^(?:smogon|source)-team-/.test(team.originId || '')) {
    team.members.forEach((member, index) => {
      member.originId ||= team.originId + '-' + index;
      const plan = state.plans.find(value => value.id === member.id && value.teamId === team.id);
      if (plan) plan.originId ||= member.originId;
    });
  }
  function persist() {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, file);
    return structuredClone(state);
  }
  function preparedPlan(input, snapshot) {
    const now = new Date().toISOString();
    const existing = state.plans.find(plan => plan.id === input.id) || snapshot;
    const progress = { ...(existing?.progress || {}) };
    if (existing) {
      for (const field of ['ability', 'nature', 'item', 'evs', 'ivs']) if (JSON.stringify(existing.selection[field]) !== JSON.stringify(input.selection[field])) progress[field] = false;
      if (JSON.stringify(existing.selection.moves) !== JSON.stringify(input.selection.moves)) for (let index = 0; index < 4; index++) progress[`move${index}`] = false;
    }
    return { ...structuredClone(input), id: existing?.id || `personal-${randomUUID()}`,
      originId: existing?.originId || input.originId || (input.id?.startsWith('smogon-') ? input.id : null),
      createdAt: existing?.createdAt || now, updatedAt: now, personal: true, progress };
  }
  function updateTeamMembers(plan) {
    state.teams = state.teams.map(team => team.members.some(member => member.id === plan.id) ?
      { ...team, members: team.members.map(member => member.id === plan.id ? structuredClone(plan) : member), updatedAt: new Date().toISOString() } : team);
  }
  return {
    get: () => structuredClone(state),
    favorite(id) {
      state.favorites = state.favorites.includes(id) ? state.favorites.filter(value => value !== id) : [...state.favorites, id];
      return persist();
    },
    visit(id) {
      state.history = [{ id, at: new Date().toISOString() }, ...state.history.filter(entry => entry.id !== id)].slice(0, 50);
      return persist();
    },
    note(id, text) {
      if (typeof text !== 'string' || text.length > 5000) throw new Error('笔记最多支持 5000 字。');
      if (text.trim()) state.notes[id] = text;
      else delete state.notes[id];
      return persist();
    },
    settings(settings) { state.settings = { ...state.settings, ...settings }; return persist(); },
    restorePersonal(input) {
      const recovery = path.join(directory, 'preferences.before-restore-' + Date.now() + '.json');
      fs.writeFileSync(recovery, JSON.stringify(state, null, 2), 'utf8');
      const previous = state;
      state = { ...structuredClone(input), settings: { ...state.settings } };
      try { return { user: persist(), recovery }; } catch (error) { state = previous; throw error; }
    },
    savePlan(input) {
      const existing = state.plans.find(plan => plan.id === input.id);
      if (!existing && state.plans.length >= 2000) throw new Error('最多保存 2000 套个人方案。');
      const plan = preparedPlan(input);
      state.plans = existing ? state.plans.map(value => value.id === existing.id ? plan : value) : [plan, ...state.plans];
      updateTeamMembers(plan);
      return persist();
    },
    savePlans(inputs) {
      if (!Array.isArray(inputs) || inputs.length + state.plans.length > 2000) throw new Error('导入后将超过 2000 套个人方案，请减少数量。');
      const plans = inputs.map(preparedPlan); state.plans = [...plans, ...state.plans]; return persist();
    },
    deletePlan(id) {
      if (!state.plans.some(plan => plan.id === id)) throw new Error('找不到这套个人方案。');
      state.plans = state.plans.filter(plan => plan.id !== id); return persist();
    },
    saveTeam(input) {
      const existing = state.teams.find(team => team.id === input.id);
      const sourceTeam = /^(?:smogon|source)-team-/.test(input.id || '');
      if (!existing && sourceTeam && state.teams.some(team => team.originId === input.id || input.aliases?.includes(team.originId) || input.fingerprint && team.fingerprint === input.fingerprint)) return structuredClone(state);
      if (!existing && state.teams.length >= 200) throw new Error('最多收藏 200 支队伍。');
      if (existing && input.members.some(member => !existing.members.some(value => value.id === member.id))) throw new Error('成员编号与收藏队伍不一致，请重新导入这支队伍。');
      if (existing && input.members.some(member => state.plans.some(plan => plan.id === member.id && plan.teamId !== existing.id))) throw new Error('成员计划与其他方案冲突，未修改队伍。');
      const referenced = new Set(state.teams.flatMap(team => team.members.map(member => member.id)));
      const reused = new Map(), used = new Set();
      if (!existing && sourceTeam) for (const member of input.members) {
        const candidates = state.plans.filter(plan => !plan.teamId && !referenced.has(plan.id) && !used.has(plan.id) &&
          plan.originId === member.id && plan.pokemonId === member.pokemonId && plan.generation === member.generation);
        if (candidates.length === 1) { reused.set(member.id, candidates[0]); used.add(candidates[0].id); }
      }
      const added = existing ? 0 : input.members.length - reused.size;
      if (state.plans.length + added > 2000) throw new Error('保存队伍后将超过 2000 套培养方案，请先整理已有方案。');
      const now = new Date().toISOString(), id = existing?.id || 'personal-team-' + randomUUID();
      const members = input.members.map(member => {
        if (existing) return preparedPlan({ ...member, teamId: id }, existing.members.find(value => value.id === member.id));
        const retained = reused.get(member.id);
        return retained ? preparedPlan({ ...retained, teamId: id }) :
          preparedPlan({ ...member, id: 'new-team-member', teamId: id, originId: member.originId || (sourceTeam ? member.id : null) });
      });
      const team = { ...structuredClone(input), id, members, personal: true, originId: existing?.originId || input.originId || (sourceTeam ? input.id : null),
        createdAt: existing?.createdAt || now, updatedAt: now };
      const activeMembers = existing ? members.filter(member => state.plans.some(plan => plan.id === member.id && plan.teamId === id)) : members;
      const memberIds = new Set(activeMembers.map(member => member.id));
      const previous = state;
      state = { ...state, plans: [...activeMembers, ...state.plans.filter(plan => !memberIds.has(plan.id))],
        teams: existing ? state.teams.map(value => value.id === existing.id ? team : value) : [team, ...state.teams] };
      try { return persist(); } catch (error) { state = previous; throw error; }
    },
    restoreTeamPlans(id, memberId) {
      const team = state.teams.find(value => value.id === id);
      if (!team) throw new Error('找不到这支收藏队伍。');
      if (memberId !== undefined && !team.members.some(member => member.id === memberId)) throw new Error('找不到这位队伍成员。');
      const selected = team.members.filter(member => memberId === undefined || member.id === memberId);
      if (selected.some(member => state.plans.some(plan => plan.id === member.id && plan.teamId !== id) ||
        state.teams.some(value => value.id !== id && value.members.some(other => other.id === member.id)))) throw new Error('成员计划编号冲突，未重新加入培养。');
      const missing = selected.filter(member => !state.plans.some(plan => plan.id === member.id && plan.teamId === id));
      if (!missing.length) return structuredClone(state);
      if (state.plans.length + missing.length > 2000) throw new Error('重新加入后将超过 2000 套培养方案，请先整理已有方案。');
      const restored = missing.map(member => preparedPlan({ ...member, teamId: id }, member));
      const replacements = new Map(restored.map(member => [member.id, member]));
      const previous = state;
      state = { ...state, plans: [...restored, ...state.plans], teams: state.teams.map(value => value.id === id ?
        { ...value, members: value.members.map(member => replacements.get(member.id) || member), updatedAt: new Date().toISOString() } : value) };
      try { return persist(); } catch (error) { state = previous; throw error; }
    },
    deleteTeam(id, deletePlans = false) {
      const team = state.teams.find(value => value.id === id);
      if (!team) throw new Error('找不到这支收藏队伍。');
      const memberIds = new Set(team.members.map(member => member.id));
      const previous = state;
      state = { ...state, teams: state.teams.filter(value => value.id !== id),
        plans: state.plans.filter(plan => !(deletePlans && memberIds.has(plan.id) && plan.teamId === id)).map(plan => {
          if (plan.teamId !== id) return plan;
          const result = { ...plan }; delete result.teamId; return result;
        }) };
      try { return persist(); } catch (error) { state = previous; throw error; }
    },
    progress(id, key, value) {
      if (!['ability', 'nature', 'item', 'evs', 'ivs', 'move0', 'move1', 'move2', 'move3'].includes(key) || typeof value !== 'boolean') throw new Error('无效的培养进度。');
      const plan = state.plans.find(plan => plan.id === id);
      if (!plan) throw new Error('找不到这套个人方案。');
      plan.progress = { ...plan.progress, [key]: value }; plan.updatedAt = new Date().toISOString(); updateTeamMembers(plan); return persist();
    },
  };
}
module.exports = { createUserStore, DEFAULT_SETTINGS, UI_SCALES };
