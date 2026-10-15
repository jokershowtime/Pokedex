import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, Clock3, Database, FlaskConical, LayoutGrid, LoaderCircle, Maximize2, Minus, Moon, PanelTop, Search, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, Sparkles, Star, Sun, Swords, X } from 'lucide-react';
import type { Bootstrap, EntityKind, Page, Pokemon, PokemonDetail, QuickSearchEntry, Settings, UserState } from './types';
import { EmptyState, PokemonRow, TypeChip } from './components';
import PokemonPanel from './PokemonPanel';
import Dictionary, { EntityModal } from './Dictionary';
import { MatchupPage, SettingsPage } from './UtilityPages';
import CultivationPage, { type CultivationRequest } from './CultivationPage';
import TeamPage from './TeamPage';
import TeamAssistantPage from './TeamAssistantPage';
import AssistantTaskIndicator from './AssistantTaskIndicator';
import BattlePage, { type BattleSeed } from './BattlePage';
import { Calculator } from 'lucide-react';
import { GitCompareArrows } from 'lucide-react';
import DiscoveryPage from './DiscoveryPage';
import DexComparePage from './DexComparePage';
import UnifiedSearch from './UnifiedSearch';
import { MiniEntityPanel, MiniTabBar, miniTabKey } from './MiniTabs';
import './dex-tools.css';
import './mini-tabs.css';

const NAVIGATION: { id: Page; label: string; icon: typeof BookOpen }[] = [
  { id: 'dex', label: '宝可梦图鉴', icon: BookOpen }, { id: 'matchup', label: '属性克制', icon: ShieldCheck },
  { id: 'discover', label: '组合反查', icon: Search }, { id: 'compare', label: '宝可梦对比', icon: GitCompareArrows },
  { id: 'moves', label: '招式图鉴', icon: Swords }, { id: 'abilities', label: '特性图鉴', icon: Sparkles },
  { id: 'items', label: '道具图鉴', icon: FlaskConical }, { id: 'teams', label: '队伍推荐', icon: LayoutGrid }, { id: 'assistant', label: '阵容助手', icon: SlidersHorizontal }, { id: 'battle', label: '对战计算器', icon: Calculator }, { id: 'plans', label: '我的培养', icon: BookOpen }, { id: 'favorites', label: '我的收藏', icon: Star },
  { id: 'history', label: '最近查询', icon: Clock3 },
];
const normalize = (value: string) => value.toLowerCase().replace(/[\s·・\-_'’./＇#]/g, '');
const IS_MINI = new URLSearchParams(location.search).has('mini');

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [user, setUser] = useState<UserState | null>(null);
  const [catalog, setCatalog] = useState<Pokemon[]>([]);
  const [page, setPage] = useState<Page>('dex');
  const [battleSeed, setBattleSeed] = useState<BattleSeed | null>(null);
  const [cultivationRequest, setCultivationRequest] = useState<CultivationRequest>({ token: 0 });
  useEffect(() => { if (page !== 'plans') setCultivationRequest(old => old.teamId ? { token: old.token } : old); }, [page]);
  const [selected, setSelected] = useState(6);
  const [detail, setDetail] = useState<PokemonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [bootError, setBootError] = useState('');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [showForms, setShowForms] = useState(false);
  const [sort, setSort] = useState('number');
  const [showFilters, setShowFilters] = useState(true);
  const [entitySelection, setEntitySelection] = useState<{ kind: EntityKind; id: number } | null>(null);
  const [quickSearch, setQuickSearch] = useState(false), [quickFocus, setQuickFocus] = useState(0);
  const [comparedIds, setComparedIds] = useState<number[]>([]);
  const [miniActive, setMiniActive] = useState('lookup'), [miniPinning, setMiniPinning] = useState(false);
  const [compactDetail, setCompactDetail] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsScroll = useRef<HTMLDivElement>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = (message: string) => { setToast(message.replace(/^Error invoking remote method '[^']+': Error: /, '')); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500); };
  useEffect(() => {
    if (!window.pokedex) { setBootError('请通过桌面程序打开图鉴。'); return; }
    Promise.all([window.pokedex.query<Bootstrap>('bootstrap'), window.pokedex.user('get')]).then(([bootstrap, saved]) => { setData(bootstrap); setUser(saved); }).catch(error => setBootError(error.message));
    const unsubscribe = window.pokedex.onUserChange(setUser);
    const navigate = window.pokedex.onNavigate(id => { setSelected(id); setPage('dex'); setQuery(''); });
    return () => { unsubscribe(); navigate(); };
  }, []);
  useEffect(() => {
    if (!user) return;
    document.documentElement.dataset.theme = user.settings.theme;
  }, [user?.settings.theme]);
  useEffect(() => {
    if (!user) return;
    let live = true; setCatalogLoading(true); setType(0); setGeneration(0);
    window.pokedex.query<Pokemon[]>('catalog', { versionId: user.settings.versionId }).then(values => {
      if (!live) return;
      setCatalog(values); setCatalogLoading(false); setComparedIds(old => old.filter(id => values.some(value => value.id === id)));
      if (!values.some(pokemon => pokemon.id === selected)) setSelected(values.find(pokemon => pokemon.id === 6)?.id || values[0]?.id || 1);
    }).catch(error => { if (live) { showError(error.message); setCatalogLoading(false); } });
    return () => { live = false; };
  }, [user?.settings.versionId]);
  useEffect(() => {
    if (!user || !selected || catalogLoading) return;
    let live = true; setLoading(true);
    window.pokedex.query<PokemonDetail>('pokemon', { id: selected, versionId: user.settings.versionId }).then(value => {
      if (live) { setDetail(value); setLoading(false); void window.pokedex.user('visit', { id: selected }).catch(error => showError(error.message)); }
    }).catch(error => { if (live) { showError(error.message); setLoading(false); } });
    return () => { live = false; };
  }, [selected, user?.settings.versionId, catalogLoading]);
  useEffect(() => { detailScroll.current?.scrollTo({ top: 0 }); }, [detail?.id]);
  useEffect(() => {
    if (!IS_MINI || catalogLoading) return;
    const tab = user?.settings.miniTabs?.find(value => miniTabKey(value) === miniActive);
    if (tab?.kind === 'pokemon' && tab.id !== selected && catalog.some(value => value.id === tab.id)) setSelected(tab.id);
  }, [miniActive, catalog, catalogLoading, user?.settings.miniTabs]);
  useEffect(() => { if (IS_MINI) detailScroll.current?.scrollTo({ top: 0 }); }, [miniActive, user?.settings.versionId]);
  useEffect(() => { resultsScroll.current?.scrollTo({ top: 0 }); }, [query, type, generation, sort, page]);
  const filtered = useMemo(() => {
    if (!user) return [];
    const normalized = normalize(query);
    let values = catalog.filter(pokemon => (showForms || !pokemon.formName || page === 'favorites' || page === 'history') &&
      (!normalized || pokemon.searchKey.includes(normalized) || (/^\d+$/.test(normalized) && pokemon.speciesId === Number(normalized))) &&
      (!type || pokemon.types.includes(type)) && (!generation || pokemon.generation === generation) &&
      (page !== 'favorites' || user.favorites.includes(pokemon.id)) && (page !== 'history' || user.history.some(entry => entry.id === pokemon.id)));
    if (page === 'history') return values.sort((a, b) => user.history.findIndex(entry => entry.id === a.id) - user.history.findIndex(entry => entry.id === b.id));
    if (sort === 'total') values = [...values].sort((a, b) => b.total - a.total || a.speciesId - b.speciesId);
    else if (['attack', 'special', 'speed'].includes(sort)) {
      const statId = ({ attack: 2, special: 4, speed: 6 })[sort as 'attack' | 'special' | 'speed'];
      values = [...values].sort((a, b) => (b.stats.find(stat => stat.id === statId)?.value || 0) - (a.stats.find(stat => stat.id === statId)?.value || 0) || a.speciesId - b.speciesId);
    }
    return values;
  }, [catalog, user?.favorites, user?.history, query, type, generation, sort, showForms, page]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setEntitySelection(null);
        if (IS_MINI) setQuickFocus(old => old + 1); else setQuickSearch(true);
      }
      if (event.target === searchInput.current && !event.isComposing) {
        if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) && filtered.length) {
          event.preventDefault(); const index = filtered.findIndex(pokemon => pokemon.id === selected);
          const next = event.key === 'Enter' ? (index < 0 ? 0 : index) : event.key === 'ArrowDown' ? Math.min(filtered.length - 1, index + 1) : Math.max(0, index - 1);
          setSelected(filtered[next].id);
          if (event.key === 'Enter') setCompactDetail(true);
        }
        if (event.key === 'Escape') { setQuery(''); searchInput.current?.blur(); }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [filtered, selected]);
  const selectPokemon = (id: number) => {
    if (!catalog.some(pokemon => pokemon.id === id)) { showError('这只宝可梦在当前规则下尚未登场，请先切换资料版本。'); return; }
    setSelected(id); setCompactDetail(true);
    if (IS_MINI) setMiniActive('lookup');
  };
  const navigatePokemon = (id: number) => { setEntitySelection(null); setPage('dex'); setQuery(''); selectPokemon(id); };
  const pickQuickSearch = (value: QuickSearchEntry) => {
    setQuickSearch(false);
    if (value.kind === 'pokemon') navigatePokemon(value.id); else setEntitySelection({ kind: value.kind, id: value.id });
  };
  const toggleCompare = (id: number) => {
    if (comparedIds.includes(id)) setComparedIds(old => old.filter(value => value !== id));
    else if (comparedIds.length < 4) setComparedIds(old => [...old, id]);
    else showError('最多比较 4 只宝可梦，请先在对比页移除一位。');
  };
  const launchBattle = (seed: BattleSeed) => { setBattleSeed(seed); setPage('battle'); setEntitySelection(null); };
  const launchCultivation = (teamId?: string) => {
    setCultivationRequest(old => ({ teamId, token: old.token + 1 })); setPage('plans'); setEntitySelection(null);
  };
  const favorite = async (id: number) => { try { await window.pokedex.user('favorite', { id }); } catch (error) { showError((error as Error).message); } };
  const saveSettings = async (patch: Partial<Settings>) => { await window.pokedex.user('settings', patch); };
  const pinMiniTab = async (kind: QuickSearchEntry['kind'], id: number) => {
    if (miniPinning) return;
    setMiniPinning(true);
    try {
      const value = await window.pokedex.user('mini-pin', { kind, id }); setUser(value);
      setMiniActive(kind + ':' + id); setEntitySelection(null);
    } catch (failure) { showError((failure as Error).message); }
    finally { setMiniPinning(false); }
  };
  const closeMiniTab = async (key: string) => {
    try { const value = await window.pokedex.user('mini-unpin', { key }); setUser(value); if (miniActive === key) setMiniActive('lookup'); }
    catch (failure) { showError((failure as Error).message); }
  };
  const saveNote = async (id: number, text: string) => { try { await window.pokedex.user('note', { id, text }); } catch (error) { showError((error as Error).message); throw error; } };
  const switchPage = (next: Page) => { setPage(next); setCompactDetail(false); setQuery(''); setType(0); setGeneration(0); setEntitySelection(null); };
  if (bootError) return <div className="startup-error"><img src="icon.svg" alt="" /><h1>图鉴暂时无法打开</h1><p>{bootError}</p><button className="primary-button" onClick={() => location.reload()}>重新打开</button><button className="secondary-button" onClick={() => void window.pokedex?.window('close')}>关闭窗口</button></div>;
  if (!data || !user) return <div className="startup-loading"><img src="icon.svg" alt="" /><h1>宝可梦图鉴</h1><p><LoaderCircle className="spin" size={15} />正在准备本地资料…</p></div>;
  const version = data.versions.find(v => v.id === user.settings.versionId)!;
  const isDex = ['dex', 'favorites', 'history'].includes(page);
  const baseCount = catalog.filter(pokemon => pokemon.isDefault).length;
  const miniTabs = user.settings.miniTabs || [], miniTab = miniTabs.find(value => miniTabKey(value) === miniActive);
  const selectMiniTab = (key: string) => {
    setMiniActive(key); setEntitySelection(null);
    const tab = miniTabs.find(value => miniTabKey(value) === key);
    if (tab?.kind === 'pokemon' && catalog.some(value => value.id === tab.id)) setSelected(tab.id);
  };
  const panel = <>{!IS_MINI && <button className="compact-back" onClick={() => setCompactDetail(false)}><ChevronLeft size={17} />返回宝可梦列表</button>}<PokemonPanel detail={detail} loading={loading} data={data} user={user} onSelect={selectPokemon} onFavorite={id => void favorite(id)} onEntity={(kind, id) => setEntitySelection({ kind, id })} onNote={saveNote} mini={IS_MINI} onCompare={IS_MINI ? undefined : toggleCompare} compared={Boolean(detail && comparedIds.includes(detail.id))} /></>;
  const search = <div className="main-search"><Search size={18} /><input ref={searchInput} aria-label="搜索宝可梦" placeholder="搜索宝可梦：中文名、拼音、编号…" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button className="icon-button" aria-label="清空宝可梦搜索" onClick={() => setQuery('')}><X size={16} /></button> : <kbd title="Ctrl K 打开统一搜索">Ctrl K</kbd>}</div>;
  const windowControls = <div className="window-controls"><button aria-label="最小化窗口" onClick={() => void window.pokedex.window('minimize')}><Minus size={14} /></button>{!IS_MINI && <button aria-label="最大化窗口" onClick={() => void window.pokedex.window('maximize')}><Maximize2 size={12} /></button>}<button className="close-window" aria-label={IS_MINI ? '收起迷你窗口' : '关闭图鉴'} onClick={() => void window.pokedex.window('close')}><X size={15} /></button></div>;
  return <div className={`app-shell ${IS_MINI ? 'mini-shell' : ''} ${compactDetail ? 'compact-detail' : ''}`}>
    {IS_MINI ? <><header className="mini-titlebar"><img src="icon.svg" alt="" /><strong>图鉴 · 快速查询</strong><span className="mini-pin"><Check size={11} />置顶</span><button className="icon-button" aria-label="打开完整图鉴" title="打开完整图鉴" onClick={() => void window.pokedex.window('main')}><ArrowUpRight size={16} /></button>{windowControls}</header><div className="mini-searchbar"><UnifiedSearch data={data} versionId={version.id} pick={pickQuickSearch} mini focusToken={quickFocus} /><select aria-label="迷你图鉴规则版本" value={version.id} onChange={event => void saveSettings({ versionId: Number(event.target.value) }).catch(error => showError(error.message))}>{data.versions.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}</select></div>
      <MiniTabBar tabs={miniTabs} active={miniTab ? miniActive : 'lookup'} select={selectMiniTab} close={key => void closeMiniTab(key)} pin={() => void pinMiniTab('pokemon', selected)} pinDisabled={miniPinning || loading || catalogLoading || !detail || detail.id !== selected || detail.version.id !== version.id || Boolean(miniTab) || miniTabs.some(value => value.kind === 'pokemon' && value.id === selected) || miniTabs.length >= 12} />
      <div className="mini-detail-scroll mini-tab-content" id="mini-tab-content" role="tabpanel" ref={detailScroll}>{miniTab && miniTab.kind !== 'pokemon' ? <MiniEntityPanel tab={miniTab} data={data} user={user} onPokemon={navigatePokemon} /> : miniTab && !catalogLoading && !catalog.some(value => value.id === miniTab.id) ? <EmptyState title="当前版本没有此宝可梦" description={'“' + miniTab.name + '”仍保留在固定标签中，可以切换资料版本后查看。'} /> : miniTab && (catalogLoading || loading || detail?.id !== miniTab.id || detail.version.id !== version.id) ? <div className="modal-loading"><LoaderCircle className="spin" /></div> : panel}</div></> : <>
      <aside className="sidebar"><div className="brand"><img src="icon.svg" alt="" /><div><strong>宝可梦图鉴</strong><span>每一段冒险的好帮手</span></div></div><span className="sidebar-label">探索与查询</span><nav className="primary-nav">{NAVIGATION.map(item => <div key={item.id}>{item.id === 'teams' && <div className="nav-divider"><span>我的冒险</span></div>}<button title={item.label} aria-label={item.label} className={page === item.id ? 'active' : ''} onClick={() => switchPage(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === 'favorites' && user.favorites.length > 0 && <b>{user.favorites.length}</b>}{item.id === 'compare' && comparedIds.length > 0 && <b>{comparedIds.length}</b>}{item.id === 'dex' && <span className="nav-active-dot" />}</button></div>)}</nav><div className="sidebar-bottom"><AssistantTaskIndicator open={() => switchPage('assistant')} /><div className="offline-card"><Database size={17} /><div><strong>资料已在本地</strong><span><i className="status-dot" />支持离线查询</span></div><Check size={12} /></div><button className={`settings-nav ${page === 'settings' ? 'active' : ''}`} onClick={() => switchPage('settings')}><SettingsIcon size={18} />设置<span>{__APP_VERSION__}</span></button></div></aside>
      <div className="workspace"><header className="titlebar"><div className="breadcrumb"><span>冒险工具箱</span><ChevronRight size={12} /><strong>{page === 'settings' ? '设置' : NAVIGATION.find(item => item.id === page)?.label}</strong></div><div className="titlebar-actions"><button className="unified-search-launch" aria-label="打开统一搜索" onClick={() => { setEntitySelection(null); setQuickSearch(true); }}><Search size={16} /><span>统一搜索</span><kbd>Ctrl K</kbd></button><button className="icon-button" aria-label="切换深浅色主题" title="切换主题" onClick={() => void saveSettings({ theme: user.settings.theme === 'light' ? 'dark' : 'light' }).catch(error => showError(error.message))}>{user.settings.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button><button className="mini-launch" onClick={() => void window.pokedex.window('mini')}><PanelTop size={15} />迷你图鉴</button>{windowControls}</div></header>
        <main className="app-main">{isDex ? <><div className="dex-page-heading"><div><span className="eyebrow">认识你的下一个伙伴</span><h1>{page === 'favorites' ? '我的收藏' : page === 'history' ? '最近查询' : '宝可梦图鉴'}<span className="count-pill">{page === 'favorites' ? user.favorites.length : page === 'history' ? user.history.length : baseCount} {page === 'history' ? '条' : '只'}</span></h1><p>{page === 'favorites' ? '把喜欢的伙伴和常用资料留在手边。' : page === 'history' ? '回到刚才查过的宝可梦，接着探索。' : '查属性、看进化、找招式。下一步冒险，从这里开始。'}</p></div><div className="version-picker"><span>官方规则版本</span><select aria-label="官方规则版本" value={version.id} onChange={event => void saveSettings({ versionId: Number(event.target.value) }).catch(error => showError(error.message))}>{data.versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div></div>
          <div className="dex-layout"><section className="catalog-panel"><div className="catalog-tools">{search}<div className="catalog-toolbar"><div className="catalog-view-label"><LayoutGrid size={14} />全国图鉴</div><button className={`filter-toggle ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(value => !value)} aria-expanded={showFilters}><SlidersHorizontal size={14} />筛选</button><div className="sort-control"><ArrowDownUp size={14} /><select aria-label="图鉴排序" value={sort} onChange={event => setSort(event.target.value)}><option value="number">编号顺序</option><option value="total">种族值总和</option><option value="attack">攻击种族值</option><option value="special">特攻种族值</option><option value="speed">速度种族值</option></select></div></div>
            {showFilters && <div className="catalog-filters"><select aria-label="筛选宝可梦属性" value={type} onChange={event => setType(Number(event.target.value))}><option value={0}>全部属性</option>{data.types.filter(t => t.generation <= version.generation).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="筛选宝可梦世代" value={generation} onChange={event => setGeneration(Number(event.target.value))}><option value={0}>全部世代</option>{Array.from({ length: version.generation }, (_, i) => i + 1).map(value => <option key={value} value={value}>第 {value} 世代</option>)}</select><label className="forms-checkbox"><input type="checkbox" checked={showForms} onChange={event => setShowForms(event.target.checked)} />显示形态</label></div>}
          </div><div className="list-caption"><span>{catalogLoading ? '正在整理列表…' : `${filtered.length} 只符合条件`}</span><span>名称 / 属性</span></div><div className="pokemon-list" ref={resultsScroll}>{catalogLoading ? <div className="list-loading"><LoaderCircle className="spin" /></div> : filtered.length ? filtered.map(pokemon => <PokemonRow key={pokemon.id} pokemon={pokemon} active={pokemon.id === selected} favorite={user.favorites.includes(pokemon.id)} onSelect={() => selectPokemon(pokemon.id)} onFavorite={() => void favorite(pokemon.id)} data={data} settings={user.settings} />) : <EmptyState title={page === 'favorites' && !user.favorites.length ? '还没有收藏的伙伴' : page === 'history' && !user.history.length ? '还没有查询记录' : '没有找到对应的宝可梦'} description={page === 'favorites' && !user.favorites.length ? '点击宝可梦旁边的星星，就能把它留在这里。' : '试试中文名、拼音、编号，或调整筛选条件。'} action={<button className="secondary-button" onClick={() => { setQuery(''); setType(0); setGeneration(0); if (page === 'favorites' || page === 'history') switchPage('dex'); }}>返回图鉴</button>} />}</div><footer className="catalog-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 快速选择</span><span>第 {version.generation} 世代规则</span></footer></section><div className="detail-scroll" ref={detailScroll}>{panel}</div></div>
        </> : page === 'discover' ? <DiscoveryPage key={version.id} data={data} user={user} compared={comparedIds} onCompare={toggleCompare} onPokemon={navigatePokemon} onEntity={(kind, id) => setEntitySelection({ kind, id })} /> : page === 'compare' ? catalogLoading ? <div className="dex-loading"><LoaderCircle className="spin" />正在更新版本资料…</div> : <DexComparePage data={data} user={user} catalog={catalog} ids={comparedIds} update={setComparedIds} onPokemon={navigatePokemon} onEntity={(kind, id) => setEntitySelection({ kind, id })} /> : page === 'matchup' ? <MatchupPage data={data} catalog={catalog} user={user} onError={showError} /> : page === 'teams' ? <TeamPage data={data} user={user} catalog={catalog} onEntity={(kind, id) => setEntitySelection({ kind, id })} onPokemon={navigatePokemon} onBattle={launchBattle} onCultivate={launchCultivation} /> : page === 'assistant' ? <TeamAssistantPage data={data} user={user} catalog={catalog} onEntity={(kind, id) => setEntitySelection({ kind, id })} onPokemon={navigatePokemon} onBattle={launchBattle} onCultivate={launchCultivation} /> : page === 'battle' ? <BattlePage data={data} user={user} seed={battleSeed} /> : page === 'plans' ? <CultivationPage data={data} user={user} catalog={catalog} request={cultivationRequest} onEntity={(kind, id) => setEntitySelection({ kind, id })} onPokemon={navigatePokemon} onBattle={launchBattle} onRecommend={() => setPage('teams')} /> : page === 'settings' ? <SettingsPage data={data} user={user} save={saveSettings} onError={showError} /> : <Dictionary kind={page as EntityKind} data={data} user={user} onPokemon={navigatePokemon} onError={showError} />}</main>
      </div>
    </>}
    {entitySelection && <EntityModal selection={entitySelection} data={data} user={user} onClose={() => setEntitySelection(null)} onPokemon={navigatePokemon} onPin={IS_MINI ? () => void pinMiniTab(entitySelection.kind, entitySelection.id) : undefined} pinning={miniPinning} />}
    {!IS_MINI && quickSearch && <UnifiedSearch data={data} versionId={version.id} pick={pickQuickSearch} close={() => setQuickSearch(false)} />}
    {toast && <div className="toast" role="alert"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
