import { useState } from 'react';
import type { AssistantDamageMove, AssistantInspection, DamageMove, OpponentReference, PokemonTeam } from './types';
const range = (value: DamageMove | null) => !value ? '未知' : value.category === 'Status' ? '变化招式，无直接伤害' : value.min + '～' + value.max + ' HP（' + value.minPercent + '%～' + value.maxPercent + '%）';
const chance = (value: DamageMove) => value.oneHitChance === null ? '多段伤害需核对' : Math.round(value.oneHitChance * 1000) / 10 + '%';
function DamageTable({ rows, title }: { rows: AssistantDamageMove[]; title: string }) {
  return <div className="assistant-damage-direction"><h4>{title}</h4><div className="assistant-comparison-scroll"><table><thead><tr><th>招式</th><th>常态伤害</th><th>战况伤害</th><th>战况击倒概率</th></tr></thead><tbody>{rows.map(row => <tr key={row.move}><th>{row.active?.move || row.baseline?.move || row.move}</th><td>{range(row.baseline)}</td><td>{range(row.active)}{row.active && row.active.category !== 'Status' && <small>目标 HP {row.active.currentHP} / {row.active.targetHP}</small>}{row.unknown && <small>{row.unknown}</small>}</td><td>{row.active && row.active.category !== 'Status' ? <><p>一次：{chance(row.active)}</p>{row.active.ko && row.active.ko.n > 1 && <small>{row.active.ko.n} 次攻击：{row.active.ko.chance === null ? '视随机值与回复而定' : Math.round(row.active.ko.chance * 1000) / 10 + '%'}</small>}</> : '—'}</td></tr>)}</tbody></table></div></div>;
}
export default function AssistantDamage({ team, opponents, inspection, busy, calculate, cancel }: {
  team: PokemonTeam; opponents: OpponentReference[]; inspection?: AssistantInspection; busy: boolean; calculate: () => void; cancel: () => void;
}) {
  const [memberId, setMemberId] = useState(team.members[0]?.id || ''), [targetId, setTargetId] = useState(opponents[0]?.targetId || '');
  if (!opponents.length) return null;
  const running = inspection && ['running', 'cancelling'].includes(inspection.state);
  const rows = inspection?.state === 'complete' ? inspection.report?.rows || [] : [];
  const selected = rows.find(row => row.memberId === memberId && row.targetId === targetId);
  const summary = rows.filter(row => row.targetId === targetId);
  const maximum = (moves: AssistantDamageMove[]) => moves.flatMap(value => value.active && value.active.category !== 'Status' ? [value.active] : []).sort((a, b) => b.maxPercent - a.maxPercent)[0];
  return <section className="assistant-damage assistant-section" aria-label="伤害与承伤核对"><h3>伤害与承伤核对</h3><p className="assistant-help">按需检查本队六位成员与全部指定路线的双向招式伤害。检查使用生成时的战况与配置，常态列作为对照；修改条件后需重新组队。</p>
    <div className="assistant-damage-toolbar">{running ? <><strong>{inspection.state === 'cancelling' ? '正在取消伤害检查…' : '正在检查本队伤害…'}</strong><button className="secondary-button" aria-label="取消伤害检查" disabled={inspection.state === 'cancelling'} onClick={cancel}>取消检查</button></> : <button className="secondary-button" aria-label="检查本队伤害" disabled={busy} onClick={calculate}>{rows.length ? '查看已完成的本队检查' : '检查本队伤害'}</button>}</div>
    {inspection && <div className="assistant-help" role="status">{running && <progress aria-label="伤害检查进度" value={inspection.percent} max={100} />}<p>{inspection.state === 'complete' ? '检查完成' : inspection.state === 'cancelled' ? '检查已取消，可重新开始' : inspection.state === 'error' ? inspection.error : '已处理 ' + inspection.processed + ' / ' + inspection.total} · {(inspection.elapsedMs / 1000).toFixed(1)} 秒</p></div>}
    {rows.length > 0 && <><div className="assistant-form-grid"><label>对手路线<select aria-label="伤害核对对手路线" value={targetId} onChange={event => setTargetId(event.target.value)}>{opponents.map((opponent, i) => <option key={opponent.targetId} value={opponent.targetId}>{opponent.name} · 路线 {i + 1} · {opponent.reference.title}</option>)}</select></label><label>我方成员<select aria-label="伤害核对我方成员" value={memberId} onChange={event => setMemberId(event.target.value)}>{team.members.map(member => <option key={member.id} value={member.id}>{member.pokemonName}</option>)}</select></label></div>
      <div className="assistant-comparison-scroll"><table className="assistant-damage-summary"><thead><tr><th>我方成员</th><th>最高单招输出（战况）</th><th>最高单招承伤（战况）</th></tr></thead><tbody>{summary.map(row => {
        const outgoing = maximum(row.outgoing), incoming = maximum(row.incoming);
        return <tr key={row.memberId}><th><button className="text-button" onClick={() => setMemberId(row.memberId)}>{row.name}</button></th><td>{outgoing ? outgoing.move + ' · ' + outgoing.minPercent + '%～' + outgoing.maxPercent + '%' : '无已确认直接攻击'}</td><td>{incoming ? incoming.move + ' · ' + incoming.minPercent + '%～' + incoming.maxPercent + '%' : '无已确认直接攻击'}</td></tr>;
      })}</tbody></table></div>
      {selected && <div className="assistant-damage-detail"><p>速度（我方／对手）：常态 {selected.normalSpeed} / {selected.normalTargetSpeed} → 战况 {selected.speed} / {selected.targetSpeed}；同优先度{selected.first === 'tie' ? '速度相同，存在随机顺序' : selected.first === 'member' ? '我方先动' : '对手先动'}。</p><DamageTable rows={selected.outgoing} title={selected.name + ' → ' + selected.opponentName} /><DamageTable rows={selected.incoming} title={selected.opponentName + ' → ' + selected.name} /></div>}
      <p className="assistant-help">{inspection?.report?.note}</p></>}
  </section>;
}
