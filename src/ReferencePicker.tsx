import { useState } from 'react';
import { Search, X } from 'lucide-react';
export interface ReferenceOption { id: number; name: string; searchKey: string; subtitle?: string }
export const searchText = (text: string) => text.toLowerCase().replace(/[\s·・\-_'’./＇#]/g, '');
export default function ReferencePicker({ label, entries, selected, limit, update }: {
  label: string; entries: ReferenceOption[]; selected: number[]; limit: number; update: (values: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = entries.filter(value => !selected.includes(value.id) && (!query || value.searchKey.includes(searchText(query)) || String(value.id) === searchText(query))).slice(0, 80);
  return <div className="reference-picker"><div className="reference-picker-title"><strong>{label}</strong><span>{selected.length}/{limit}</span></div>
    <div className="reference-picker-input"><Search size={16} /><input aria-label={'搜索' + label} value={query} maxLength={100} placeholder="名称、拼音或编号…" onChange={event => setQuery(event.target.value)} /><select aria-label={'添加' + label} value="" disabled={selected.length >= limit} onChange={event => {
      if (!event.target.value) return; update([...selected, Number(event.target.value)]); setQuery('');
    }}><option value="">选择资料</option>{visible.map(value => <option key={value.id} value={value.id}>{value.name}{value.subtitle ? ' · ' + value.subtitle : ''}</option>)}</select></div>
    <div className="reference-picker-selected">{selected.map(id => <button className="secondary-button" key={id} aria-label={'移除' + label + (entries.find(value => value.id === id)?.name || id)} onClick={() => update(selected.filter(value => value !== id))}>{entries.find(value => value.id === id)?.name || id}<X size={14} /></button>)}{!selected.length && <span>未指定</span>}</div>
  </div>;
}
