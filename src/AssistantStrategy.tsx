import type { AssistantScenario, OpponentMatchup, OpponentReference, StrategyReferences, StrategySet, TeamPlaybook } from './types';
const weathers: Record<string, string> = { Sun: '晴天', Rain: '雨天', Sand: '沙暴', Hail: '冰雹', Snow: '雪天', 'Harsh Sunshine': '大日照', 'Heavy Rain': '大雨', 'Strong Winds': '乱流' };
const terrains: Record<string, string> = { Electric: '电气场地', Grassy: '青草场地', Psychic: '精神场地', Misty: '薄雾场地' };
const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const label = (set: StrategySet, kind: string, value: string) => set.labels?.[kind]?.[value]?.name || value || '无';
const stateLabel = (opponent: OpponentReference) => {
  const state = opponent.state, names: Record<string, string> = { slp: '睡眠', psn: '中毒', brn: '灼伤', frz: '冰冻', par: '麻痹', tox: '剧毒' };
  const boosts: Record<string, string> = { atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
  return ['HP ' + (state.hpPercent ?? 100) + '%', names[state.status || ''] || '无异常',
    ...Object.entries({ tailwind: '顺风', reflect: '反射壁', lightScreen: '光墙', auroraVeil: '极光幕', abilityOn: '手动触发特性' }).filter(([key]) => state[key as keyof typeof state]).map(([, title]) => title),
    ...Object.entries(state.boosts || {}).filter(([, value]) => value).map(([key, value]) => boosts[key] + (value! > 0 ? '+' : '') + value),
    ...(state.teraActive ? ['太晶化：' + label(opponent.reference, 'types', opponent.reference.selection.teraType)] : [])].join(' · ');
};
export function OpponentReferences({ opponents, scenario }: { opponents: OpponentReference[]; scenario?: AssistantScenario }) {
  if (!opponents.length) return null;
  return <section className="assistant-section assistant-opponent-references" aria-label="本次对手参考配招"><h2>本次对手参考配招</h2>
    <p className="assistant-help">按本次等级与选定战况逐招比较。天气：{weathers[scenario?.field.weather || ''] || '无'}；场地：{terrains[scenario?.field.terrain || ''] || '无'}；{scenario?.field.trickRoom ? '空间已启用' : '空间未启用'}。克制按属性效果与免疫核对，速度只比较同优先度；抗性不等于安全换入。</p>
    {opponents.map((opponent, index) => <details key={opponent.targetId}><summary>{opponent.name} · 路线 {index + 1} · 常态速度 {opponent.speed} · {opponent.reference.title}</summary>
      <div className="assistant-opponent-reference"><p>{opponent.method === 'fastest' ? '采用当前资料内常态速度最高的完整配置' : opponent.method === 'manual' ? '采用手动指定的完整配招快照' : '优先较新世代的完整来源配置'} · 来源第 {opponent.reference.referenceGeneration || opponent.reference.generation} 世代 · 按第 {opponent.reference.generation} 世代、{opponent.reference.selection.level} 级计算</p>
        <p>特性：{label(opponent.reference, 'abilities', opponent.reference.selection.ability)} · 性格：{label(opponent.reference, 'natures', opponent.reference.selection.nature)} · 道具：{label(opponent.reference, 'items', opponent.reference.selection.item)}</p>
        <p>招式：{opponent.reference.selection.moves.map(move => label(opponent.reference, 'moves', move)).join(' / ')}</p>
        <p>努力值：{stats.map(stat => opponent.reference.selection.evs[stat]).join(' / ')} · 个体值：{stats.map(stat => opponent.reference.selection.ivs[stat]).join(' / ')}</p>
        <p>状态：{stateLabel(opponent)}</p>
        <small>数值顺序：HP／攻击／防御／特攻／特防／速度；来源：{opponent.reference.source.provider}。</small>
      </div></details>)}
  </section>;
}
export function OpponentChecks({ opponents, rows, refs }: { opponents: OpponentReference[]; rows: OpponentMatchup[]; refs: StrategyReferences | null }) {
  if (!rows.length) return null;
  const moveName = (name: string) => refs?.moves.find(move => move.english === name)?.name || name;
  return <section className="assistant-opponent-checks" aria-label="指定对手应对核对"><h3>指定对手应对核对</h3><div className="assistant-comparison-scroll"><table><thead><tr><th>对手基准</th><th>可命中的克制打点</th><th>抵抗／免疫其全部攻击</th><th>战况先手（同优先度）</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.targetId}><th>{opponents.find(opponent => opponent.targetId === row.targetId)?.name || row.pokemonId}<small>路线 {index + 1} · {opponents.find(opponent => opponent.targetId === row.targetId)?.reference.title}</small></th>
      <td>{row.attackers.length ? row.attackers.map(member => <p key={member.pokemonId}><strong>{member.name}</strong>：{member.moves.map(move => moveName(move.name) + ' ×' + move.multiplier).join('、')}</p>) : '未识别到'}</td>
      <td>{row.resistors.map(member => member.name).join('、') || '未识别到'}{row.uncertain && <small>含条件招式或未确认比较，未知结果未按满足要求计入。</small>}</td>
      <td>{row.faster.map(member => member.name + '（' + member.speed + '）').join('、') || '没有同优先度先手成员'}<details><summary>逐位速度对照</summary>{row.speeds?.map(member => <p key={member.pokemonId}>{member.name}：{member.normal} → {member.current}；对手 {member.opponent}；{member.first === 'tie' ? '同速' : member.first === 'member' ? '我方先动' : '对手先动'}</p>)}</details></td></tr>)}</tbody></table></div>
    <p className="assistant-help">克制、抗性与先手可由不同成员提供；打点不等于击倒保证。先手核对包含选定的顺风、空间与状态，招式优先度另看实际招式。</p>
  </section>;
}
export function TeamPlaybookView({ plan }: { plan?: TeamPlaybook }) {
  if (!plan) return null;
  return <section className="assistant-playbook" aria-label="队伍打法参考"><h3>队伍打法参考</h3>
    <p className="assistant-help">根据本次实际特性、招式和配置生成，保存到整队培养时会一并写入队伍笔记。</p>
    <div className="assistant-playbook-roles">{plan.roles.map(role => <div key={role.label}><strong>{role.label} · {role.members.length} 位{role.minimum > 0 && '（至少 ' + role.minimum + ' 位）'}</strong><span>{role.members.join('、')}</span></div>)}</div>
    {[['开场与启动', plan.opening], ['轮转与续航', plan.rotation], ['进攻安排', plan.pressure], ['需要留意', plan.cautions]].map(([title, rows]) =>
      Array.isArray(rows) && rows.length > 0 && <div className="assistant-playbook-part" key={String(title)}><h4>{String(title)}</h4><ul>{rows.map(text => <li key={text}>{text}</li>)}</ul></div>)}
  </section>;
}
