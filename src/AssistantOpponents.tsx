import { useEffect, useState } from 'react';
import type { OpponentBuild, OpponentCondition, StrategyList, StrategyReferences, StrategySet, UserState } from './types';
import { StateControls } from './AssistantScenario';
const message = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
export function OpponentImport({ generation, remaining, append }: { generation: number; remaining: number; append: (values: OpponentCondition[]) => void }) {
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const parse = async () => {
    setBusy(true); setError('');
    try {
      const values = await window.pokedex.team<{ pokemonId: number; build: OpponentBuild }[]>('assistant-opponent-import', { generation, text });
      if (values.length > remaining) throw new Error('对手路线总数最多 6 条，请先移除部分路线。');
      append(values.map(value => ({ ...value, id: crypto.randomUUID(), reference: 'manual', minAttack: 1, minResist: 0, minFaster: 0 })));
      setText('');
    } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  };
  return <details className="assistant-opponent-import"><summary>粘贴导入对手配招</summary><p className="assistant-help">支持 Showdown／中文配招和 JSON，可一次导入多条路线。须注明性格、特性与努力值；省略个体值按 Showdown 导出惯例为 31。仅用于本次条件，不会添加到我的培养。</p><textarea aria-label="对手配招导入文本" rows={7} value={text} onChange={event => setText(event.target.value)} placeholder={'Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw'} /><button className="secondary-button" disabled={busy || !remaining || !text.trim()} onClick={() => void parse()}>{busy ? '正在解析…' : '加入对手路线'}</button>{error && <p role="alert" className="build-errors">{error}</p>}</details>;
}
export function OpponentEditor({ value, index, generation, refs, user, disabled, update, duplicate, remove }: {
  value: OpponentCondition; index: number; generation: number; refs: StrategyReferences | null; user: UserState; disabled: boolean;
  update: (changes: Partial<OpponentCondition>) => void; duplicate?: () => void; remove: () => void;
}) {
  const [sourceGen, setSourceGen] = useState(generation), [options, setOptions] = useState<StrategySet[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const prefix = '对手' + value.pokemonId + (index ? '路线' + (index + 1) : '');
  useEffect(() => {
    if (value.reference !== 'manual' || disabled) return;
    let live = true; setLoading(true); setError('');
    void window.pokedex.strategy<StrategyList>('list', { pokemonId: value.pokemonId, generation: sourceGen }).then(result => {
      if (live) { setOptions(result.sets); setError(result.error || ''); }
    }).catch(failure => { if (live) setError(message(failure)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [value.pokemonId, value.reference, sourceGen, disabled]);
  const own = [...user.plans, ...user.teams.flatMap(team => team.members)].filter(set => set.pokemonId === value.pokemonId);
  const choices = [...options, ...own];
  const display = (kind: 'moves' | 'abilities' | 'items' | 'natures', name: string) => refs?.[kind].find(value => value.english === name)?.name || name || '无';
  function select(set: StrategySet) {
    if (set.missingFields?.length || set.generation >= 3 && (!set.personal && !set.evsSpecified || !set.selection.nature)) { setError('来源缺少完整培养数值，请补充后导入。'); return; }
    update({ reference: 'manual', build: { title: set.title, generation: set.referenceGeneration || set.generation, source: set.source.provider,
      showdownSpecies: set.showdownSpecies, selection: structuredClone(set.selection) } });
  }
  return <div className="assistant-opponent-condition"><h3>{refs?.pokemon.find(entry => entry.id === value.pokemonId)?.name || value.pokemonId} <small>#{value.pokemonId} · 路线 {index + 1}</small></h3><div className="assistant-form-grid">
    <label>对手参考配招<select aria-label={prefix + '参考配招'} value={value.reference} onChange={event => update({ reference: event.target.value as OpponentCondition['reference'] })}><option value="fastest">当前资料内常态速度最高</option><option value="source">优先较新世代完整来源</option><option value="manual">手动指定完整配招</option></select></label>
    {([['minAttack', '克制打点'], ['minResist', '全部攻击抗性'], ['minFaster', '战况先手']] as const).map(([key, title]) => <label key={key}>至少几位具备{title}<select aria-label={prefix + title + '人数'} value={value[key]} onChange={event => update({ [key]: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count ? count + ' 位' : '不限'}</option>)}</select></label>)}
  </div>{value.reference === 'manual' && <div className="assistant-manual-reference"><div className="assistant-form-grid"><label>配招来源世代<select aria-label={prefix + '配招来源世代'} value={sourceGen} onChange={event => setSourceGen(Number(event.target.value))}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>第 {i + 1} 世代</option>)}</select></label>
    <label>选择具体配招<select aria-label={prefix + '选择具体配招'} value="" disabled={loading} onChange={event => { if (event.target.value) select(choices[Number(event.target.value)]); }}><option value="">{loading ? '正在加载来源…' : '选择来源路线或已保存方案'}</option>{choices.map((set, i) => <option key={i} value={i} disabled={Boolean(set.missingFields?.length || set.generation >= 3 && (!set.personal && (!set.evsSpecified || !set.natureOptions.length)))}>{set.title} · {set.formatLabel} · {set.personal ? '我的培养' : set.source.provider}</option>)}</select></label></div>
    {value.build ? <div className="assistant-help"><strong>已指定：{value.build.title}</strong><p>{display('abilities', value.build.selection.ability)} · {display('natures', value.build.selection.nature)} · {display('items', value.build.selection.item)}</p><p>{value.build.selection.moves.map(move => display('moves', move)).join(' / ')}</p><p>努力值 {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map(stat => value.build!.selection.evs[stat]).join(' / ')} · 个体值 {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map(stat => value.build!.selection.ivs[stat]).join(' / ')}</p></div> : <p className="assistant-help">请选择完整配招，或移除此路线后使用粘贴导入。</p>}{error && <p className="assistant-help" role="alert">{error}</p>}</div>}
    <details><summary>这条对手路线的状态</summary><StateControls prefix={prefix} generation={generation} value={value.state} update={state => update({ state })} opponent /></details>
    <div className="assistant-result-tools">{duplicate && <button className="secondary-button" onClick={duplicate}>添加另一条路线</button>}<button className="secondary-button" aria-label={prefix + '移除路线'} onClick={remove}>移除这条路线</button></div>
  </div>;
}
