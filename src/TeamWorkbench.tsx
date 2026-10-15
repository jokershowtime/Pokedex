import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle, Save, Search, Users, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import type { Pokemon, PokemonTeam, StrategySet, TeamFormat, UserState } from './types';
import type { BattleSeed } from './BattlePage';
import { PokemonImage } from './components';
import { setLabel } from './StrategyCards';
import { planTeam } from './cultivation-model';
import TeamAnalytics from './TeamAnalytics';

type Slot = { kind: 'member' | 'plan'; id: string } | null;
const message = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
const key = (slot: Slot) => slot ? slot.kind + ':' + slot.id : '';
const normalize = (value: string) => value.toLowerCase().replace(/[\s·・\-_'’./#]/g, '');

export default function TeamWorkbench({ team, copy = false, defaultGeneration, formats, pokemon, user, close, saved, onBattle }: {
  team?: PokemonTeam; copy?: boolean; defaultGeneration: number; formats: TeamFormat[]; pokemon: Map<number, Pokemon>; user: UserState;
  close: () => void; saved: (id: string) => void; onBattle: (seed: BattleSeed) => void;
}) {
  const [title, setTitle] = useState(team ? team.title + (copy ? ' · 副本' : '') : '我的新队伍');
  const [notes, setNotes] = useState(team?.notes || '');
  const [format, setFormat] = useState(team?.format || 'gen' + defaultGeneration + 'ou');
  const [slots, setSlots] = useState<Slot[]>(Array.from({ length: 6 }, (_, index) => team?.members[index] ? { kind: 'member', id: team.members[index].id } : null));
  const [plans, setPlans] = useState<StrategySet[]>([]), [query, setQuery] = useState('');
  const [preview, setPreview] = useState<PokemonTeam | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const generation = Number(format.match(/^gen([1-9])/)?.[1] || defaultGeneration);
  const choices = useMemo(() => {
    const owned = new Set(team?.members.map(member => member.id) || []);
    return [
      ...(team?.members || []).map(member => ({ key: key({ kind: 'member', id: member.id }), slot: { kind: 'member', id: member.id } as Slot, plan: member })),
      ...plans.filter(plan => !owned.has(plan.id)).map(plan => ({ key: key({ kind: 'plan', id: plan.id }), slot: { kind: 'plan', id: plan.id } as Slot, plan })),
    ];
  }, [plans, team]);
  const payload = useMemo(() => ({ ...(team ? copy ? { copyFrom: team.id } : { id: team.id } : {}),
    title, notes, format, slots }), [team, copy, title, notes, format, slots]);
  useEffect(() => {
    let live = true;
    window.pokedex.strategy<StrategySet[]>('personal').then(value => { if (live) setPlans(value); }).catch(failure => { if (live) setError(message(failure)); });
    return () => { live = false; };
  }, [user.plans, user.settings.versionId]);
  useEffect(() => {
    let live = true; setPreview(null); setError('');
    if (!slots.some(Boolean)) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void window.pokedex.team<PokemonTeam>('compose-preview', payload).then(value => {
        if (live) { setPreview(value); setLoading(false); }
      }).catch(failure => { if (live) { setError(message(failure)); setLoading(false); } });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [payload, user.plans, user.settings.versionId]);
  const route = (plan: StrategySet) => {
    const owner = planTeam(plan, user);
    if (copy && team?.members.some(member => member.id === plan.id)) return '原队成员，复制为独立方案';
    if (copy) return '复制配置，进度从零开始';
    if (owner?.id === team?.id) return '当前成员';
    return owner ? owner.title + ' · 将复制配置' : '独立方案 · 保留进度';
  };
  const search = normalize(query);
  const filtered = choices.filter(choice => {
    if (choice.plan.generation !== generation) return false;
    const text = [choice.plan.pokemonName, choice.plan.showdownSpecies, choice.plan.title, route(choice.plan)].join(' ');
    return !search || normalize(text).includes(search) || normalize(pinyin(text, { toneType: 'none' })).includes(search) ||
      normalize(pinyin(text, { pattern: 'first', toneType: 'none' })).includes(search);
  });
  const changeFormat = (value: string) => {
    const next = Number(value.match(/^gen([1-9])/)?.[1]);
    setFormat(value);
    setSlots(old => old.map(slot => choices.find(choice => choice.key === key(slot))?.plan.generation === next ? slot : null));
  };
  const move = (index: number, direction: number) => setSlots(old => {
    const result = [...old]; [result[index], result[index + direction]] = [result[index + direction], result[index]]; return result;
  });
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const result = await window.pokedex.team<UserState>('compose-save', payload);
      const value = team && !copy ? result.teams.find(value => value.id === team.id) : result.teams[0];
      if (value) { saved(value.id); close(); }
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop team-editor-layer"><div className="build-editor team-workbench" role="dialog" aria-modal="true" aria-label="队伍工作台">
    <header><div><span className="eyebrow">从已有培养方案组出自己的队伍</span><h2>{team ? copy ? '复制为新队伍' : '调整队伍成员' : '新建队伍'}</h2></div><button className="icon-button" disabled={busy} aria-label="关闭队伍工作台" onClick={close}><X size={20} /></button></header>
    <div className="build-editor-body">
      <div className="builder-form-grid"><label>队伍名称<input aria-label="工作台队伍名称" disabled={busy} value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label>
        <label>参考世代与规则<select aria-label="工作台队伍规则" disabled={busy} value={format} onChange={event => changeFormat(event.target.value)}>{formats.map(value => <option key={value.id} value={value.id}>第 {value.generation} 世代 · {value.label}</option>)}</select></label></div>
      <p className="team-workbench-help">最多 6 位成员，可先保存已有成员再补齐。仅列出同世代方案；切换世代会清空不兼容成员。等级、招式和数值沿用原方案。</p>
      <div className="dictionary-search workbench-search"><Search size={18} /><input aria-label="搜索工作台培养方案" value={query} onChange={event => setQuery(event.target.value)} placeholder="宝可梦、方案或所属队伍，支持拼音…" /></div>
      <div className="workbench-roster">{slots.map((slot, index) => {
        const chosen = choices.find(choice => choice.key === key(slot)), entry = chosen && pokemon.get(chosen.plan.pokemonId);
        const options = chosen && !filtered.some(value => value.key === chosen.key) ? [chosen, ...filtered] : filtered;
        return <section className="workbench-slot" key={index}><div className="workbench-slot-heading"><strong>成员 {index + 1}</strong><div>
          <button className="icon-button" aria-label={'上移第' + (index + 1) + '位成员'} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button className="icon-button" aria-label={'下移第' + (index + 1) + '位成员'} disabled={busy || index === 5} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button className="icon-button" aria-label={'移除第' + (index + 1) + '位成员'} disabled={busy || !slot} onClick={() => setSlots(old => old.map((value, at) => at === index ? null : value))}><X size={16} /></button></div></div>
          <select aria-label={'工作台成员' + (index + 1)} value={key(slot)} disabled={busy} onChange={event => setSlots(old => old.map((value, at) => at === index ? choices.find(choice => choice.key === event.target.value)?.slot || null : value))}>
            <option value="">选择培养方案（空位）</option>{options.map(choice => <option key={choice.key} value={choice.key}>{choice.plan.pokemonName || pokemon.get(choice.plan.pokemonId)?.name} · {choice.plan.title} · {route(choice.plan)}</option>)}</select>
          {chosen ? <div className="workbench-member">{entry ? <PokemonImage pokemon={entry} settings={user.settings} thumbnail /> : <Users size={32} />}<div><strong>{chosen.plan.pokemonName || entry?.name}</strong><p>{route(chosen.plan)}</p><p>{setLabel(chosen.plan, 'abilities', chosen.plan.selection.ability)} · {setLabel(chosen.plan, 'natures', chosen.plan.selection.nature)} · {setLabel(chosen.plan, 'items', chosen.plan.selection.item)}</p><p>{chosen.plan.selection.moves.map(move => setLabel(chosen.plan, 'moves', move)).join(' / ')}</p></div></div> : <p className="workbench-empty">当前为空位</p>}
        </section>;
      })}</div>
      {!filtered.length && <p className="notice">当前世代或搜索条件没有可选方案。可切换规则、清空搜索，或先在单只培养中保存路线。</p>}
      <label className="team-note-editor">队伍打法笔记<textarea aria-label="工作台队伍笔记" disabled={busy} value={notes} maxLength={10000} onChange={event => setNotes(event.target.value)} /></label>
      <p className="team-workbench-help">{copy ? '副本保留配置与笔记，建立独立成员方案，培养进度从零开始。' : '独立方案加入队伍时保留进度；其他队伍成员会复制为独立方案。被替换的原成员计划保留为独立方案。'}</p>
      {error && <div className="build-errors" role="alert">{error}</div>}
      <section className="workbench-preview"><h3>保存前体检与配速预览</h3>{loading ? <p><LoaderCircle size={17} className="spin" />正在更新预览…</p> : preview ?
        <TeamAnalytics team={preview} user={user} onBattle={onBattle} /> : <p>选入成员后，显示当前阵容的共同弱点、招式打击面与速度比较。</p>}</section>
    </div><footer><span>{slots.filter(Boolean).length}/6 位成员</span><button className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="primary-button" disabled={busy || loading || !preview || !title.trim()} onClick={() => void submit()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}保存队伍</button></footer>
  </div></div>;
}
