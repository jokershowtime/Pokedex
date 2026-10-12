import { useEffect, useState } from 'react';
import { Calculator, Check, Gauge, ListChecks, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { BattleField, BattleFighter, BattleReferences, BattleState, BattleStats, PokemonTeam, StrategySet, TeamAnalysis, UserState } from './types';
import { TypeChip } from './components';
import { setLabel, STAT_KEYS, STAT_LABELS } from './StrategyCards';
import { battleError, defaultField, FieldControls, FighterEditor, type BattleSeed } from './BattlePage';
import { linkedPlans } from './cultivation-model';

function fieldForTeam(team: PokemonTeam): BattleField {
  const weatherTags = team.tags.filter(tag => ['rain', 'sun', 'sand', 'snow'].includes(tag.id));
  const weather = weatherTags.length === 1 ? ({ rain: 'Rain', sun: 'Sun', sand: 'Sand', snow: team.generation >= 9 ? 'Snow' : 'Hail' } as Record<string, string>)[weatherTags[0].id] : '';
  return { ...defaultField(), weather, gameType: team.category === 'doubles' ? 'Doubles' : 'Singles' };
}
export default function TeamAnalytics({ team, user, onBattle }: { team: PokemonTeam; user: UserState; onBattle: (seed: BattleSeed) => void }) {
  const [tab, setTab] = useState('health'), [level, setLevel] = useState<string | number>('source'), [field, setField] = useState<BattleField>(() => fieldForTeam(team));
  const [analysis, setAnalysis] = useState<TeamAnalysis | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [references, setReferences] = useState<BattleReferences | null>(null), [counter, setCounter] = useState<BattleFighter | null>(null), [counterStats, setCounterStats] = useState<BattleStats | null>(null);
  const [progress, setProgress] = useState<Record<string, Record<string, boolean>>>({});
  useEffect(() => { setProgress({}); }, [team]);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    window.pokedex.battle<TeamAnalysis>('analyze', { team, level, field }).then(value => { if (live) { setAnalysis(value); setLoading(false); } }).catch(failure => { if (live) { setError(battleError(failure)); setAnalysis(null); setLoading(false); } });
    return () => { live = false; };
  }, [team, level, field]);
  useEffect(() => {
    let live = true;
    window.pokedex.battle<BattleReferences>('references', { generation: team.generation }).then(value => { if (live) setReferences(value); }).catch(failure => { if (live) setError(battleError(failure)); });
    return () => { live = false; };
  }, [team.generation]);
  useEffect(() => {
    if (!counter) { setCounterStats(null); return; }
    let live = true; window.pokedex.battle<BattleStats>('stats', { generation: team.generation, fighter: counter, field }).then(value => { if (live) setCounterStats(value); }).catch(failure => { if (live) { setError(battleError(failure)); setCounterStats(null); } });
    return () => { live = false; };
  }, [counter, field, team.generation]);
  const memberState = (id: string, patch: Partial<BattleState>) => setField(value => ({ ...value, members: { ...value.members, [id]: { ...value.members?.[id], ...patch } } }));
  const compare = (speed: number) => !counterStats ? '' : speed === counterStats.finalSpeed ? '同速' : (field.trickRoom ? speed < counterStats.finalSpeed : speed > counterStats.finalSpeed) ? '同优先度先手' : '同优先度后手';
  const chooseCounter = async (id: number, name: string) => { try { setCounter(await window.pokedex.battle<BattleFighter>('draft', { pokemonId: id, speciesName: name, generation: team.generation })); } catch (failure) { setError(battleError(failure)); } };
  const counterOption = counter && (references?.pokemon.find(entry => entry.id === counter.pokemonId && [entry.engineName, entry.english].some(name => name.toLowerCase() === counter.showdownSpecies?.toLowerCase())) || references?.pokemon.find(entry => entry.id === counter.pokemonId));
  const launch = (member: TeamAnalysis['members'][number]) => onBattle({ generation: team.generation, attacker: structuredClone(member.fighter), defender: counter ? structuredClone(counter) : undefined, field: { ...field, members: undefined } });
  const tasks = (member: StrategySet) => [
    { key: 'item', label: '道具', detail: setLabel(member, 'items', member.selection.item) },
    ...(team.generation >= 3 ? [{ key: 'ability', label: '特性', detail: setLabel(member, 'abilities', member.selection.ability) }, { key: 'nature', label: '性格', detail: setLabel(member, 'natures', member.selection.nature) }] : []),
    { key: 'evs', label: '努力值', detail: STAT_KEYS.map(key => (team.generation === 1 && key === 'spa' ? '特殊' : STAT_LABELS[key]) + ' ' + member.selection.evs[key]).join(' / ') },
    { key: 'ivs', label: '个体值', detail: STAT_KEYS.map(key => STAT_LABELS[key] + ' ' + member.selection.ivs[key]).join(' / ') },
    ...member.selection.moves.map((move, index) => ({ key: 'move' + index, label: '招式 ' + (index + 1), detail: setLabel(member, 'moves', move) })),
  ];
  const activeIds = new Set(linkedPlans(team, user).map(plan => plan.id));
  const done = (member: StrategySet, key: string) => team.personal && !activeIds.has(member.id) ? false :
    progress[member.id]?.[key] ?? Boolean(member.progress?.[key]);
  const toggle = (id: string, key: string, value: boolean) => {
    const previous = done(team.members.find(member => member.id === id)!, key);
    setProgress(old => ({ ...old, [id]: { ...old[id], [key]: value } }));
    void window.pokedex.strategy('progress', { id, key, value }).catch(failure => { setProgress(old => ({ ...old, [id]: { ...old[id], [key]: previous } })); setError(battleError(failure)); });
  };
  const total = team.members.reduce((sum, member) => sum + tasks(member).length, 0), completed = team.members.reduce((sum, member) => sum + tasks(member).filter(task => done(member, task.key)).length, 0);
  return <section className="team-analytics"><header><div><span className="eyebrow">先看懂这套配置</span><h2>队伍体检与实数</h2></div>{loading && <LoaderCircle size={18} className="spin" />}</header>
    <div className="strategy-view-tabs"><button className={tab === 'health' ? 'active' : ''} onClick={() => setTab('health')}><ShieldCheck size={16} />队伍体检</button><button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}><Gauge size={16} />能力实数与速度</button><button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><ListChecks size={16} />整队培养清单</button></div>
    {tab !== 'tasks' && <><div className="team-analysis-controls"><label>等级参考<select aria-label="队伍计算等级" value={level} onChange={event => setLevel(event.target.value === 'source' ? 'source' : Number(event.target.value))}><option value="source">沿用各成员原配置</option><option value={50}>统一 50 级</option><option value={100}>统一 100 级</option></select></label><span>按第 {team.generation} 世代计算</span></div><FieldControls field={field} generation={team.generation} update={setField} compact /></>}
    {error && <div className="build-errors" role="alert">{error}</div>}
    {tab === 'health' && analysis && <div className="team-health-report">
      <div className="team-observations"><h3>可以检查的配置线索</h3>{analysis.observations.length ? analysis.observations.map((item, index) => <p key={index} className={item.kind}><ShieldCheck size={15} />{item.text}</p>) : <p className="positive"><Check size={15} />未发现集中弱点或上述功能缺项，仍需结合对手与规则使用。</p>}</div>
      <h3>防御弱点、抗性与免疫</h3><div className="team-matrix-scroll"><table className="team-defense-table"><thead><tr><th>受到的属性</th>{analysis.members.map(member => <th key={member.id}>{member.name}</th>)}<th>弱点 / 抗性 / 免疫</th></tr></thead><tbody>{analysis.defensive.map(row => <tr key={row.id}><th><TypeChip id={row.id} types={analysis.defensive.map(value => ({ id: value.id, name: value.name, generation: team.generation }))} small /></th>{row.values.map((value, index) => <td key={index} className={value === 0 ? 'immune' : value < 1 ? 'resist' : value > 1 ? 'weak' : 'neutral'}>×{value}</td>)}<td>{row.weak} / {row.resist} / {row.immune}</td></tr>)}</tbody></table></div>
      <h3>招式打击面 · 单属性目标</h3><div className="team-offense-grid">{analysis.offensive.map(row => <details key={row.id} className={row.moves.length ? 'covered' : 'uncovered'}><summary><TypeChip id={row.id} types={analysis.offensive.map(value => ({ id: value.id, name: value.name, generation: team.generation }))} small /><span>{row.moves.length ? row.moves.length + ' 个克制招式' : '无克制招式'}</span></summary>{row.moves.map((move, index) => <p key={index}>{move.pokemon} · {move.move}</p>)}</details>)}</div>
      <div className="team-function-tags"><span>已识别功能</span>{analysis.roles.map(role => <b key={role}>{role}</b>)}</div><p className="section-footnote">{analysis.note}</p>
    </div>}
    {tab === 'stats' && analysis && <div className="team-real-stats"><p className="section-footnote">能力实数不含战斗阶段与道具修正；速度列计入当前天气、场地、道具与所选条件。同速时不能保证先后，先制招式另看优先度。</p>
      <div className="team-matrix-scroll"><table className="team-speed-table"><thead><tr><th>成员</th><th>等级</th>{STAT_KEYS.filter(key => team.generation !== 1 || key !== 'spd').map(key => <th key={key}>{team.generation === 1 && key === 'spa' ? '特殊' : STAT_LABELS[key]}</th>)}<th>战斗速度</th><th>速度条件</th>{counterStats && <th>对比 {counterStats.name}</th>}<th>计算伤害</th></tr></thead><tbody>{analysis.speedOrder.map(id => analysis.members.find(member => member.id === id)!).map(member => <tr key={member.id}><th>{member.name}</th><td>{member.level}</td>{STAT_KEYS.filter(key => team.generation !== 1 || key !== 'spd').map(key => <td key={key}>{member.stats[key]}</td>)}<td className="final-speed">{member.finalSpeed}</td><td><div className="speed-row-controls"><select aria-label={member.name + '速度能力等级'} value={field.members?.[member.id]?.boosts?.spe || 0} onChange={event => memberState(member.id, { boosts: { ...field.members?.[member.id]?.boosts, spe: Number(event.target.value) } })}>{Array.from({ length: 13 }, (_, index) => index - 6).map(stage => <option key={stage} value={stage}>{stage > 0 ? '+' : ''}{stage} 阶段</option>)}</select>{team.generation >= 4 && <label><input type="checkbox" aria-label={member.name + '顺风'} checked={Boolean(field.members?.[member.id]?.tailwind)} onChange={event => memberState(member.id, { tailwind: event.target.checked })} />顺风</label>}<label><input type="checkbox" aria-label={member.name + '麻痹'} checked={field.members?.[member.id]?.status === 'par'} onChange={event => memberState(member.id, { status: event.target.checked ? 'par' : '' })} />麻痹</label></div></td>{counterStats && <td>{compare(member.finalSpeed)} · 差 {Math.abs(member.finalSpeed - counterStats.finalSpeed)}</td>}<td><button aria-label={'计算' + member.name + '的伤害'} onClick={() => launch(member)}><Calculator size={15} />带入</button></td></tr>)}</tbody></table></div>
      <div className="team-speed-order">{field.trickRoom ? '戏法空间下的同优先度顺序' : '当前速度由快到慢'}：{analysis.speedOrder.map(id => analysis.members.find(member => member.id === id)?.name).join(' → ')}</div>
      {references && <div className="team-counter-picker"><label>选择速度参照对手<select aria-label="队伍速度参照宝可梦" value={counterOption ? counterOption.id + ':' + counterOption.engineName : ''} onChange={event => { if (!event.target.value) { setCounter(null); return; } const entry = references.pokemon.find(value => value.id + ':' + value.engineName === event.target.value); if (entry) void chooseCounter(entry.id, entry.english); }}><option value="">暂不比较对手</option>{references.pokemon.map(entry => <option key={entry.id + ':' + entry.engineName} value={entry.id + ':' + entry.engineName}>{entry.name}</option>)}</select></label>{counterStats && <span>{counterStats.name}：当前速度 {counterStats.finalSpeed}</span>}</div>}
      {counter && references && <details className="counter-editor"><summary>调整参照对手的性格、配速和战斗条件</summary><FighterEditor fighter={counter} update={setCounter} references={references} generation={team.generation} title="参照对手配置" label="参照" changePokemon={(id, name) => void chooseCounter(id, name)} result={counterStats} /></details>}
      {analysis.warnings.length > 0 && <details className="battle-notes"><summary>计算配置说明</summary>{analysis.warnings.map(text => <p key={text}>{text}</p>)}</details>}
    </div>}
    {tab === 'tasks' && <div className="team-cultivation-list"><div className="team-task-total"><strong>已完成 {completed} / {total} 项</strong><span>还剩 {total - completed} 项{!team.personal && ' · 收藏整队后可勾选'}</span></div><div className="team-task-progress"><i style={{ width: completed / Math.max(1, total) * 100 + '%' }} /></div><div className="team-task-grid">{team.members.map(member => <article key={member.id}><h3>{member.pokemonName}</h3>{tasks(member).map(task => <label key={task.key} className={done(member, task.key) ? 'done' : ''}><input type="checkbox" aria-label={member.pokemonName + task.label + '培养完成'} disabled={!team.personal || !activeIds.has(member.id)} checked={done(member, task.key)} onChange={event => toggle(member.id, task.key, event.target.checked)} /><span><b>{task.label}</b><small>{task.detail}</small></span></label>)}</article>)}</div></div>}
  </section>;
}
