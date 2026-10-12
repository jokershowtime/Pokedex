import { useEffect, useState } from 'react';
import { BookOpenCheck, CloudDownload, Database, Download, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import type { Bootstrap, EntityKind, Pokemon, StrategyList, StrategyReferences, StrategySet, UserState } from './types';
import { EmptyState } from './components';
import { emptySet, ImportStrategies, StrategyCard, StrategyEditor } from './StrategyCards';
import { planTeam, removalMessage } from './cultivation-model';

let referencePromise: Promise<StrategyReferences> | null = null;
function references() { return referencePromise ||= window.pokedex.strategy<StrategyReferences>('references'); }
const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');

export default function StrategyPanel({ pokemon, data, user, onEntity }: { pokemon: Pokemon; data: Bootstrap; user: UserState; onEntity: (kind: EntityKind, id: number) => void }) {
  const currentGen = data.versions.find(version => version.id === user.settings.versionId)!.generation;
  const [generation, setGeneration] = useState(currentGen);
  const [response, setResponse] = useState<StrategyList | null>(null);
  const [personal, setPersonal] = useState<StrategySet[]>([]);
  const [refs, setRefs] = useState<StrategyReferences | null>(null);
  const [format, setFormat] = useState('all');
  const [mode, setMode] = useState('all');
  const [view, setView] = useState('source');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<StrategySet | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const notify = (text: string) => setMessage(text);
  useEffect(() => { references().then(setRefs).catch(error => notify(errorText(error))); }, []);
  useEffect(() => { setGeneration(currentGen); setFormat('all'); setView('source'); }, [pokemon.id, currentGen]);
  useEffect(() => {
    let live = true; setResponse(null); setLoading(true); setFormat('all');
    window.pokedex.strategy<StrategyList>('list', { pokemonId: pokemon.id, generation, refresh: refreshRequested }).then(value => { if (live) { setResponse(value); setLoading(false); setRefreshRequested(false); } }).catch(error => { if (live) { notify(errorText(error)); setLoading(false); } });
    return () => { live = false; };
  }, [pokemon.id, generation, currentGen, user.settings.versionId, refreshCount]);
  useEffect(() => {
    let live = true;
    window.pokedex.strategy<StrategySet[]>('personal', { pokemonId: pokemon.id }).then(values => { if (live) setPersonal(values); }).catch(error => notify(errorText(error)));
    return () => { live = false; };
  }, [pokemon.id, user.plans, user.settings.versionId]);
  const save = async (set: StrategySet) => { await window.pokedex.strategy('save', { set }); };
  const remove = async (id: string) => {
    const plan = user.plans.find(value => value.id === id);
    await window.pokedex.strategy('delete', { id });
    if (plan) notify(removalMessage(plan, user));
  };
  const progress = async (id: string, key: string, value: boolean) => { await window.pokedex.strategy('progress', { id, key, value }); };
  const sets = (view === 'personal' ? personal : response?.sets || []).filter(set => (format === 'all' || set.format === format) && (mode === 'all' || set.category === mode));
  const create = () => {
    if (!refs) return;
    const set = emptySet(pokemon, refs); set.generation = Math.max(generation, refs.pokemon.find(value => value.id === pokemon.id)?.generation || 1); setEditing(set);
  };
  return <section className="strategy-panel"><div className="strategy-panel-heading"><div><span className="eyebrow">选一条适合的培养路线</span><h2>配招与培育</h2></div><button className="secondary-button" onClick={() => setImporting(true)}><Download size={14} />导入作业</button></div>
    <div className="strategy-toolbar"><label>来源世代<select aria-label="配招来源世代" value={generation} onChange={event => setGeneration(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => <option value={index + 1} key={index}>第 {index + 1} 世代</option>)}</select></label><button className="secondary-button" disabled={loading} onClick={() => { setRefreshRequested(true); setRefreshCount(value => value + 1); }}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? '获取中…' : '联网更新'}</button><button className="secondary-button" disabled={!refs} onClick={create}><Plus size={14} />自建方案</button></div>
    <div className="strategy-view-tabs"><button className={view === 'source' ? 'active' : ''} onClick={() => { setView('source'); setFormat('all'); }}><CloudDownload size={15} />来源方案 {response?.sets.length || 0}</button><button className={view === 'personal' ? 'active' : ''} onClick={() => { setView('personal'); setFormat('all'); }}><BookOpenCheck size={15} />我的方案 {personal.length}</button></div>
    <div className="strategy-filters"><select aria-label="配招玩法筛选" value={mode} onChange={event => setMode(event.target.value)}><option value="all">全部玩法</option><option value="singles">单打</option><option value="doubles">双打</option>{view === 'personal' && <><option value="pve">通关实用</option><option value="custom">自定义／导入</option></>}</select>{view === 'source' && <select aria-label="配招规则筛选" value={format} onChange={event => setFormat(event.target.value)}><option value="all">全部规则</option>{response?.formats.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select>}</div>
    {response?.cache.available && <p className="strategy-cache"><Database size={13} />第 {generation} 世代已缓存 {response.cache.totalSets.toLocaleString()} 套方案 · {new Date(response.cache.fetchedAt!).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
    {response?.error && <div className="notice" role="status">{response.error}</div>}
    {message && <div className="strategy-message" role="status">{message}<button onClick={() => setMessage('')}>关闭</button></div>}
    {loading && view === 'source' ? <div className="strategy-loading"><LoaderCircle className="spin" /><p>正在获取当前世代的来源方案…</p><span>首次需要联网，之后可以使用本地缓存。</span></div> : sets.length ? <div className="strategy-card-list">{sets.map(set => <StrategyCard key={set.id} source={set} refs={refs || undefined} saved={user.plans.some(plan => plan.originId === set.id)} onSave={save} onEdit={setEditing} onDelete={remove} onProgress={progress} onEntity={onEntity} notify={notify} deleteContext={planTeam(set, user) ? '移除成员培养计划后，队伍收藏、配置快照和笔记仍保留。可在“我的培养”的整队视图中重新加入或取消收藏。' : undefined} />)}</div> : <EmptyState title={view === 'personal' ? '还没有这只宝可梦的个人方案' : '当前筛选没有收录的来源方案'} description={view === 'personal' ? '保存一套来源作业，或者导入、创建自己的路线。' : '可以切换世代和规则，或导入、自建方案。'} action={<button className="secondary-button" disabled={!refs} onClick={create}><Plus size={14} />创建自己的配招</button>} />}
    <p className="section-footnote">来源：Smogon，通过社区整理接口同步。来源方案与个人培养计划分开保存，更新不会覆盖自己的修改。</p>
    {editing && refs && <StrategyEditor initial={editing} refs={refs} onClose={() => setEditing(null)} onSave={save} notify={notify} />}
    {importing && <ImportStrategies generation={generation} onClose={() => setImporting(false)} notify={notify} />}
  </section>;
}

export function PersonalStrategies({ data, user, catalog, onEntity, onPokemon, onTeam }: {
  data: Bootstrap; user: UserState; catalog: Pokemon[]; onEntity: (kind: EntityKind, id: number) => void;
  onPokemon: (id: number) => void; onTeam?: (id: string) => void;
}) {
  const [sets, setSets] = useState<StrategySet[]>([]), [refs, setRefs] = useState<StrategyReferences | null>(null);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [generation, setGeneration] = useState(0);
  const [scope, setScope] = useState('all');
  const [editing, setEditing] = useState<StrategySet | null>(null), [importing, setImporting] = useState(false), [message, setMessage] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => { references().then(setRefs).catch(error => setMessage(errorText(error))); }, []);
  useEffect(() => {
    let live = true;
    window.pokedex.strategy<StrategySet[]>('personal').then(values => { if (live) setSets(values); }).catch(error => setMessage(errorText(error)));
    return () => { live = false; };
  }, [user.plans, user.settings.versionId]);
  useEffect(() => { if (scope !== 'all' && scope !== 'standalone' && !user.teams.some(team => team.id === scope)) setScope('standalone'); }, [scope, user.teams]);
  const save = async (set: StrategySet) => { await window.pokedex.strategy('save', { set }); };
  const remove = async (id: string) => {
    const plan = user.plans.find(value => value.id === id);
    await window.pokedex.strategy('delete', { id });
    setMessage(plan ? removalMessage(plan, user) : '个人培养方案已删除。');
  };
  const progress = async (id: string, key: string, value: boolean) => { await window.pokedex.strategy('progress', { id, key, value }); };
  const filtered = sets.filter(set => {
    const team = planTeam(set, user);
    const text = [set.pokemonName, set.title, set.notes || '', team?.title || '', catalog.find(pokemon => pokemon.id === set.pokemonId)?.englishName || ''].join(' ').toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (category === 'all' || set.category === category) &&
      (!generation || set.generation === generation) && (scope === 'all' || (scope === 'standalone' ? !team : team?.id === scope));
  });
  useEffect(() => { setVisibleCount(20); }, [query, category, generation, scope]);
  return <div className="utility-page personal-strategies">
    <div className="cultivation-section-toolbar"><p>按所属队伍筛选成员，或单独管理独立路线；配置与进度和整队视图同步。</p><button className="primary-button" onClick={() => setImporting(true)}><Download size={15} />导入作业</button></div>
    <div className="personal-strategy-tools"><div className="dictionary-search"><Search size={17} /><input aria-label="搜索我的培养方案" value={query} onChange={event => setQuery(event.target.value)} placeholder="宝可梦、路线、所属队伍或备注…" /></div>
      <select aria-label="单只培养所属队伍" value={scope} onChange={event => setScope(event.target.value)}><option value="all">全部方案</option><option value="standalone">仅独立方案</option>{user.teams.map(team => <option key={team.id} value={team.id}>{team.title}（{user.plans.filter(plan => plan.teamId === team.id).length}）</option>)}</select>
      <select aria-label="我的方案玩法筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部玩法</option><option value="singles">单打</option><option value="doubles">双打</option><option value="pve">通关实用</option><option value="custom">自定义／导入</option></select>
      <select aria-label="我的方案世代筛选" value={generation} onChange={event => setGeneration(Number(event.target.value))}><option value={0}>全部世代</option>{Array.from({ length: 9 }, (_, index) => <option value={index + 1} key={index}>第 {index + 1} 世代</option>)}</select></div>
    {message && <div className="strategy-message" role="status">{message}<button onClick={() => setMessage('')}>关闭</button></div>}
    {filtered.length ? <><p className="team-result-count">{filtered.length} 套培养方案符合条件</p><div className="personal-strategy-grid">{filtered.slice(0, visibleCount).map(set => {
      const team = planTeam(set, user), slot = team ? team.members.findIndex(member => member.id === set.id) + 1 : 0;
      return <div className="personal-plan-entry" key={set.id}>
        {team ? <button className="plan-team-link" onClick={() => onTeam?.(team.id)}>所属队伍：{team.title}<span>成员 {slot} · 查看整队 →</span></button> : <div className="plan-standalone">独立方案</div>}
        <button className="personal-pokemon-link" onClick={() => onPokemon(set.pokemonId)}>{set.pokemonName}<span>查看图鉴 →</span></button>
        <StrategyCard source={set} refs={refs || undefined} onSave={save} onEdit={setEditing} onDelete={remove} onProgress={progress} onEntity={onEntity} notify={setMessage}
          deleteContext={team ? '移除这位成员的培养计划后，“' + team.title + '”的队伍收藏、配置快照和笔记仍保留，可在整队培养中重新加入或取消收藏。' : undefined} />
      </div>;
    })}</div></> : <EmptyState title={sets.length ? '没有符合筛选的方案' : '还没有单只培养方案'} description="从整队收藏添加成员，或在图鉴的“配招与培育”保存单只路线。也可以直接导入配招文本。" />}
    {filtered.length > visibleCount && <button className="secondary-button load-more-strategies" onClick={() => setVisibleCount(value => value + 20)}>显示更多方案</button>}
    {editing && refs && <StrategyEditor initial={editing} refs={refs} onClose={() => setEditing(null)} onSave={save} notify={setMessage} />}
    {importing && <ImportStrategies generation={data.versions.find(value => value.id === user.settings.versionId)!.generation} onClose={() => setImporting(false)} notify={setMessage} />}
  </div>;
}
