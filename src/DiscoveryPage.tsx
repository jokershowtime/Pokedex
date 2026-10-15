import { useEffect, useMemo, useRef, useState } from 'react';
import { GitCompareArrows, LoaderCircle, Search } from 'lucide-react';
import type { Bootstrap, DiscoveryConditions, DiscoveryResult, Entity, EntityKind, UserState } from './types';
import { EmptyState, PokemonImage, TypeChip } from './components';
import ReferencePicker from './ReferencePicker';
import { LearningNotice, learningMethod } from './LearningInfo';
export const dexError = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
const initial = (): DiscoveryConditions => ({ query: '', types: [], abilityId: 0, abilityScope: 'any', moves: [], showForms: false, stats: {}, total: {} });
export default function DiscoveryPage({ data, user, compared, onCompare, onPokemon, onEntity }: {
  data: Bootstrap; user: UserState; compared: number[]; onCompare: (id: number) => void; onPokemon: (id: number) => void; onEntity: (kind: EntityKind, id: number) => void;
}) {
  const version = data.versions.find(value => value.id === user.settings.versionId)!;
  const [conditions, setConditions] = useState(initial), [moves, setMoves] = useState<Entity[]>([]), [abilities, setAbilities] = useState<Entity[]>([]);
  const [result, setResult] = useState<DiscoveryResult | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const sequence = useRef(0), resultNode = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([window.pokedex.query<Entity[]>('entities', { kind: 'moves', versionId: version.id }),
      window.pokedex.query<Entity[]>('entities', { kind: 'abilities', versionId: version.id })]).then(([moves, abilities]) => {
      if (live) { setMoves(moves); setAbilities(abilities); setLoading(false); }
    }).catch(failure => { if (live) { setError(dexError(failure)); setLoading(false); } });
    return () => { live = false; sequence.current++; };
  }, [version.id]);
  const types = data.types.filter(type => type.generation <= version.generation);
  const stats = useMemo(() => version.generation === 1 ? [[1, 'HP'], [2, '攻击'], [3, '防御'], [9, '特殊'], [6, '速度']] as const : [[1, 'HP'], [2, '攻击'], [3, '防御'], [4, '特攻'], [5, '特防'], [6, '速度']] as const, [version.generation]);
  function update(patch: Partial<DiscoveryConditions>) { sequence.current++; setBusy(false); setConditions(old => ({ ...old, ...patch })); setResult(null); setError(''); }
  async function query(page = 0) {
    const current = ++sequence.current; setBusy(true); setError('');
    try {
      const value = await window.pokedex.query<DiscoveryResult>('discover', { ...conditions, versionId: version.id, page });
      if (sequence.current === current) { setResult(value); requestAnimationFrame(() => {
        const node = resultNode.current, parent = node?.closest('.discovery-page');
        if (node && parent) parent.scrollTo({ top: parent.scrollTop + node.getBoundingClientRect().top - parent.getBoundingClientRect().top, behavior: 'instant' });
      }); }
    } catch (failure) { if (sequence.current === current) { setError(dexError(failure)); setResult(null); } }
    finally { if (sequence.current === current) setBusy(false); }
  }
  function range(key: string, label: string) {
    const selected = key === 'total' ? conditions.total : conditions.stats[key] || {};
    const change = (name: 'min' | 'max', value: string) => {
      const next = { ...selected, [name]: value === '' ? undefined : Number(value) };
      update(key === 'total' ? { total: next } : { stats: { ...conditions.stats, [key]: next } });
    };
    return <div className="dex-stat-range" key={key}><strong>{label}</strong><input aria-label={label + '种族值下限'} type="number" min={0} max={key === 'total' ? 2000 : 999} placeholder="不限" value={selected.min ?? ''} onChange={event => change('min', event.target.value)} /><span>～</span><input aria-label={label + '种族值上限'} type="number" min={0} max={key === 'total' ? 2000 : 999} placeholder="不限" value={selected.max ?? ''} onChange={event => change('max', event.target.value)} /></div>;
  }
  return <div className="utility-page dex-tools-page discovery-page"><div className="page-heading"><div><span className="eyebrow">按需求找伙伴</span><h1>组合条件反查</h1><p>组合属性、特性、种族值和招式条件，查找有记录支持的宝可梦。</p></div><div className="version-picker"><span>资料版本</span><select aria-label="反查资料版本" value={version.id} onChange={event => void window.pokedex.user('settings', { versionId: Number(event.target.value) }).catch(failure => setError(dexError(failure)))}>{data.versions.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div></div>
    <fieldset className="dex-query-conditions" disabled={loading}><section className="dex-tool-card"><h2>属性与特性</h2><div className="dex-filter-grid"><label>名称或编号<input aria-label="反查宝可梦名称" maxLength={100} value={conditions.query} onChange={event => update({ query: event.target.value })} placeholder="可留空，支持拼音" /></label>
      {[0, 1].map(index => <label key={index}>{index ? '还需具备的属性' : '需要的属性'}<select aria-label={index ? '反查属性二' : '反查属性一'} value={conditions.types[index] || 0} onChange={event => {
        const next = [...conditions.types]; next[index] = Number(event.target.value); update({ types: [...new Set(next.filter(Boolean))] });
      }}><option value={0}>不限</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>)}
      {version.generation >= 3 && <label>特性范围<select aria-label="反查特性范围" value={conditions.abilityScope} onChange={event => update({ abilityScope: event.target.value as DiscoveryConditions['abilityScope'] })}><option value="any">普通与隐藏均可</option><option value="normal">仅普通特性记录</option><option value="hidden">仅隐藏特性记录</option></select></label>}</div>
      {version.generation >= 3 && <ReferencePicker label="需要的特性" entries={abilities} selected={conditions.abilityId ? [conditions.abilityId] : []} limit={1} update={values => update({ abilityId: values[0] || 0 })} />}
      <label className="dex-check"><input type="checkbox" checked={conditions.showForms} onChange={event => update({ showForms: event.target.checked })} />包含其他形态</label><p className="dex-help">选两个属性时必须同时具备；特性条件按当前资料世代的普通／隐藏特性记录匹配。图鉴记录不等于该游戏可以捕获。</p>
    </section><section className="dex-tool-card"><h2>种族值范围</h2><div className="dex-stat-ranges">{range('total', '总和')}{stats.map(([id, label]) => range(String(id), label))}</div></section>
      <section className="dex-tool-card"><h2>必须同时有学习记录的招式</h2><ReferencePicker label="反查招式" entries={moves} selected={conditions.moves} limit={4} update={values => update({ moves: values })} /><p className="dex-help">最多四个招式，结果会列出各招式的学习方式。条件只使用本地记录。</p></section></fieldset>
    <div className="dex-query-actions"><button className="secondary-button" onClick={() => { sequence.current++; setBusy(false); setConditions(initial()); setResult(null); setError(''); }}>重置反查条件</button><button className="primary-button" disabled={busy || loading} onClick={() => void query()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}查询符合条件的宝可梦</button></div>
    {error && <div className="build-errors" role="alert">{error}</div>}
    {result && <section className="discovery-results" ref={resultNode} aria-label="组合反查结果"><h2>{result.learning.status === 'missing' && conditions.moves.length ? '学习资料不足，暂时无法完成招式反查' : '找到 ' + result.total + ' 只有匹配记录的宝可梦'}</h2>
      {conditions.moves.length > 0 && <LearningNotice source={result.learning} unknown={result.unknown} />}
      {result.results.length ? <div className="discovery-result-grid">{result.results.map(({ pokemon, moves }) => <article className="dex-tool-card discovery-result" key={pokemon.id}><div className="discovery-pokemon"><PokemonImage pokemon={pokemon} settings={user.settings} thumbnail /><div><h3>{pokemon.name}{pokemon.formName && ' · ' + pokemon.formName}</h3><span>#{pokemon.speciesId} · 种族值总和 {pokemon.total}</span><div>{pokemon.types.map(id => <TypeChip key={id} id={id} types={types} small />)}</div></div></div>
        <p className="dex-help">{pokemon.stats.map(stat => stat.name + ' ' + stat.value).join(' / ')}</p><p>{pokemon.abilities.map(ability => ability.name + (ability.hidden ? '（隐藏）' : '')).join(' / ') || '当前世代没有特性机制'}</p>
        {moves.map(move => <div className="discovery-learning" key={move.id}><button onClick={() => onEntity('moves', move.id)}>{move.name}</button><span>{move.methods.map(method => learningMethod(method, version.generation)).join(' / ')}</span></div>)}
        <div className="dex-card-actions"><button className="secondary-button" onClick={() => onPokemon(pokemon.id)}>查看{pokemon.name}图鉴</button><button className="secondary-button" aria-pressed={compared.includes(pokemon.id)} onClick={() => onCompare(pokemon.id)}><GitCompareArrows size={15} />{compared.includes(pokemon.id) ? '移出对比' : '加入对比'}</button></div>
      </article>)}</div> : <EmptyState title={result.learning.status === 'missing' && conditions.moves.length ? '当前缺少可用的学习记录' : '没有找到已确认匹配的宝可梦'} description="可以调整条件或资料版本后再查询。" />}
      {result.total > result.size && <div className="dex-pagination"><button className="secondary-button" disabled={busy || result.page === 0} onClick={() => void query(result.page - 1)}>上一页</button><span>第 {result.page + 1} / {Math.ceil(result.total / result.size)} 页 · 共 {result.total} 只</span><button className="secondary-button" disabled={busy || (result.page + 1) * result.size >= result.total} onClick={() => void query(result.page + 1)}>下一页</button></div>}
    </section>}
  </div>;
}
