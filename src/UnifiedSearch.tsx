import { useEffect, useRef, useState } from 'react';
import { ChevronRight, LoaderCircle, Search, X } from 'lucide-react';
import type { Bootstrap, QuickSearchEntry, QuickSearchResult } from './types';
import { TypeChip } from './components';
import { dexError } from './DiscoveryPage';
export default function UnifiedSearch({ data, versionId, pick, close, mini = false, focusToken = 0 }: {
  data: Bootstrap; versionId: number; pick: (value: QuickSearchEntry) => void; close?: () => void; mini?: boolean; focusToken?: number;
}) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [page, setPage] = useState(0), [expanded, setExpanded] = useState(!mini);
  const [result, setResult] = useState<QuickSearchResult | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null), results = useRef<HTMLDivElement>(null);
  const version = data.versions.find(value => value.id === versionId)!;
  const listId = mini ? 'mini-unified-search-results' : 'unified-search-results';
  useEffect(() => {
    if (mini) return;
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [mini]);
  useEffect(() => { if (focusToken) { setExpanded(true); input.current?.focus(); input.current?.select(); } }, [focusToken]);
  useEffect(() => { setResult(null); setQuery(''); setKind('all'); setPage(0); setActive(0); setError(''); }, [versionId]);
  useEffect(() => {
    let live = true; setResult(null); setError(''); setActive(0);
    if (!query.trim()) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void window.pokedex.query<QuickSearchResult>('search', { versionId, query, kind, page, size: kind === 'all' ? mini ? 4 : 6 : 20 })
        .then(value => { if (live) setResult(value); }).catch(failure => { if (live) setError(dexError(failure)); }).finally(() => { if (live) setLoading(false); });
    }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [query, versionId, kind, page, mini]);
  useEffect(() => {
    const container = results.current, selected = container?.querySelector('[data-active="true"]');
    if (!container || !selected) return;
    const bounds = container.getBoundingClientRect(), row = selected.getBoundingClientRect();
    if (row.top < bounds.top) container.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) container.scrollTop += row.bottom - bounds.bottom;
  }, [active]);
  const entries = result?.groups.flatMap(group => group.entries) || [];
  function choose(value: QuickSearchEntry) { if (loading || result?.version.id !== versionId) return; setExpanded(false); pick(value); close?.(); }
  function dismiss() { if (mini) { setExpanded(false); input.current?.blur(); } else close?.(); }
  const content = <div className={'unified-search ' + (mini ? 'mini-unified-search' : '')}>
    {!mini && <div className="unified-search-heading"><strong>统一搜索</strong><span>{version.name}</span><button className="icon-button" aria-label="关闭统一搜索" onClick={dismiss}><X size={19} /></button></div>}
    <div className="unified-search-input"><Search size={18} /><input ref={input} aria-label={mini ? '迷你统一搜索' : '统一搜索内容'} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded={expanded && Boolean(query.trim())} aria-activedescendant={expanded && entries[active] ? listId + '-' + active : undefined} value={query} maxLength={100} placeholder="宝可梦、招式、特性、道具…" onFocus={() => setExpanded(true)} onChange={event => { setResult(null); setQuery(event.target.value); setPage(0); setExpanded(true); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && entries.length) { event.preventDefault(); setExpanded(true); setActive(old => (old + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length); }
      if (event.key === 'Enter' && entries[active]) { event.preventDefault(); choose(entries[active]); }
    }} />{query && <button className="icon-button" aria-label="清空统一搜索" onClick={() => { setQuery(''); setPage(0); input.current?.focus(); }}><X size={15} /></button>}</div>
    {(!mini || expanded && Boolean(query.trim())) && <><div className="unified-search-kinds" aria-label="统一搜索分类">{[['all', '全部'], ['pokemon', '宝可梦'], ['moves', '招式'], ['abilities', '特性'], ['items', '道具']].map(([id, label]) => <button key={id} className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => { setKind(id); setPage(0); input.current?.focus(); }}>{label}</button>)}</div>
      <div className="unified-search-results" ref={results} id={listId} role="listbox" aria-label="统一搜索结果">
        {loading && <p className="dex-search-message" role="status"><LoaderCircle className="spin" size={17} />正在查询本地资料…</p>}
        {error && <p className="build-errors" role="alert">{error}</p>}
        {!query.trim() && <p className="dex-search-message">输入中文、拼音、英文或编号，按 ↑ ↓ 选择，Enter 打开。</p>}
        {result && !result.total && <p className="dex-search-message">当前资料版本没有匹配结果。</p>}
        {result?.groups.filter(group => group.total).map(group => <div className="unified-search-group" key={group.kind}><div className="unified-search-group-title"><strong>{group.label} · {group.total}</strong>{kind === 'all' && group.total > group.entries.length && <button onClick={() => { setKind(group.kind); setPage(0); }}>查看此类全部结果</button>}</div>
          {group.entries.map(value => {
            const index = entries.indexOf(value);
            return <button role="option" aria-selected={active === index} data-active={active === index} id={listId + '-' + index} key={value.kind + '-' + value.id} className="unified-search-result" aria-label={'打开' + group.label + value.name} onMouseEnter={() => setActive(index)} onClick={() => choose(value)}><span><strong>{value.name}</strong><small>#{value.number} · {value.subtitle}</small></span><span className="dex-type-list">{value.types.map(id => <TypeChip key={id} id={id} types={data.types} small />)}</span><ChevronRight size={16} /></button>;
          })}</div>)}
      </div>
      {result && kind !== 'all' && result.total > result.size && <div className="dex-pagination"><button disabled={!page || loading} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1}/{Math.ceil(result.total / result.size)}</span><button disabled={loading || (page + 1) * result.size >= result.total} onClick={() => setPage(page + 1)}>下一页</button></div>}
      {!mini && <p className="unified-search-footer">按 {version.name} 的资料范围查询；同世代道具的实际可获得性可能不同。</p>}
    </>}
  </div>;
  if (mini) return content;
  return <div className="modal-backdrop unified-search-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
    if (event.key === 'Tab') {
      const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select');
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><div className="unified-search-dialog" role="dialog" aria-modal="true" aria-label="统一搜索" tabIndex={-1}>{content}</div></div>;
}
