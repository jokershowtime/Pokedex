import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, LoaderCircle, LockKeyhole, Play, Save, Search, SlidersHorizontal, Square, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import type { AssistantMetadata, AssistantRun, Bootstrap, EntityKind, OpponentCondition, Pokemon, StrategyReferences, TeamConditions, TypeInfo, UserState } from './types';
import { PokemonImage, TypeChip } from './components';
import { StrategyCard } from './StrategyCards';
import TeamAnalytics from './TeamAnalytics';
import AssistantComparison from './AssistantComparison';
import AssistantPresets from './AssistantPresets';
import { AssistantConflicts, AssistantLivePreview } from './AssistantFeedback';
import { OpponentChecks, OpponentReferences, TeamPlaybookView } from './AssistantStrategy';
import ScenarioControls, { defaultScenario } from './AssistantScenario';
import { OpponentEditor, OpponentImport } from './AssistantOpponents';
import AssistantDamage from './AssistantDamage';
import type { BattleSeed } from './BattlePage';
import './assistant.css';

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
const normalize = (text: string) => text.toLowerCase().replace(/[\s·・\-_'’./#]/g, '');
type Option = { value: string; label: string; search: string };
const option = (value: string, label: string): Option => ({ value, label,
  search: normalize(label + ' ' + value + ' ' + pinyin(label, { toneType: 'none' }) + ' ' + pinyin(label, { pattern: 'first', toneType: 'none' })) });
const initial = (generation: number): TeamConditions => ({
  format: 'all', scopeGeneration: generation, category: 'singles', level: 50, resultCount: 20, minDifference: 2, requiredIds: [], excludedIds: [],
  targetTypes: [], attackTypes: [], resistTypes: [], immuneTypes: [], memberTypes: [], excludedTypes: [],
  roles: [], requiredMoves: [], style: 'any', preference: 'balanced', minCoverage: 0, maxWeak: 3, maxSameType: 6,
  fastCount: 0, fastSpeed: 150, slowCount: 0, slowSpeed: 80,
  excludeLegendary: false, excludeMythical: false, noFourfold: false, uniqueItems: false,
  roleCounts: {}, opponents: [], scenario: defaultScenario(),
});
function PickMany({ label, options, selected, limit, change }: {
  label: string; options: Option[]; selected: string[]; limit: number; change: (values: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = options.filter(value => !selected.includes(value.value) && value.search.includes(normalize(query))).slice(0, 80);
  return <div className="assistant-pick"><strong>{label}<small>{selected.length}/{limit}</small></strong>
    <div className="assistant-pick-input"><Search size={16} /><input aria-label={'搜索' + label} value={query} onChange={event => setQuery(event.target.value)} placeholder="中文、拼音或编号…" />
      <select aria-label={'添加' + label} value="" disabled={selected.length >= limit} onChange={event => {
        if (event.target.value) { change([...selected, event.target.value]); setQuery(''); }
      }}><option value="">选择条件</option>{filtered.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></div>
    <div className="assistant-selected">{selected.map(value => <button key={value} onClick={() => change(selected.filter(id => id !== value))} aria-label={'移除' + label + '条件' + (options.find(option => option.value === value)?.label || value)}>
      {options.find(option => option.value === value)?.label || value}<X size={14} /></button>)}{!selected.length && <span>不限</span>}</div>
  </div>;
}
function TypeChoices({ label, types, selected, change }: { label: string; types: TypeInfo[]; selected: number[]; change: (ids: number[]) => void }) {
  return <div className="assistant-type-choice"><strong>{label}</strong><div>{types.map(type => <label key={type.id}>
    <input type="checkbox" aria-label={label + '·' + type.name} checked={selected.includes(type.id)} onChange={() =>
      change(selected.includes(type.id) ? selected.filter(id => id !== type.id) : [...selected, type.id])} /><TypeChip id={type.id} types={types} small />
  </label>)}</div></div>;
}
export default function TeamAssistantPage({ data, user, catalog, onCultivate, onBattle, onPokemon, onEntity }: {
  data: Bootstrap; user: UserState; catalog: Pokemon[]; onCultivate: (id: string) => void; onBattle: (seed: BattleSeed) => void;
  onPokemon: (id: number) => void; onEntity: (kind: EntityKind, id: number) => void;
}) {
  const [conditions, setConditions] = useState<TeamConditions>(() => initial(0));
  const [metadata, setMetadata] = useState<AssistantMetadata | null>(null), [refs, setRefs] = useState<StrategyReferences | null>(null);
  const [allPokemon, setAllPokemon] = useState(catalog), [run, setRun] = useState<AssistantRun | null>(null);
  const [error, setError] = useState(''), [starting, setStarting] = useState(false), [saving, setSaving] = useState(false), [selected, setSelected] = useState(0);
  const [locked, setLocked] = useState<number[]>([]), [compared, setCompared] = useState<number[]>([]);
  const live = useRef(true), epoch = useRef(0);
  const pageNode = useRef<HTMLDivElement>(null);
  const statusNode = useRef<HTMLDivElement>(null), resultNode = useRef<HTMLElement>(null);
  const previewNode = useRef<HTMLDivElement>(null);
  const generation = Number(conditions.format.match(/^gen([1-9])/)?.[1] || conditions.scopeGeneration || 9);
  const inspecting = Boolean(run?.inspection && ['running', 'cancelling'].includes(run.inspection.state));
  const busy = starting || run?.state === 'running' || run?.state === 'cancelling' || inspecting;
  const types = data.types.filter(type => type.generation <= generation);
  const pokemon = useMemo(() => new Map(allPokemon.map(pokemon => [pokemon.id, pokemon])), [allPokemon]);
  const pokemonOptions = useMemo(() => (refs?.pokemon || []).filter(value => !conditions.scopeGeneration || (value.generation || 0) <= generation)
    .map(value => option(String(value.id), value.name + ' · ' + value.english)), [refs, generation, conditions.scopeGeneration]);
  const moveOptions = useMemo(() => (refs?.moves || []).filter(value => (value.generation || 0) <= generation)
    .map(value => option(value.english, value.name + ' · ' + value.english)), [refs, generation]);
  useEffect(() => {
    live.current = true;
    void Promise.all([
      window.pokedex.team<AssistantMetadata>('assistant-metadata'),
      window.pokedex.strategy<StrategyReferences>('references'),
      window.pokedex.query<Pokemon[]>('catalog', { versionId: 27 }),
      window.pokedex.team<AssistantRun | null>('assistant-status'),
    ]).then(([metadata, refs, pokemon, task]) => {
      if (live.current) {
        setMetadata(metadata); setRefs(refs); setAllPokemon(pokemon);
        if (task) { setRun(task); setConditions({ ...initial(task.constraints.scopeGeneration), ...task.constraints }); setLocked(task.lockedPokemonIds || []); setSelected(task.inspection?.index || 0); }
      }
    }).catch(failure => { if (live.current) setError(errorText(failure)); });
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (!run || !['running', 'cancelling'].includes(run.state) && !inspecting) return;
    let running = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const sequence = epoch.current;
      try {
        const value = await window.pokedex.team<AssistantRun>('assistant-status', { runId: run.runId });
        if (!running || sequence !== epoch.current) return;
        setRun(value);
        if (['running', 'cancelling'].includes(value.state) || value.inspection && ['running', 'cancelling'].includes(value.inspection.state)) timer = setTimeout(() => void poll(), 300);
      } catch (failure) {
        if (running && sequence === epoch.current) { setError(errorText(failure)); setRun(old => old ? { ...old, state: 'error' } : old); }
      }
    };
    void poll();
    return () => { running = false; clearTimeout(timer); };
  }, [run?.runId, run?.state, inspecting]);
  useEffect(() => {
    if (!run) return;
    const node = run.state === 'complete' && run.results.length ? resultNode.current : statusNode.current;
    const page = pageNode.current;
    if (node && page) page.scrollTo({ top: page.scrollTop + node.getBoundingClientRect().top - page.getBoundingClientRect().top, behavior: 'instant' });
  }, [run?.runId, run?.state]);
  function change<K extends keyof TeamConditions>(name: K, value: TeamConditions[K]) {
    if (busy) return;
    setConditions(old => ({ ...old, [name]: value })); setRun(null); setError(''); setSelected(0); setLocked([]); setCompared([]);
  }
  const changeScope = (scopeGeneration: number, format = 'all') => {
    if (busy) return;
    const gen = scopeGeneration || 9;
    const validTypes = data.types.filter(type => type.generation <= gen).map(type => type.id);
    setConditions(old => ({ ...old, scopeGeneration, format,
      category: format !== 'all' ? metadata?.formats.find(rule => rule.id === format)?.category === 'doubles' ? 'doubles' : 'singles' :
        gen < 3 ? 'singles' : old.category, level: format.endsWith('lc') ? 5 : old.level === 5 ? 50 : old.level,
      requiredIds: old.requiredIds.filter(id => (refs?.pokemon.find(p => p.id === id)?.generation || 0) <= gen),
      excludedIds: old.excludedIds.filter(id => (refs?.pokemon.find(p => p.id === id)?.generation || 0) <= gen),
      opponents: (old.opponents || []).filter(value => (refs?.pokemon.find(p => p.id === value.pokemonId)?.generation || 0) <= gen).map(value => ({ ...value,
        state: { ...value.state, tailwind: gen >= 4 && value.state?.tailwind, auroraVeil: gen >= 7 && value.state?.auroraVeil, teraActive: gen === 9 && value.state?.teraActive, abilityOn: gen >= 3 && value.state?.abilityOn } })),
      scenario: defaultScenario(),
      requiredMoves: old.requiredMoves.filter(name => (refs?.moves.find(move => move.english === name)?.generation || 0) <= gen),
      ...Object.fromEntries(['targetTypes', 'attackTypes', 'resistTypes', 'immuneTypes', 'memberTypes', 'excludedTypes']
        .map(key => [key, (old[key as 'targetTypes']).filter(id => validTypes.includes(id))])),
      minCoverage: Math.min(old.minCoverage, validTypes.length),
    })); setRun(null); setError(''); setSelected(0); setLocked([]); setCompared([]);
  };
  const calculate = async (rebuild = false) => {
    if (busy) return;
    const source = rebuild && run ? { runId: run.runId, index: selected,
      memberIds: run.results[selected].team.members.filter(member => locked.includes(member.pokemonId)).map(member => member.id) } : undefined;
    epoch.current++;
    setStarting(true); setError(''); setRun(null); setSelected(0); setCompared([]);
    try {
      const value = await window.pokedex.team<AssistantRun>('assistant-start', { ...conditions, rebuild: source });
      if (live.current) { setRun(value); setLocked(value.lockedPokemonIds || []); }
    } catch (failure) { if (live.current) setError(errorText(failure)); }
    finally { if (live.current) setStarting(false); }
  };
  const stop = async () => {
    if (!run) return;
    epoch.current++;
    setRun(old => old ? inspecting ? { ...old, inspection: { ...old.inspection!, state: 'cancelling' } } : { ...old, state: 'cancelling', message: '正在取消计算…' } : old);
    try { const value = await window.pokedex.team<AssistantRun>('assistant-cancel', { runId: run.runId }); if (live.current) setRun(value); }
    catch (failure) { setError(errorText(failure)); }
  };
  const save = async () => {
    if (!run) return; setSaving(true); setError('');
    try {
      const result = await window.pokedex.team<{ teamId: string }>('assistant-save', { runId: run.runId, index: selected });
      onCultivate(result.teamId);
    } catch (failure) { setError(errorText(failure)); } finally { setSaving(false); }
  };
  const inspect = async () => {
    if (!run || busy) return;
    setStarting(true); setError('');
    try { const value = await window.pokedex.team<AssistantRun>('assistant-inspect', { runId: run.runId, index: selected }); if (live.current) setRun(value); }
    catch (failure) { if (live.current) setError(errorText(failure)); }
    finally { if (live.current) setStarting(false); }
  };
  const result = run?.results[selected];
  const roleCount = (id: string) => Math.max(conditions.roleCounts?.[id] || 0, conditions.roles.includes(id) ? 1 : 0);
  const changeRole = (id: string, count: number) => {
    if (busy) return;
    setConditions(old => ({ ...old, roleCounts: { ...old.roleCounts, [id]: count }, roles: count ? [...new Set([...old.roles, id])] : old.roles.filter(value => value !== id) }));
    setRun(null); setError(''); setSelected(0); setLocked([]); setCompared([]);
  };
  const updateOpponent = (index: number, values: Partial<OpponentCondition>) => change('opponents', conditions.opponents.map((value, slot) => slot === index ? { ...value, ...values } : value));
  const viewResult = (index: number) => { setSelected(index); setLocked(run?.lockedPokemonIds || []); };
  const toggleCompare = () => setCompared(old => old.includes(selected) ? old.filter(index => index !== selected) : old.length < 3 ? [...old, selected] : old);
  const selectNumber = (label: string, key: keyof TeamConditions, values: number[], suffix = '') => <label>{label}<select aria-label={label} value={Number(conditions[key])}
    onChange={event => change(key, Number(event.target.value) as never)}>{values.map(value => <option key={value} value={value}>{value === 0 && ['minCoverage', 'fastCount', 'slowCount'].includes(key) ? '不限' : value + suffix}</option>)}</select></label>;
  return <div className="utility-page assistant-page" ref={pageNode}>
    <div className="page-heading"><div><span className="eyebrow">填写条件，计算六人队伍</span><h1><SlidersHorizontal size={25} />阵容助手</h1><p>自动整理完整配招，再组合符合要求的六个不同物种。无需提前选择方案范围。</p></div></div>
    <AssistantPresets presets={user.assistantPresets || []} conditions={conditions} disabled={Boolean(busy || saving)} apply={value => {
      if (busy) return; setConditions({ ...initial(value.scopeGeneration), ...value }); setRun(null); setError(''); setSelected(0); setLocked([]); setCompared([]);
    }} />
    <fieldset className="assistant-conditions" disabled={busy || saving || !metadata}>
      <section className="assistant-section"><h2>玩法与计算</h2><div className="assistant-form-grid">
        <label>资料世代<select aria-label="助手世代" value={conditions.scopeGeneration} onChange={event => changeScope(Number(event.target.value))}><option value={0}>全部世代（无限制）</option>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>第 {i + 1} 世代</option>)}</select></label>
        <label>来源规则<select aria-label="助手参考规则" value={conditions.format} onChange={event => changeScope(event.target.value === 'all' ? conditions.scopeGeneration : Number(event.target.value.match(/^gen([1-9])/)?.[1]), event.target.value)}><option value="all">不限规则（自由组队）</option>{metadata?.formats.filter(value => !conditions.scopeGeneration || value.generation === conditions.scopeGeneration).map(value => <option key={value.id} value={value.id}>第 {value.generation} 世代 · {value.label}</option>)}</select></label>
        <label>玩法<select aria-label="助手玩法" value={conditions.category} onChange={event => {
          changeScope(conditions.scopeGeneration); change('category', event.target.value as 'singles' | 'doubles');
        }}><option value="singles">单打</option><option value="doubles" disabled={generation < 3}>双打</option></select></label>
        {selectNumber('计算等级', 'level', [5, 50, 100], ' 级')}
        {selectNumber('返回队伍数量', 'resultCount', [5, 10, 20, 30, 50], ' 队')}
        {selectNumber('队伍至少几位成员不同', 'minDifference', [1, 2, 3], ' 位')}
        <label>结果排序<select aria-label="助手结果排序" value={conditions.preference} onChange={event => change('preference', event.target.value)}><option value="balanced">综合队伍结构（推荐）</option><option value="coverage">优先扩大打击面</option><option value="defense">优先抗性与减少共同弱点</option><option value="types">优先属性多样性</option></select></label>
        <label>队伍体系<select aria-label="助手队伍体系" value={conditions.style} onChange={event => change('style', event.target.value)}>{metadata?.styles.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
      </div><p className="assistant-help">{conditions.scopeGeneration ? '使用所选资料世代的战斗机制。' : '所有宝可梦均可选择；跨世代配置统一按第九世代计算。'} 不限规则时可组合不同来源规则的配置；没有完整配招的宝可梦会在计算时说明。{metadata?.styles.find(style => style.id === conditions.style)?.note}</p><p className="assistant-help">成员差异按物种计算；差异要求越高、必带成员越多，可返回的队伍可能越少。综合排序计入功能分工、速度层次、主动回复和预设体系联动，分数用于本次结果比较。</p></section>
      <section className="assistant-section"><h2>成员要求</h2><div className="assistant-pick-grid">
        <PickMany label="必带宝可梦" options={pokemonOptions} selected={conditions.requiredIds.map(String)} limit={6} change={values => change('requiredIds', values.map(Number))} />
        <PickMany label="禁用宝可梦" options={pokemonOptions} selected={conditions.excludedIds.map(String)} limit={100} change={values => change('excludedIds', values.map(Number))} />
      </div><p className="assistant-help">必带按所选形态匹配；禁用包含同物种的其他形态。</p><div className="assistant-check-row">{[
        ['excludeLegendary', '排除传说宝可梦'], ['excludeMythical', '排除幻之宝可梦'], ['uniqueItems', '携带道具不重复'],
      ].map(([key, label]) => <label key={key}><input type="checkbox" aria-label={label} checked={Boolean(conditions[key as keyof TeamConditions])} onChange={event => change(key as keyof TeamConditions, event.target.checked as never)} />{label}</label>)}</div>
      <details><summary>成员属性条件</summary><TypeChoices label="必须有对应属性成员" types={types} selected={conditions.memberTypes} change={ids => change('memberTypes', ids)} />
        <TypeChoices label="排除对应属性成员" types={types} selected={conditions.excludedTypes} change={ids => change('excludedTypes', ids)} /></details></section>
      <section className="assistant-section"><h2>攻击打击面</h2><p className="assistant-help">“克制目标”要求至少有一个攻击招式对该单属性目标达到效果拔群；“攻击属性”要求实际携带对应属性的攻击招式。</p>
        <TypeChoices label="必须克制的目标属性" types={types} selected={conditions.targetTypes} change={ids => change('targetTypes', ids)} />
        <TypeChoices label="必须携带的攻击属性" types={types} selected={conditions.attackTypes} change={ids => change('attackTypes', ids)} />
        <div className="assistant-form-grid">{selectNumber('至少克制几种属性', 'minCoverage', Array.from({ length: types.length + 1 }, (_, i) => i), ' 种')}</div>
      </section>
      <section className="assistant-section"><h2>防御与共同弱点</h2><div className="assistant-form-grid">
        {selectNumber('每种属性最多几位弱点成员', 'maxWeak', [0, 1, 2, 3, 4, 5, 6], ' 位')}
        {selectNumber('同属性成员最多几位', 'maxSameType', [1, 2, 3, 4, 5, 6], ' 位')}
      </div><div className="assistant-check-row"><label><input type="checkbox" aria-label="排除四倍及以上弱点配置" checked={conditions.noFourfold} onChange={event => change('noFourfold', event.target.checked)} />排除四倍及以上弱点配置</label></div>
        <details><summary>指定抗性与免疫</summary><TypeChoices label="必须有人抵抗或免疫" types={types} selected={conditions.resistTypes} change={ids => change('resistTypes', ids)} />
          <TypeChoices label="必须有人免疫" types={types} selected={conditions.immuneTypes} change={ids => change('immuneTypes', ids)} /></details></section>
      <section className="assistant-section"><h2>功能与招式</h2><div className="assistant-check-row">{metadata?.roles.map(role => <div className="assistant-role-count" key={role.id}><label>
        <input type="checkbox" aria-label={'必须具备' + role.label} checked={roleCount(role.id) > 0} onChange={event => changeRole(role.id, event.target.checked ? Math.max(1, roleCount(role.id)) : 0)} />{role.label}</label>
        {roleCount(role.id) > 0 && <label>至少<select aria-label={'至少几位具备' + role.label} value={roleCount(role.id)} onChange={event => changeRole(role.id, Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}</select>位</label>}</div>)}</div>
        <p className="assistant-help">勾选后可设置最低人数，同一成员可兼任多个职责。物理／特殊攻击按实际招式类别识别；其他功能按对应招式识别，不能据此判断输出强度。</p>
        <PickMany label="必备招式" options={moveOptions} selected={conditions.requiredMoves} limit={12} change={values => change('requiredMoves', values)} /></section>
      <ScenarioControls value={conditions.scenario} generation={generation} update={value => change('scenario', value)} />
      <section className="assistant-section"><h2>指定对手组队</h2><PickMany label="需要应对的宝可梦" options={pokemonOptions} selected={[...new Set(conditions.opponents.map(value => String(value.pokemonId)))]} limit={conditions.opponents.length >= 6 ? 0 : 6} change={values => change('opponents', values.flatMap(value => {
        const existing = conditions.opponents.filter(opponent => opponent.pokemonId === Number(value));
        return existing.length ? existing : [{ id: crypto.randomUUID(), pokemonId: Number(value), reference: 'fastest' as const, minAttack: 1, minResist: 0, minFaster: 0 }];
      }))} />
        <p className="assistant-help">最多指定 6 条对手路线，同一宝可梦可添加多种配招。自动参考从当前范围取完整配置；手动路线可选择来源或导入。每条至少设置一项人数要求，分别计数，同一成员可兼任。</p>
        <OpponentImport generation={generation} remaining={6 - conditions.opponents.length} append={values => change('opponents', [...conditions.opponents, ...values])} />
        {conditions.opponents.map((opponent, index) => <OpponentEditor key={opponent.id || 'opponent-' + opponent.pokemonId} value={opponent} index={index} generation={generation} refs={refs} user={user} disabled={Boolean(busy)} update={changes => updateOpponent(index, changes)} remove={() => change('opponents', conditions.opponents.filter((_, slot) => slot !== index))}
          duplicate={conditions.opponents.length < 6 ? () => change('opponents', [...conditions.opponents, { ...structuredClone(opponent), id: crypto.randomUUID(), reference: 'manual' }]) : undefined} />)}
      </section>
      <section className="assistant-section"><h2>速度条件</h2><div className="assistant-form-grid">
        {selectNumber('至少几位高速成员', 'fastCount', [0, 1, 2, 3, 4, 5, 6], ' 位')}
        <label>高速门槛<input aria-label="高速门槛" type="number" min={1} max={999} value={conditions.fastSpeed} onChange={event => change('fastSpeed', Number(event.target.value))} /></label>
        {selectNumber('至少几位低速成员', 'slowCount', [0, 1, 2, 3, 4, 5, 6], ' 位')}
        <label>低速门槛<input aria-label="低速门槛" type="number" min={1} max={999} value={conditions.slowSpeed} onChange={event => change('slowSpeed', Number(event.target.value))} /></label>
      </div><p className="assistant-help">按所选等级计算常态速度，计入性格、个体值、努力值与固定道具修正，天气提速、顺风和能力变化未启用。</p></section>
    </fieldset>
    <div className="assistant-actions"><span><Clock3 size={17} />无搜索时限 · 全应用同时运行一个计算</span>
      {busy ? <button key="cancel" className="secondary-button" disabled={starting || run?.state === 'cancelling'} onClick={() => void stop()}><Square size={15} />取消计算</button> :
        <button key="reset" className="secondary-button" disabled={saving} onClick={() => { setConditions(initial(0)); setRun(null); setError(''); setLocked([]); setCompared([]); }}>重置条件</button>}
      <button className="primary-button" disabled={busy || saving || !metadata || !refs} onClick={() => void calculate()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}计算队伍</button></div>
    {error && <div className="build-errors" role="alert">{error}</div>}
    {run && <div ref={statusNode} className={'assistant-status ' + run.state} data-run-id={run.runId} role="status">{run.state === 'running' && <LoaderCircle size={17} className="spin" />}<strong>{run.message}</strong><span>已用时 {(run.elapsedMs / 1000).toFixed(1)} 秒</span>
      {run.state === 'running' && Boolean(run.previews?.length) && <button className="secondary-button" onClick={() => {
        const node = previewNode.current, page = pageNode.current;
        if (node && page) page.scrollTo({ top: page.scrollTop + node.getBoundingClientRect().top - page.getBoundingClientRect().top, behavior: 'smooth' });
      }}>查看已找到的队伍</button>}
      {['running', 'cancelling'].includes(run.state) && <button className="secondary-button assistant-progress-cancel" aria-label="取消当前计算" disabled={run.state === 'cancelling'} onClick={() => void stop()}><Square size={15} />取消计算</button>}
      <div className="assistant-progress"><progress aria-label="阵容计算进度" value={run.percent} max={100} /><strong>{run.percent > 0 && run.percent < 0.01 ? '<0.01%' : run.percent.toFixed(2) + '%'}</strong>
        <span>{run.stage && <strong>{run.stage} · </strong>}{run.phase === 'data' ? '资料' : run.phase === 'preparing' ? '配置' : run.phase === 'matchups' ? '对手比较' : run.strategy === 'guided' ? '本阶段任务' : '组合'}已处理 {BigInt(run.processed).toLocaleString('zh-CN')} / {BigInt(run.total).toLocaleString('zh-CN')}</span>
        {['searching', 'improving', 'finished'].includes(run.phase) && <small>已检查 {run.examined.toLocaleString('zh-CN')} 个分支 · 已找到 {run.found} / {run.constraints.resultCount} 队。{run.strategy === 'checks' ? '已定位到条件或资料限制，未展开组合搜索。' : run.strategy === 'guided' ? '按条件组队并定向替换成员，进度对应当前阶段实际任务。' : '小范围使用精确搜索；整批剪枝排除的组合计入已处理。'}</small>}
      </div>
      {run.state === 'complete' && <small>资料 {(Number(run.dataMs) / 1000).toFixed(1)} 秒 · 预计算 {(Number(run.prepareMs) / 1000).toFixed(1)} 秒{run.cacheHit && '（已复用缓存）'} · 搜索 {(Number(run.searchMs) / 1000).toFixed(1)} 秒</small>}</div>}
    {Boolean(run?.issues?.length) ? <AssistantConflicts issues={run!.issues} adjust={() => pageNode.current?.scrollTo({ top: 0, behavior: 'smooth' })} /> : Boolean(run?.diagnostics.length) && <div className="assistant-diagnostics">{run!.diagnostics.map(message => <p key={message}>{message}</p>)}</div>}
    {run?.state === 'running' && <div ref={previewNode}><AssistantLivePreview previews={run.previews || []} pokemon={pokemon} refs={refs} user={user} cancel={() => void stop()} /></div>}
    {Boolean(run?.warnings.length) && <details className="team-skipped"><summary>资料与计算说明</summary>{run!.warnings.map(message => <p key={message}>{message}</p>)}</details>}
    <OpponentReferences opponents={run?.opponents || []} scenario={run?.constraints.scenario} />
    {result && run && <section ref={resultNode} className="assistant-results"><h2>符合条件的队伍 <span className="count-pill">{run.results.length} 队</span></h2>
      <p className="assistant-help">本次最多返回 {run.constraints.resultCount} 队，已找到 {run.results.length} 队；任意两队至少有 {run.constraints.minDifference} 位成员物种不同，同一组合保留得分更高的配置。{run.results.length < run.constraints.resultCount && '当前找到的不同组合少于所选数量，可以尝试放宽条件或降低差异要求。'}{run.strategy === 'guided' ? '大范围搜索优先生成可用队伍，结果不保证全局排名或找齐所有可行组合。' : '本次配置范围较小，已完整搜索并按评分依次挑选符合差异要求的队伍。'}</p>
      <div className="assistant-result-tabs">{run.results.map((value, index) => <button className={selected === index ? 'active' : ''} key={value.team.id} onClick={() => viewResult(index)} aria-label={'查看计算队伍' + (index + 1)}>
        队伍 {index + 1}{compared.includes(index) && ' · 已选对比'}<span>{value.assessment.score} 分 · 打击面 {value.metrics.coverage} · 最大共同弱点 {value.metrics.maxWeak}</span></button>)}</div>
      <div className="assistant-result-tools"><button className="secondary-button" aria-pressed={compared.includes(selected)} disabled={!compared.includes(selected) && compared.length >= 3} onClick={toggleCompare}>{compared.includes(selected) ? '移出对比' : '加入对比'}（{compared.length}/3）</button><span>选择 2–3 队后显示并排对比</span>{compared.length > 0 && <button className="secondary-button" onClick={() => setCompared([])}>清空对比</button>}</div>
      <AssistantComparison results={run.results} selected={compared} types={data.types} opponents={run.opponents || []} remove={index => setCompared(old => old.filter(value => value !== index))} view={viewResult} />
      <div className="assistant-roster">{result.team.members.map(member => {
        const entry = pokemon.get(member.pokemonId);
        return <div className="assistant-roster-slot" key={member.id}><button onClick={() => onPokemon(member.pokemonId)} title="查看宝可梦图鉴">{entry && <PokemonImage pokemon={entry} settings={user.settings} thumbnail />}<strong>{member.pokemonName || entry?.name}</strong></button><button className={'assistant-member-lock ' + (locked.includes(member.pokemonId) ? 'locked' : '')} aria-label={'锁定成员' + member.pokemonName} aria-pressed={locked.includes(member.pokemonId)} disabled={busy || saving} onClick={() => setLocked(old => old.includes(member.pokemonId) ? old.filter(id => id !== member.pokemonId) : [...old, member.pokemonId])}><LockKeyhole size={14} />{locked.includes(member.pokemonId) ? '已锁定配置' : '锁定配置'}</button></div>;
      })}</div>
      <div className="assistant-result-tools"><button className="secondary-button" aria-label="保留锁定成员重新计算" disabled={busy || saving || !locked.length || locked.length >= 6} onClick={() => void calculate(true)}>保留 {locked.length} 位，重算其余位置</button><span>保留所选成员的全部配招与培养数值，沿用当前条件。{locked.length >= 6 && '请至少留一个位置用于调整。'}</span>{locked.length > 0 && <button className="secondary-button" onClick={() => setLocked([])}>解除全部锁定</button>}</div>
      <div className="assistant-result-heading"><div><h3>{result.team.title}</h3><p>克制 {result.metrics.coverage} 种单属性目标 · 抵抗／免疫 {result.metrics.resistances} 种属性 · 成员覆盖 {result.metrics.distinctTypes} 种属性</p></div>
        <button className="primary-button" disabled={saving || busy} onClick={() => void save()}><Save size={16} />保存到我的培养</button></div>
      <details className="assistant-score" open><summary>排序依据 · {result.assessment.score} 分</summary><div className="assistant-score-parts">{result.assessment.components.map(part => <span key={part.label}>{part.label}<strong>{part.points > 0 ? '+' : ''}{part.points}</strong></span>)}</div><p>物理攻击 {result.assessment.physical} 位 · 特殊攻击 {result.assessment.special} 位 · 常态速度 {result.assessment.speeds.map(entry => entry.value).join(' / ')}</p><p>体系联动：{result.assessment.synergies.join('、') || '未识别到预设联动组合'}</p>{result.assessment.warnings.map(text => <p key={text}>{text}</p>)}<small>按招式类别与已识别功能统计，一位成员可承担多个功能；分数不代表输出强度或实战胜率。</small></details>
      <details className="assistant-checks" open><summary>逐项条件核对</summary><ul>{result.checks.map((check, index) => <li key={index}><Check size={16} /><div><strong>{check.label}</strong>
        <span>{check.members.length ? check.members.join('、') : '当前值 ' + check.count}{check.required !== undefined && ' · 已满足 ' + check.count + '/' + check.required}{check.maximum !== undefined && ' · 当前最大值 ' + check.count}</span></div></li>)}</ul></details>
      <OpponentChecks opponents={run.opponents || []} rows={result.opponentMatchups || []} refs={refs} />
      <section className="assistant-section" aria-label="战况速度对照"><h3>常态与战况速度</h3><p className="assistant-help">{run.constraints.scenario.field.trickRoom ? '已启用空间，同优先度通常慢者先动。' : '按通常速度顺序比较同优先度。'} 对手的天气无效特性等配对影响见应对核对表。</p><div className="assistant-playbook-roles">{(result.scenarioSpeeds || []).map(member => <div key={member.pokemonId}><strong>{member.name}</strong><span>{member.normal} → {member.current}</span></div>)}</div></section>
      <AssistantDamage key={result.team.id} team={result.team} opponents={run.opponents || []} inspection={run.inspection?.index === selected ? run.inspection : undefined} busy={Boolean(busy)} calculate={() => void inspect()} cancel={() => void stop()} />
      <TeamPlaybookView plan={result.plan} />
      <details className="team-analysis-disclosure"><summary>队伍体检与能力实数</summary><TeamAnalytics team={result.team} user={user} onBattle={onBattle} /></details>
      <div className="team-member-grid">{result.team.members.map(member => <div className="team-member-build" key={member.id}><StrategyCard source={member} refs={refs || undefined}
        onSave={async () => {}} onEdit={() => {}} onEntity={onEntity} notify={setError} /></div>)}</div>
    </section>}
    <p className="assistant-help assistant-footnote">配招来自公开资料和已保存的完整配置，后台自动整理；初次获取需要联网，已有资料可离线计算。通用打击面与抗性表按常态统计，指定对手的条件与伤害检查使用选定战况。参考规则用于匹配原始配招，具体赛事禁限名单与特殊条款仍需核对。</p>
  </div>;
}
