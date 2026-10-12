import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, FileText, Heart, LoaderCircle, Sparkles, Star } from 'lucide-react';
import type { Bootstrap, EntityKind, Move, Pokemon, PokemonDetail, UserState } from './types';
import { EmptyState, PokemonImage, Reference, SectionTitle, TYPE_COLORS, TypeChip } from './components';
import StrategyPanel from './StrategyPanel';

export function MatchupGrid({ entries, types, compact = false }: { entries: PokemonDetail['matchup']; types: Bootstrap['types']; compact?: boolean }) {
  const groups = [
    { title: '弱点', description: '受到更多伤害', values: entries.filter(e => e.multiplier > 1), className: 'weak' },
    { title: '抗性', description: '受到更少伤害', values: entries.filter(e => e.multiplier > 0 && e.multiplier < 1), className: 'resist' },
    { title: '免疫', description: '属性伤害为零', values: entries.filter(e => e.multiplier === 0), className: 'immune' },
  ];
  return <div className={`matchup-groups ${compact ? 'compact' : ''}`}>
    {groups.map(group => <div className={`matchup-group ${group.className}`} key={group.title}>
      <div className="matchup-label"><strong>{group.title}</strong>{!compact && <span>{group.description}</span>}</div>
      <div className="matchup-values">{group.values.length ? group.values.map(entry => <span className="multiplier-chip" key={entry.id}>
        <TypeChip id={entry.id} types={types} small /><b>×{entry.multiplier}</b>
      </span>) : <span className="muted">无</span>}</div>
    </div>)}
  </div>;
}

function Notes({ id, initial, save }: { id: number; initial: string; save: (id: number, text: string) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState('已保存');
  const draft = useRef(initial);
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (draft.current !== lastSaved.current) void saveRef.current(id, draft.current);
  }, [id]);
  const update = (value: string) => {
    setText(value); draft.current = value; setStatus('正在保存…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await saveRef.current(id, value); lastSaved.current = value; setStatus('已保存'); }
      catch { setStatus('保存失败，请重试'); }
    }, 450);
  };
  return <section className="note-section"><SectionTitle title="我的笔记" right={<span className="save-status"><Check size={12} />{status}</span>} />
    <textarea aria-label="宝可梦笔记" value={text} onChange={event => update(event.target.value)} maxLength={5000} placeholder="记下培养思路、配招或游戏里的发现…" />
    <span className="note-count">{text.length} / 5000 · 自动保存在本机</span>
  </section>;
}

export default function PokemonPanel({ detail, loading, data, user, onSelect, onFavorite, onEntity, onNote, mini = false }: {
  detail: PokemonDetail | null; loading: boolean; data: Bootstrap; user: UserState;
  onSelect: (id: number) => void; onFavorite: (id: number) => void;
  onEntity: (kind: EntityKind, id: number) => void; onNote: (id: number, text: string) => Promise<void>; mini?: boolean;
}) {
  const [tab, setTab] = useState('overview');
  const [method, setMethod] = useState(0);
  const [moveQuery, setMoveQuery] = useState('');
  const [moveType, setMoveType] = useState(0);
  const tabsRef = useRef<HTMLElement>(null);
  const changeTab = (value: string) => { setTab(value); if (value === 'strategy') requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ block: 'start' })); };
  useEffect(() => { setMethod(0); setMoveQuery(''); setMoveType(0); }, [detail?.id, detail?.version.id]);
  if (!detail) return <div className="detail-empty">{loading ? <LoaderCircle className="spin" size={28} /> : <EmptyState title="选择一只宝可梦" description="从左侧列表开始，探索它的资料。" />}</div>;
  const favorite = user.favorites.includes(detail.id);
  const attack = detail.stats.find(stat => stat.id === 2)?.value || 0;
  const special = detail.stats.find(stat => stat.id === 4 || stat.id === 9)?.value || 0;
  const maxStat = Math.max(...detail.stats.map(stat => stat.value));
  const methods = [...new Set(detail.learnset.map(move => move.methodId!))].sort((a, b) => a - b);
  const displayedMoves = detail.learnset.filter(move => (!method || move.methodId === method) && (!moveType || move.type === moveType) && (!moveQuery || `${move.name}${move.identifier}`.toLowerCase().includes(moveQuery.toLowerCase())));
  return <article className={`pokemon-panel ${mini ? 'mini-panel' : ''} ${loading ? 'is-loading' : ''}`} style={{ '--pokemon-color': TYPE_COLORS[detail.types[0]] } as React.CSSProperties}>
    <div className="detail-hero">
      <div className="hero-topline"><span className="eyebrow">全国图鉴 <b>#{String(detail.speciesId).padStart(4, '0')}</b></span><button className={`favorite-button ${favorite ? 'selected' : ''}`} onClick={() => onFavorite(detail.id)} aria-label={favorite ? '取消收藏当前宝可梦' : '收藏当前宝可梦'}><Star size={16} fill={favorite ? 'currentColor' : 'none'} />{favorite ? '已收藏' : '收藏'}</button></div>
      <div className="hero-content"><div className="hero-info">
        <div className="hero-tags">{detail.isLegendary && <span><Sparkles size={11} />传说</span>}{detail.isMythical && <span><Sparkles size={11} />幻之宝可梦</span>}<span>第 {detail.generation} 世代</span></div>
        <h1>{detail.name}</h1><p className="english-name">{detail.englishName}</p>
        <div className="hero-types">{detail.types.map(id => <TypeChip key={id} id={id} types={data.types} />)}</div>
        {detail.forms.length > 1 && <select aria-label="宝可梦形态" className="form-select" value={detail.id} onChange={event => onSelect(Number(event.target.value))}>{detail.forms.map(form => <option value={form.id} key={form.id}>{form.formName || '普通形态'}</option>)}</select>}
        <p className="genus">{detail.genus}</p>
      </div><div className="hero-art"><div className="art-orbit" /><PokemonImage pokemon={detail} settings={user.settings} versionGeneration={detail.version.generation} /></div></div>
      <div className="hero-metrics"><div><span>身高</span><strong>{detail.height.toFixed(1)} <small>m</small></strong></div><div><span>体重</span><strong>{detail.weight.toFixed(1)} <small>kg</small></strong></div><div><span>种族值总和</span><strong>{detail.total}</strong></div></div>
    </div>
    <nav ref={tabsRef} className="detail-tabs" aria-label="宝可梦资料分类">{[{ id: 'overview', label: '基础资料', icon: BookOpen }, { id: 'evolution', label: '进化链', icon: Sparkles }, { id: 'moves', label: '招式学习', icon: FileText }, { id: 'strategy', label: '配招培育', icon: Star }].map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)}><item.icon size={15} />{item.label}{item.id === 'moves' && <span>{detail.learnset.length}</span>}</button>)}</nav>
    <div className="detail-body">
      {tab === 'overview' && <>
        <section><SectionTitle title="属性弱点与抗性" right={<span className="small-label">防御倍率</span>} /><MatchupGrid entries={detail.matchup} types={data.types} compact={mini} /><p className="section-footnote">按属性计算；特性、招式及战斗状态可能改变实际伤害。</p></section>
        <section><SectionTitle title="特性" />{detail.abilities.length ? <div className="ability-list">{detail.abilities.map(ability => <button className="ability-card" key={ability.id} onClick={() => onEntity('abilities', ability.id)}><span className="ability-mark"><Sparkles size={16} /></span><span><strong>{ability.name}</strong><small>{ability.hidden ? '隐藏特性' : '普通特性'}</small></span><ChevronRight size={15} /></button>)}</div> : <p className="muted">这个规则世代尚未引入特性。</p>}</section>
        <section><SectionTitle title="种族值" right={<span className="stat-total">总和 <b>{detail.total}</b></span>} /><div className="stat-chart">{detail.stats.map(stat => <div className="stat-line" key={stat.id}><span>{stat.name}</span><b>{stat.value}</b><div className="stat-track"><span style={{ width: `${Math.min(100, stat.value / 255 * 100)}%` }} className={stat.value === maxStat ? 'highlight' : ''} /></div>{stat.effort > 0 && <small title="击败该宝可梦获得的努力值">+{stat.effort} EV</small>}</div>)}</div><p className="stat-hint">{attack > special ? '攻击种族值较高，可以优先参考物理招式。' : special > attack ? '特攻种族值较高，可以优先参考特殊招式。' : '攻击与特攻种族值相同，可结合特性和招式选择方向。'}</p></section>
        {!mini && <section><SectionTitle title="培养资料" /><div className="breeding-grid"><div><span>蛋群</span><strong>{detail.eggGroups.join(' / ') || '未知'}</strong></div><div><span>捕获率</span><strong>{detail.captureRate} <small>/ 255</small></strong></div><div><span>性别比例</span><strong>{detail.genderRate === -1 ? '无性别' : `♂ ${(8 - detail.genderRate) * 12.5}% / ♀ ${detail.genderRate * 12.5}%`}</strong></div><div><span>基础亲密度</span><strong>{detail.happiness}</strong></div><div><span>孵化周期</span><strong>{detail.hatchCounter}</strong></div><div><span>努力值收益</span><strong>{detail.stats.filter(stat => stat.effort).map(stat => `${stat.name} +${stat.effort}`).join(' / ') || '无'}</strong></div></div></section>}
        <section className="flavor-card"><span className="quote-mark">“</span><p>{detail.text}</p><Reference version={detail.referenceVersion} /></section>
        {!mini && <Notes key={detail.id} id={detail.id} initial={user.notes[detail.id] || ''} save={onNote} />}
      </>}
      {tab === 'evolution' && <section className="evolution-section"><SectionTitle eyebrow="成长的旅程" title="进化链与条件" />
        {!detail.evolution.edges.length ? <EmptyState title="当前规则下没有可显示的进化" description="这只宝可梦可能没有进化，或后续进化在更晚的世代引入。" /> : <>
          <div className="evolution-roots">{detail.evolution.roots.map(root => <button className={`evolution-pokemon ${root.id === detail.id ? 'current' : ''}`} key={root.id} onClick={() => onSelect(root.id)}><PokemonImage pokemon={root} settings={user.settings} /><span>#{String(root.speciesId).padStart(4, '0')}</span><strong>{root.name}</strong></button>)}</div>
          <div className="evolution-edges">{detail.evolution.edges.map((edge, index) => <div className="evolution-edge" key={`${edge.to}:${index}`}><div className="evolution-source"><span>{detail.evolution.roots.find(p => p.speciesId === edge.from)?.name || detail.evolution.edges.find(e => e.pokemon.speciesId === edge.from)?.pokemon.name}</span><ArrowRight size={16} /></div><button className={`evolution-pokemon ${edge.to === detail.id ? 'current' : ''}`} onClick={() => onSelect(edge.to)}><PokemonImage pokemon={edge.pokemon} settings={user.settings} /><span>#{String(edge.pokemon.speciesId).padStart(4, '0')}</span><strong>{edge.pokemon.name}</strong>{edge.pokemon.formName && <small>{edge.pokemon.formName}</small>}</button><div className="evolution-condition">{edge.conditions.map((condition, i) => <p key={condition}>{i > 0 && <span className="or-label">或</span>}{condition}</p>)}<Reference version={edge.referenceVersion} /></div></div>)}</div>
        </>}
      </section>}
      {tab === 'moves' && <section><SectionTitle title="招式学习表" right={<span className="small-label">{detail.learnset.length} 条记录</span>} />
        {detail.learnsetReference && <div className="notice">学习表参考：{detail.learnsetReference}。所选资料未单列该扩展版本的学习表。</div>}
        <div className="move-filters"><input aria-label="筛选学习招式" value={moveQuery} onChange={event => setMoveQuery(event.target.value)} placeholder="搜索招式…" /><select aria-label="筛选招式属性" value={moveType} onChange={event => setMoveType(Number(event.target.value))}><option value={0}>全部属性</option>{data.types.filter(t => t.generation <= detail.version.generation).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div>
        <div className="method-tabs"><button className={!method ? 'active' : ''} onClick={() => setMethod(0)}>全部</button>{methods.map(id => <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}>{data.methods[id]}</button>)}</div>
        {displayedMoves.length ? <div className="move-table-wrap"><table className="move-table"><thead><tr><th>方式</th><th>招式</th><th>属性</th><th>类别</th><th>威力</th><th>命中</th><th>PP</th></tr></thead><tbody>{displayedMoves.map((move: Move, index) => <tr key={`${move.id}:${move.methodId}:${move.level}:${index}`} onClick={() => onEntity('moves', move.id)}><td>{move.methodId === 1 ? `Lv. ${move.level}` : move.methodId === 4 && move.machineNumber !== null ? `${detail.version.generation <= 6 && (move.machineNumber || 0) > 100 ? 'HM' : 'TM'}${String(detail.version.generation <= 6 && (move.machineNumber || 0) > 100 ? (move.machineNumber || 0) - 100 : move.machineNumber).padStart(2, '0')}` : move.method}</td><td><button className="text-button">{move.name}</button></td><td><TypeChip id={move.type} types={data.types} small /></td><td><span className={`damage-class class-${move.damageClass}`}>{move.className}</span></td><td>{move.power ?? '—'}</td><td>{move.accuracy ? `${move.accuracy}%` : '—'}</td><td>{move.pp ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState title={detail.learnset.length ? '没有符合筛选的招式' : '当前资料没有这只宝可梦的学习表'} description={detail.learnset.length ? '试试其他名称、属性或学习方式。' : '可以切换到其他官方版本查看已收录的学习方式。'} />}
      </section>}
      {tab === 'strategy' && <StrategyPanel key={detail.id} pokemon={detail} data={data} user={user} onEntity={onEntity} />}
      <div className="detail-footer"><Heart size={12} /><span>本地资料 · {detail.version.name}</span></div>
    </div>
  </article>;
}
