import type { AssistantScenario, BattleState } from './types';
export const defaultScenario = (): AssistantScenario => ({ field: { weather: '', terrain: '', gravity: false, trickRoom: false }, teamState: {} });
const statuses = [['', '无异常'], ['par', '麻痹'], ['brn', '灼伤'], ['psn', '中毒'], ['tox', '剧毒'], ['slp', '睡眠'], ['frz', '冰冻']];
export function StateControls({ value = {}, generation, prefix, update, opponent = false }: {
  value?: BattleState; generation: number; prefix: string; update: (value: BattleState) => void; opponent?: boolean;
}) {
  const change = (changes: Partial<BattleState>) => update({ ...value, ...changes });
  return <div className="assistant-state-controls"><div className="assistant-form-grid">
    <label>当前 HP（%）<input aria-label={prefix + 'HP百分比'} type="number" min={1} max={100} value={value.hpPercent ?? 100} onChange={event => change({ hpPercent: Number(event.target.value) })} /></label>
    <label>异常状态<select aria-label={prefix + '异常状态'} value={value.status || ''} onChange={event => change({ status: event.target.value })}>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {([['atk', '攻击'], ['def', '防御'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']] as const).map(([stat, label]) => <label key={stat}>{label}能力等级<select aria-label={prefix + label + '能力等级'} value={value.boosts?.[stat] || 0} onChange={event => change({ boosts: { ...value.boosts, [stat]: Number(event.target.value) } })}>{Array.from({ length: 13 }, (_, i) => i - 6).map(stage => <option key={stage} value={stage}>{stage > 0 ? '+' + stage : stage}</option>)}</select></label>)}
  </div><div className="assistant-check-row">{([
    ['tailwind', '顺风', 4], ['reflect', '反射壁', 1], ['lightScreen', '光墙', 1], ['auroraVeil', '极光幕', 7], ['abilityOn', '手动触发特性效果', 3],
    ...(opponent ? [['teraActive', '太晶化（使用配招太晶属性）', 9]] : []),
  ] as [keyof BattleState, string, number][]).filter(([, , gen]) => generation >= gen).map(([key, label]) => <label key={key}><input type="checkbox" aria-label={prefix + label} checked={value[key] === true} onChange={event => change({ [key]: event.target.checked })} />{label}</label>)}</div></div>;
}
export default function ScenarioControls({ value, generation, update }: { value: AssistantScenario; generation: number; update: (value: AssistantScenario) => void }) {
  const field = (changes: Partial<AssistantScenario['field']>) => update({ ...value, field: { ...value.field, ...changes } });
  return <section className="assistant-section"><h2>战况与状态</h2><p className="assistant-help">指定对手的打点、抗性和同优先度先手条件按这里的战况核对；通常速度门槛与队伍体检仍按常态统计。伤害检查会并列显示常态与本次战况。</p>
    <div className="assistant-form-grid"><label>天气<select aria-label="助手战况天气" value={value.field.weather} onChange={event => field({ weather: event.target.value })}>{[
      ['', '无天气', 1], ['Sun', '晴天', 2], ['Rain', '雨天', 2], ['Sand', '沙暴', 2], ['Hail', '冰雹', 3], ['Snow', '雪天', 9],
      ['Harsh Sunshine', '大日照', 6], ['Heavy Rain', '大雨', 6], ['Strong Winds', '乱流', 6],
    ].filter(([, , gen]) => generation >= Number(gen)).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      {generation >= 6 && <label>场地<select aria-label="助手战况场地" value={value.field.terrain} onChange={event => field({ terrain: event.target.value })}>{[['', '无场地'], ['Electric', '电气场地'], ['Grassy', '青草场地'], ['Psychic', '精神场地'], ['Misty', '薄雾场地']].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>}</div>
    {generation >= 4 && <div className="assistant-check-row"><label><input type="checkbox" aria-label="助手战况戏法空间" checked={Boolean(value.field.trickRoom)} onChange={event => field({ trickRoom: event.target.checked })} />戏法空间（同优先度慢者先动）</label><label><input type="checkbox" aria-label="助手战况重力" checked={Boolean(value.field.gravity)} onChange={event => field({ gravity: event.target.checked })} />重力</label></div>}
    <details><summary>我方统一状态</summary><p className="assistant-help">分别以这套状态检查每位成员与对手的单次对局；不会推演队伍是否已经成功启动天气、强化或墙。特性触发请按实际战况勾选，墙按已生效计算。</p><StateControls prefix="我方" value={value.teamState} generation={generation} update={teamState => update({ ...value, teamState })} /></details>
  </section>;
}
