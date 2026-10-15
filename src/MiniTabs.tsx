import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FlaskConical, LoaderCircle, Pin, Sparkles, Swords, X } from 'lucide-react';
import type { Bootstrap, Entity, EntityDetail, EntityKind, MiniTab, UserState } from './types';
import { EmptyState } from './components';
import { EntityCard } from './Dictionary';
export const miniTabKey = (tab: Pick<MiniTab, 'kind' | 'id'>) => tab.kind + ':' + tab.id;
const icons = { pokemon: BookOpen, moves: Swords, abilities: Sparkles, items: FlaskConical };
const kinds = { pokemon: '宝可梦', moves: '招式', abilities: '特性', items: '道具' };
export function MiniTabBar({ tabs, active, select, close, pin, pinDisabled }: {
  tabs: MiniTab[]; active: string; select: (key: string) => void; close: (key: string) => void; pin: () => void; pinDisabled: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = scroll.current, node = parent?.querySelector('[aria-selected="true"]');
    if (!parent || !node) return;
    const area = parent.getBoundingClientRect(), bounds = node.getBoundingClientRect();
    if (bounds.left < area.left) parent.scrollLeft -= area.left - bounds.left;
    if (bounds.right > area.right) parent.scrollLeft += bounds.right - area.right;
  }, [active, tabs.length]);
  return <div className="mini-tabs"><div className="mini-tabs-toolbar"><button className="icon-button" aria-label="向左查看固定标签" onClick={() => scroll.current?.scrollBy({ left: -180, behavior: 'smooth' })}><ChevronLeft size={16} /></button>
    <div className="mini-tab-list" role="tablist" aria-label="迷你图鉴标签" ref={scroll} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLElement && event.target.getAttribute('role') !== 'tab') return;
      const values = ['lookup', ...tabs.map(miniTabKey)], index = values.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
      event.preventDefault(); select(values[next]);
      scroll.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}><button role="tab" aria-selected={active === 'lookup'} aria-controls="mini-tab-content" className="mini-tab-lookup" onClick={() => select('lookup')}>临时查询</button>
      {tabs.map(tab => { const key = miniTabKey(tab), Icon = icons[tab.kind]; return <div className={'mini-tab ' + (active === key ? 'active' : '')} key={key}>
        <button role="tab" aria-selected={active === key} aria-controls="mini-tab-content" title={kinds[tab.kind] + '：' + tab.name} aria-label={kinds[tab.kind] + '标签：' + tab.name} onClick={() => select(key)}><Icon size={14} /><span>{tab.name}</span></button>
        <button className="mini-tab-close" aria-label={'关闭固定标签' + tab.name} onClick={() => close(key)}><X size={13} /></button>
      </div>; })}</div><button className="icon-button" aria-label="向右查看固定标签" onClick={() => scroll.current?.scrollBy({ left: 180, behavior: 'smooth' })}><ChevronRight size={16} /></button></div>
    <div className="mini-tab-actions"><span>手动固定 · {tabs.length}/12</span><button className="secondary-button" disabled={pinDisabled} onClick={pin}><Pin size={13} />固定当前宝可梦</button></div>
  </div>;
}
export function MiniEntityPanel({ tab, data, user, onPokemon }: { tab: MiniTab; data: Bootstrap; user: UserState; onPokemon: (id: number) => void }) {
  const [detail, setDetail] = useState<EntityDetail | null>(null), [error, setError] = useState(''), [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true; setDetail(null); setError(''); setMissing(false);
    void window.pokedex.query<Entity[]>('entities', { kind: tab.kind, versionId: user.settings.versionId }).then(async entries => {
      if (!live) return;
      if (!entries.some(value => value.id === tab.id)) { setMissing(true); return; }
      const value = await window.pokedex.query<EntityDetail>('entity', { kind: tab.kind, id: tab.id, versionId: user.settings.versionId });
      if (live) setDetail(value);
    }).catch(failure => { if (live) setError((failure as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); });
    return () => { live = false; };
  }, [tab.kind, tab.id, user.settings.versionId]);
  if (missing) return <EmptyState title="当前版本没有此资料" description={'“' + tab.name + '”仍保留在固定标签中，可以切换资料版本后查看。'} />;
  if (error) return <EmptyState title="资料加载失败" description={error} />;
  if (!detail) return <div className="modal-loading" role="status"><LoaderCircle className="spin" /></div>;
  return <div className="mini-entity-panel"><EntityCard detail={detail} data={data} user={user} onPokemon={onPokemon} /></div>;
}
