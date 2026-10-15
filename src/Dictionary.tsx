import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, FlaskConical, LoaderCircle, Pin, Search, Sparkles, Swords, X } from 'lucide-react';
import type { Bootstrap, Entity, EntityDetail, EntityKind, ItemScope, UserState } from './types';
import { EmptyState, PokemonImage, Reference, TypeChip } from './components';

export function EntityCard({ detail, data, user, onPokemon }: { detail: EntityDetail; data: Bootstrap; user: UserState; onPokemon: (id: number) => void }) {
  const icon = detail.kind === 'moves' ? <Swords size={25} /> : detail.kind === 'abilities' ? <Sparkles size={25} /> : <FlaskConical size={25} />;
  return <div className="entity-detail"><div className="entity-hero"><div className={`entity-symbol ${detail.kind}`}>{detail.image ? <img src={detail.image} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : icon}</div><span className="eyebrow">{({ moves: '招式资料', abilities: '特性资料', items: '道具资料' })[detail.kind]}</span><h1>{detail.name}</h1><p className="english-name">{detail.identifier.replace(/-/g, ' ')}</p>{detail.type && <TypeChip id={detail.type} types={data.types} />}</div>
    <div className="entity-body"><div className="entity-description"><p>{detail.text}</p><Reference version={detail.referenceVersion} /></div>
      {detail.kind === 'moves' && <><div className="entity-metrics"><div><span>类别</span><strong>{detail.className}</strong></div><div><span>威力</span><strong>{detail.power ?? '—'}</strong></div><div><span>命中</span><strong>{detail.accuracy ? `${detail.accuracy}%` : '—'}</strong></div><div><span>PP</span><strong>{detail.pp ?? '—'}</strong></div><div><span>优先度</span><strong>{(detail.priority || 0) > 0 ? '+' : ''}{detail.priority || 0}</strong></div></div>
        {detail.meta && <div className="move-extra">{detail.meta.drain !== 0 && <p>{detail.meta.drain > 0 ? '吸收伤害回复 HP' : '造成反作用力伤害'}：{Math.abs(detail.meta.drain)}%</p>}{detail.meta.healing > 0 && <p>回复最大 HP 的 {detail.meta.healing}%</p>}{detail.meta.min_hits && detail.meta.min_hits > 1 && <p>连续命中 {detail.meta.min_hits}{detail.meta.max_hits !== detail.meta.min_hits ? `～${detail.meta.max_hits}` : ''} 次</p>}{detail.meta.flinch_chance > 0 && <p>畏缩概率：{detail.meta.flinch_chance}%</p>}</div>}</>}
      {detail.kind === 'items' && <div className="entity-metrics"><div><span>分类</span><strong>{detail.categoryName}</strong></div><div><span>资料中的价格</span><strong>{detail.cost ?? '—'}</strong></div></div>}
      {detail.learners && <section className="learners"><div className="section-heading"><h2>{detail.kind === 'moves' ? '能够学习的宝可梦' : '拥有此特性的宝可梦'}</h2><span className="small-label">最多展示 36 只</span></div>{detail.learnsetReference && <div className="notice">学习记录参考：{detail.learnsetReference}</div>}{detail.learners.length ? <div className="learner-grid">{detail.learners.map(pokemon => <button key={pokemon.id} onClick={() => onPokemon(pokemon.id)}><PokemonImage pokemon={pokemon} settings={user.settings} thumbnail /><span>{pokemon.name}</span>{pokemon.formName && <small>{pokemon.formName}</small>}<ArrowUpRight size={12} /></button>)}</div> : <p className="muted">当前版本没有收录对应记录。</p>}</section>}
    </div></div>;
}

export function EntityModal({ selection, data, user, onClose, onPokemon, onPin, pinning = false }: { selection: { kind: EntityKind; id: number }; data: Bootstrap; user: UserState; onClose: () => void; onPokemon: (id: number) => void; onPin?: () => void; pinning?: boolean }) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setDetail(null); setError(''); window.pokedex.query<EntityDetail>('entity', { ...selection, versionId: user.settings.versionId }).then(value => { if (live) setDetail(value); }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, [selection.kind, selection.id, user.settings.versionId]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener); }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><div className="entity-modal" role="dialog" aria-modal="true" aria-label="资料详情" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" aria-label="关闭资料详情" onClick={onClose} autoFocus><X size={20} /></button>{onPin && <button className="mini-modal-pin secondary-button" disabled={!detail || pinning} onClick={onPin}><Pin size={14} />固定为标签</button>}{detail ? <EntityCard detail={detail} data={data} user={user} onPokemon={onPokemon} /> : error ? <EmptyState title="查询失败" description={error} /> : <div className="modal-loading"><LoaderCircle className="spin" /></div>}</div></div>;
}

export default function Dictionary({ kind, data, user, onPokemon, onError }: { kind: EntityKind; data: Bootstrap; user: UserState; onPokemon: (id: number) => void; onError: (message: string) => void }) {
  const [entries, setEntries] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState(0);
  const [damageClass, setDamageClass] = useState(0);
  const [loading, setLoading] = useState(true);
  const [compactDetail, setCompactDetail] = useState(false);
  const [itemScope, setItemScope] = useState<ItemScope | null>(null);
  const version = data.versions.find(v => v.id === user.settings.versionId)!;
  const labels = { moves: ['招式图鉴', '了解每个招式的用途与学习方式'], abilities: ['特性图鉴', '了解特性效果，找到适合的宝可梦'], items: ['道具图鉴', '查询道具用途，准备下一段冒险'] };
  useEffect(() => {
    let live = true; setLoading(true); setCompactDetail(false); setQuery(''); setType(0); setDamageClass(0); setDetail(null); setItemScope(null);
    Promise.all([window.pokedex.query<Entity[]>('entities', { kind, versionId: version.id }), kind === 'items' ? window.pokedex.query<ItemScope>('itemScope', { versionId: version.id }) : Promise.resolve(null)]).then(([values, scope]) => {
      if (live) { setEntries(values); setItemScope(scope); setSelected(values[0]?.id ?? null); setLoading(false); }
    }).catch(err => { if (live) { onError(err.message); setLoading(false); } });
    return () => { live = false; };
  }, [kind, version.id]);
  useEffect(() => {
    let live = true;
    if (selected !== null) window.pokedex.query<EntityDetail>('entity', { kind, id: selected, versionId: version.id }).then(value => { if (live) setDetail(value); }).catch(err => { if (live) onError(err.message); });
    return () => { live = false; };
  }, [selected, kind, version.id]);
  const normalized = query.toLowerCase().replace(/[\s\-]/g, '');
  const filtered = entries.filter(entry => (!normalized || entry.searchKey.includes(normalized) || String(entry.id) === normalized) && (!type || entry.type === type) && (!damageClass || entry.damageClass === damageClass));
  return <div className={compactDetail ? "dictionary-page compact-detail" : "dictionary-page"}><div className="page-heading"><div><span className="eyebrow">冒险资料库</span><h1>{labels[kind][0]}<span className="count-pill">{entries.length.toLocaleString()} 项资料</span></h1><p>{labels[kind][1]}</p></div><div className="version-picker"><span>资料规则版本</span><select aria-label={labels[kind][0] + '资料版本'} value={version.id} onChange={event => void window.pokedex.user('settings', { versionId: Number(event.target.value) }).catch(error => onError(error.message))}>{data.versions.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div></div>
    {itemScope && <p className="dictionary-scope-note">{itemScope.notice}</p>}
    <div className="dictionary-layout"><section className="dictionary-list-panel"><div className="dictionary-search"><Search size={17} /><input aria-label={`搜索${labels[kind][0]}`} placeholder="名称、拼音或编号…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
      {kind === 'moves' && <div className="dictionary-filters"><select aria-label="招式图鉴属性筛选" value={type} onChange={event => setType(Number(event.target.value))}><option value={0}>全部属性</option>{data.types.filter(t => t.generation <= version.generation).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="招式类别筛选" value={damageClass} onChange={event => setDamageClass(Number(event.target.value))}><option value={0}>全部类别</option><option value={2}>物理</option><option value={3}>特殊</option><option value={1}>变化</option></select></div>}
      <div className="list-caption">{filtered.length} 项符合条件</div><div className="dictionary-rows">{loading ? <div className="modal-loading"><LoaderCircle className="spin" /></div> : filtered.length ? filtered.map(entry => <button className={`dictionary-row ${entry.id === selected ? 'active' : ''}`} key={entry.id} onClick={() => { setSelected(entry.id); setCompactDetail(true); }}><span className="row-number">{String(entry.id).padStart(3, '0')}</span><span><strong>{entry.name}</strong><small>{entry.identifier.replace(/-/g, ' ')}</small></span>{entry.type && <TypeChip id={entry.type} types={data.types} small />}<ChevronRight size={14} /></button>) : <EmptyState title="没有找到对应资料" description="试试其他名称或筛选条件。" />}</div>
    </section><section className="dictionary-detail-panel"><button className="compact-back" onClick={() => setCompactDetail(false)}><ChevronLeft size={17} />返回资料列表</button>{detail ? <EntityCard detail={detail} data={data} user={user} onPokemon={onPokemon} /> : <EmptyState title="选择一项资料" />}</section></div>
  </div>;
}
