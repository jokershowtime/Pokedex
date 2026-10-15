import type { PokemonTeam, StrategySet, UserState } from './types';

export const progressKeys = (plan: StrategySet) => [
  'item', 'evs', 'ivs', ...(plan.generation >= 3 ? ['ability', 'nature'] : []),
  ...plan.selection.moves.flatMap((move, index) => move ? ['move' + index] : []),
];
export const planComplete = (plan: StrategySet) => progressKeys(plan).every(key => Boolean(plan.progress?.[key]));
export function linkedPlans(team: PokemonTeam, user: UserState) {
  return team.members.flatMap(member => {
    const plan = user.plans.find(value => value.id === member.id && value.teamId === team.id);
    return plan ? [plan] : [];
  });
}
export function findSavedTeam(team: PokemonTeam, saved: PokemonTeam[]) {
  return saved.find(value => value.id === team.id || value.originId === team.id ||
    Boolean(value.originId && team.aliases?.includes(value.originId))) ||
    saved.find(value => Boolean(team.fingerprint && team.fingerprint === value.fingerprint));
}
export function planTeam(plan: StrategySet, user: UserState) {
  return user.teams.find(team => team.id === plan.teamId && team.members.some(member => member.id === plan.id));
}
export function removalMessage(plan: StrategySet, user: UserState) {
  const team = planTeam(plan, user);
  if (!team) return '个人培养方案已删除。';
  const remaining = Math.max(0, linkedPlans(team, user).length - 1);
  return '成员培养计划已移除；“' + team.title + '”仍在收藏，培养计划 ' + remaining + '/' + team.members.length + '。可在整队培养中重新加入或取消收藏。';
}
