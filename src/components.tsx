import { ArrowUpRight, CircleHelp, Search, Star } from 'lucide-react';
import type { Bootstrap, Pokemon, Settings, TypeInfo } from './types';

export const TYPE_COLORS: Record<number, string> = {
  1: '#8b909a', 2: '#c56a56', 3: '#8b9cda', 4: '#9f6abd', 5: '#bc985e', 6: '#ac9864',
  7: '#97a857', 8: '#7b75a5', 9: '#8faaa9', 10: '#df795b', 11: '#6d99cf', 12: '#79aa78',
  13: '#d7b650', 14: '#cc7d98', 15: '#81bfc0', 16: '#867cc0', 17: '#82786e', 18: '#cc97b7',
};
export function TypeChip({ id, types, small = false }: { id: number; types: TypeInfo[]; small?: boolean }) {
  return <span className={`type-chip ${small ? 'small' : ''}`} style={{ '--type-color': TYPE_COLORS[id] || '#949494' } as React.CSSProperties}>
    <span className="type-dot" />{types.find(type => type.id === id)?.name || '特殊属性'}
  </span>;
}
export function PokemonImage({ pokemon, settings, versionGeneration, className = '', thumbnail = false }: {
  pokemon: Pokemon; settings: Settings; versionGeneration?: number; className?: string; thumbnail?: boolean;
}) {
  const pixel = thumbnail || settings.imageStyle === 'sprite';
  const retro = versionGeneration === 3 ? (pokemon.images.emerald || pokemon.images.ruby || pokemon.images.firered) : undefined;
  const source = pixel ? retro || pokemon.images.sprite || pokemon.images.artwork : pokemon.images.artwork || pokemon.images.sprite;
  return source ? <img className={`pokemon-image ${pixel && (retro || pokemon.images.sprite) ? 'pixel' : ''} ${className}`} src={source} alt={pokemon.formName ? `${pokemon.name} · ${pokemon.formName}` : pokemon.name} loading={thumbnail ? 'lazy' : 'eager'} draggable={false} />
    : <div className={`image-placeholder ${className}`}><CircleHelp size={32} /><span>暂无图片</span></div>;
}
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol"><Search size={25} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{right}</div>;
}
export function PokemonRow({ pokemon, active, favorite, onSelect, onFavorite, data, settings }: {
  pokemon: Pokemon; active: boolean; favorite: boolean; onSelect: () => void; onFavorite: () => void; data: Bootstrap; settings: Settings;
}) {
  return <div className={`pokemon-row ${active ? 'active' : ''}`}>
    <button className="pokemon-row-main" onClick={onSelect} aria-label={`查看${pokemon.name}${pokemon.formName}`}>
      <span className="row-number">{String(pokemon.speciesId).padStart(4, '0')}</span>
      <PokemonImage pokemon={pokemon} settings={settings} thumbnail versionGeneration={data.versions.find(v => v.id === settings.versionId)?.generation} />
      <span className="row-name"><strong>{pokemon.name}</strong><span>{pokemon.formName || pokemon.englishName}</span></span>
      <span className="row-types">{pokemon.types.map(id => <TypeChip key={id} id={id} types={data.types} small />)}</span>
    </button>
    <button className={`row-star ${favorite ? 'is-favorite' : ''}`} title={favorite ? '取消收藏' : '收藏'} aria-label={`${favorite ? '取消收藏' : '收藏'}${pokemon.name}`} onClick={onFavorite}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>
  </div>;
}
export function Reference({ version }: { version: string | null | undefined }) {
  return version ? <span className="reference"><ArrowUpRight size={12} />说明参考：{version}</span> : null;
}
