import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpenCheck, Check, ClipboardCopy, CloudDownload, Database, Download, Edit3, ExternalLink, LoaderCircle, RefreshCw, Save, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import type { Bootstrap, EntityKind, Pokemon, PokemonTeam, StrategyReferences, StrategySet, TeamFormat, TeamFormats, TeamLibrary, TeamSync, UserState } from './types';
import { EmptyState, PokemonImage } from './components';
import { StrategyCard, StrategyEditor, setLabel } from './StrategyCards';
import TeamAnalytics from './TeamAnalytics';
import type { BattleSeed } from './BattlePage';
import { findSavedTeam, linkedPlans } from './cultivation-model';
import { TeamRemovalDialog, TeamTrainingStatus } from './CultivationControls';

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
const normalize = (text: string) => text.toLowerCase().replace(/[\s·・\-_'’./#]/g, '');
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const noop = async () => {};
const incomplete = (team: PokemonTeam) => team.members.some(member => Boolean(member.missingFields?.length));
const alreadySaved = (team: PokemonTeam, saved: PokemonTeam[]) => Boolean(findSavedTeam(team, saved));
const matchesTag = (team: PokemonTeam, tag: string) => tag === 'all' || (tag === 'unclassified' ? !team.tags.length : team.tags.some(value => value.id === tag));

function TeamQuality({ team }: { team: PokemonTeam }) {
  return <div className="team-quality"><span className={team.completeness?.status || 'complete'}>{team.completeness?.label || '完整培育配置'}</span>{team.source.publishedAt && <span>发表于 {new Date(team.source.publishedAt).toLocaleDateString('zh-CN')}</span>}{team.source.ruleConfidence === 'inferred' && <span title="原文未明确标注完整规则，按目录或发表时间推断；请先核对来源。">规则待核对</span>}{(team.sources?.length || 0) > 1 && <span>{team.sources!.length} 个来源收录</span>}</div>;
}
function PartialMember({ member, onEntity }: { member: StrategySet; onEntity: (kind: EntityKind, id: number) => void }) {
  const hidden = new Set(member.missingFields || []);
  const label = (kind: string, value: string) => setLabel(member, kind, value);
  const detail = (kind: EntityKind, value: string) => {
    const id = member.labels?.[kind]?.[value]?.id;
    if (id) onEntity(kind, id);
  };
  return <article className="strategy-card team-partial-member"><h3>{member.pokemonName}</h3><p className="team-partial-notice">部分培养数值未公开</p><dl><div><dt>特性</dt><dd><button onClick={() => detail('abilities', member.selection.ability)}>{label('abilities', member.selection.ability)}</button></dd></div><div><dt>道具</dt><dd><button onClick={() => detail('items', member.selection.item)}>{label('items', member.selection.item)}</button></dd></div><div><dt>性格</dt><dd>{hidden.has('nature') ? '未公开' : label('natures', member.selection.nature)}</dd></div><div><dt>等级</dt><dd>{member.selection.level}</dd></div>{member.selection.teraType && <div><dt>太晶属性</dt><dd>{label('types', member.selection.teraType)}</dd></div>}</dl><div className="team-partial-moves">{member.selection.moves.map(move => <button key={move} onClick={() => detail('moves', move)}>{label('moves', move)}<ArrowUpRight size={14} /></button>)}</div>{(['evs', 'ivs'] as const).map(key => <div className="team-partial-vector" key={key}><strong>{key === 'evs' ? '努力值' : '个体值'}</strong>{hidden.has(key) ? <span>未公开</span> : <span>{Object.values(member.selection[key]).join(' / ')}<small>HP／攻击／防御／特攻／特防／速度</small></span>}</div>)}</article>;
}

function TeamTags({ team }: { team: PokemonTeam }) {
  return <div className="team-tags">{team.tags.length ? team.tags.map(tag => <span key={tag.id} className={tag.origin} title={tag.reason}>{tag.label}<small>{tag.origin === 'inferred' ? '推断' : '原名'}</small></span>) : <span className="unclassified">未标注体系</span>}</div>;
}
function Roster({ team, pokemon, user, onChoose }: { team: PokemonTeam; pokemon: Map<number, Pokemon>; user: UserState; onChoose?: (index: number) => void }) {
  return <div className="team-roster">{team.members.map((member, index) => {
    const entry = pokemon.get(member.pokemonId);
    const content = <><span className="team-slot">{index + 1}</span>{entry ? <PokemonImage pokemon={entry} settings={user.settings} thumbnail /> : <Users size={28} />}<strong>{member.pokemonName || entry?.name}</strong><span className="team-roster-item">{setLabel(member, 'items', member.selection.item)}</span></>;
    return onChoose ? <button key={index} title={'跳到成员 ' + (index + 1) + ' 的配置'} onClick={() => onChoose(index)}>{content}</button> : <div key={index}>{content}</div>;
  })}</div>;
}
function TeamCard({ team, pokemon, user, saved, open, save, restore, cancel, manage, notify }: {
  team: PokemonTeam; pokemon: Map<number, Pokemon>; user: UserState; saved?: PokemonTeam; open: () => void;
  save: (team: PokemonTeam) => Promise<void>; restore: (id: string, memberId?: string) => Promise<void>;
  cancel: (team: PokemonTeam) => void; manage: (team: PokemonTeam) => void; notify: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const providers = [...new Set((team.sources || [team.source]).map(value => value.provider))].join(' / ');
  const collect = async () => { setBusy(true); try { await save(team); } catch (error) { notify(errorText(error)); } finally { setBusy(false); } };
  const owned = team.personal ? team : saved;
  const missing = owned ? owned.members.length - linkedPlans(owned, user).length : 0;
  const rejoin = async () => { if (!owned) return; setBusy(true); try { await restore(owned.id); } catch (error) { notify(errorText(error)); } finally { setBusy(false); } };
  return <article className="team-card"><header><div className="strategy-tags"><span>第 {team.generation} 世代</span><span>{team.formatLabel}</span><span>{team.members.length} 位成员</span></div><h2>{team.title}</h2><p>{team.author ? '作者：' + team.author : '来源未注明作者'} · {providers}</p></header><TeamQuality team={team} /><TeamTags team={team} /><Roster team={team} pokemon={pokemon} user={user} />
    {owned && <TeamTrainingStatus team={owned} user={user} />}
    <footer><button className="secondary-button" onClick={open}>{incomplete(team) ? '查看公开阵容' : '查看整队配置'} <ArrowUpRight size={15} /></button>
      {!owned ? <button className="primary-button" disabled={busy || incomplete(team) || Boolean(team.validation?.errors.length)} onClick={() => void collect()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{incomplete(team) ? '培养数值未公开' : '收藏整队'}</button> :
        <><span className="team-own-label"><Check size={15} />已收藏整队</span>{!team.personal && <button className="secondary-button" onClick={() => manage(owned)}>查看培养</button>}{missing > 0 && <button className="secondary-button" disabled={busy} onClick={() => void rejoin()}><RefreshCw size={15} />重新加入培养</button>}<button className="team-cancel-collection" disabled={busy} onClick={() => cancel(owned)}>取消收藏</button></>}
    </footer>
  </article>;
}
function TeamMetadataEditor({ team, onClose, save, notify }: { team: PokemonTeam; onClose: () => void; save: (team: PokemonTeam) => Promise<void>; notify: (text: string) => void }) {
  const [title, setTitle] = useState(team.title), [notes, setNotes] = useState(team.notes || ''), [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await save({ ...team, title, notes }); onClose(); } catch (error) { notify(errorText(error)); } finally { setBusy(false); } };
  return <div className="modal-backdrop team-editor-layer"><div className="build-editor" role="dialog" aria-modal="true" aria-label="编辑队伍笔记"><header><h2>队名与打法笔记</h2><button className="icon-button" aria-label="关闭队伍编辑" onClick={onClose}><X size={20} /></button></header><div className="build-editor-body"><label>队伍名称<input aria-label="收藏队伍名称" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label><label className="team-note-editor">自己的打法与培养备注<textarea aria-label="队伍打法笔记" maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="记录常用首发、出战组合、操作心得和培养顺序…" /></label></div><footer><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !title.trim()} onClick={() => void submit()}>保存队伍笔记</button></footer></div></div>;
}
function TeamDetail({ team, pokemon, user, refs, data, saved, back, save, restore, cancel, manage, onEntity, onPokemon, notify, onBattle }: {
  team: PokemonTeam; pokemon: Map<number, Pokemon>; user: UserState; refs: StrategyReferences | null; data: Bootstrap; saved?: PokemonTeam;
  back: () => void; save: (team: PokemonTeam) => Promise<void>; restore: (id: string, memberId?: string) => Promise<void>; cancel: (team: PokemonTeam) => void; manage: (team: PokemonTeam) => void;
  onEntity: (kind: EntityKind, id: number) => void; onPokemon: (id: number) => void; notify: (text: string) => void;
  onBattle: (seed: BattleSeed) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ index: number; set: StrategySet } | null>(null), [metadata, setMetadata] = useState(false);
  const memberNodes = useRef<(HTMLDivElement | null)[]>([]);
  const collect = async () => { setBusy(true); try { await save(team); } catch (error) { notify(errorText(error)); } finally { setBusy(false); } };
  const copy = async (language: string) => { try { await window.pokedex.team('export', { team, language }); notify(language === 'chinese' ? '完整中文队伍配置已复制。' : '整队 Showdown 文本已复制，可粘贴到队伍编辑器。'); } catch (error) { notify(errorText(error)); } };
  const progress = async (id: string, key: string, value: boolean) => { await window.pokedex.strategy('progress', { id, key, value }); };
  const editMember = async (set: StrategySet) => { if (!editing) return; await save({ ...team, members: team.members.map((member, index) => index === editing.index ? set : member) }); };
  const version = data.versions.find(value => value.id === user.settings.versionId)!;
  const partial = incomplete(team);
  const owned = team.personal ? team : saved;
  const activeIds = new Set(owned ? linkedPlans(owned, user).map(plan => plan.id) : []);
  const rejoin = async (memberId?: string) => { if (!owned) return; setBusy(true); try { await restore(owned.id, memberId); } catch (error) { notify(errorText(error)); } finally { setBusy(false); } };
  const sourceLinks = [...new Map((team.sources || [team.source]).flatMap(value => [
    { url: value.url, label: '查看队伍来源' }, { url: value.pasteUrl, label: '查看配招分享' }, { url: value.sourcePage, label: '查看来源目录' },
  ]).filter(value => value.url).map(value => [value.url, value])).values()];
  return <div className="team-detail">
    <button className="team-back" onClick={back}><ArrowLeft size={17} />返回队伍列表</button>
    <div className="team-detail-heading"><div><span className="eyebrow">{team.personal ? '我的整队作业' : partial ? '公开队单' : '来源队伍'}</span><h1>{team.title}</h1><p>第 {team.generation} 世代 · {team.formatLabel} · {team.members.length} 位成员{team.author && ' · 作者：' + team.author}</p><TeamQuality team={team} /></div><div className="team-detail-actions">{!owned && <button className="primary-button" disabled={busy || partial || Boolean(team.validation?.errors.length)} onClick={() => void collect()}><Save size={16} />收藏整队</button>}{owned && <><span className="team-own-label"><Check size={16} />已收藏整队</span>{!team.personal && <button className="secondary-button" onClick={() => manage(owned)}>查看培养</button>}{activeIds.size < owned.members.length && <button className="secondary-button" disabled={busy} onClick={() => void rejoin()}>重新加入培养</button>}<button className="secondary-button" disabled={busy} onClick={() => cancel(owned)}>取消收藏</button></>}<button className="secondary-button" disabled={partial || Boolean(team.validation?.errors.length)} onClick={() => void copy('chinese')}><ClipboardCopy size={15} />复制中文整队</button><button className="secondary-button" disabled={partial || Boolean(team.validation?.errors.length)} onClick={() => void copy('showdown')}>复制 Showdown 整队</button>{team.personal && <button className="secondary-button" onClick={() => setMetadata(true)}><Edit3 size={15} />队伍笔记</button>}</div></div>
    {owned && <TeamTrainingStatus team={owned} user={user} />}
    <p className="team-save-hint">{partial ? '来源只公开部分配置；未公开的努力值、个体值或性格会标为“未公开”。取得完整配置后，可通过导入加入培养。' : team.personal ? '成员配置与“单只培养”同步；勾选下方项目记录培养进度。' : '收藏整队后，每位成员都会加入“我的培养”，保留原队伍的完整配置。'}</p>
    {team.source.ruleConfidence === 'inferred' && <p className="notice">来源未明确标注完整规则，目前按目录或发表时间推断。请在使用前核对原帖规则。</p>}
    {team.source.achievement && <p className="team-source-record">来源记录：{team.source.achievement}</p>}
    <TeamTags team={team} /><Roster team={team} pokemon={pokemon} user={user} onChoose={index => memberNodes.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
    <section className="team-clues"><h2>体系与成员分工</h2><p>下面的分工依据当前特性、招式和数值分配整理；成员顺序沿用来源，首发与胜利路线请结合作者说明。</p>{team.tags.length > 0 && <div className="team-tag-reasons">{team.tags.map(tag => <p key={tag.id}><strong>{tag.label} · {tag.origin === 'inferred' ? '配置推断' : '原名标注'}</strong>{tag.reason}</p>)}</div>}<div className="team-roles">{team.members.map((member, index) => <div key={index}><strong>{member.pokemonName}</strong><span>{team.roles?.[index]?.join(' / ') || '配置待核对'}</span></div>)}</div></section>
    {!partial && <details className="team-analysis-disclosure"><summary><ShieldCheck size={18} />队伍体检、能力实数与培养清单<span>展开查看共同弱点、配速和剩余培养项目</span></summary><TeamAnalytics team={team} user={user} onBattle={onBattle} /></details>}
    {team.sourceNotes && <section className="team-notes"><h2>来源说明</h2><p>{team.sourceNotes}</p></section>}
    {team.notes && <section className="team-notes personal"><h2>我的打法笔记</h2><p>{team.notes}</p></section>}
    {team.validation && <details className={'team-validation ' + (team.validation.errors.length ? 'invalid' : '')}><summary>{team.validation.errors.length ? '队伍配置需要调整' : '队伍规则与检查范围'}</summary>{[...team.validation.errors, ...team.validation.warnings].map(message => <p key={message}>{message}</p>)}</details>}
    <div className="team-learning-version"><span>招式学习方式参考</span><select aria-label="队伍学习资料版本" value={user.settings.versionId} onChange={event => void window.pokedex.user('settings', { versionId: Number(event.target.value) }).catch(error => notify(errorText(error)))}>{data.versions.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select><small>当前：{version.name} · 第 {version.generation} 世代</small></div>
    <div className="team-member-grid">{team.members.map((member, index) => <div className="team-member-build" key={member.id} ref={node => { memberNodes.current[index] = node; }}><div className="team-member-tools"><span>成员 {index + 1}</span><button onClick={() => onPokemon(member.pokemonId)}>查看图鉴 <ArrowUpRight size={14} /></button>{team.personal && <button disabled={!refs || !activeIds.has(member.id)} aria-label={'编辑队伍成员' + (index + 1)} onClick={() => setEditing({ index, set: member })}><Edit3 size={14} />编辑配置</button>}</div>{member.missingFields?.length ? <PartialMember member={member} onEntity={onEntity} /> : <StrategyCard source={member} refs={refs || undefined} onSave={noop} onEdit={() => {}} onEntity={onEntity} notify={notify} onProgress={team.personal && activeIds.has(member.id) ? progress : undefined} />}{team.personal && !activeIds.has(member.id) && <p className="team-unlinked">对应的培养计划已移除，配置快照仍保留。<button disabled={busy} onClick={() => void rejoin(member.id)}>重新加入这位成员</button></p>}</div>)}</div>
    <footer className="team-detail-footer"><div>{sourceLinks.map(value => <button key={value.url} onClick={() => void window.pokedex.team('source', { url: value.url }).catch(error => notify(errorText(error)))}><ExternalLink size={15} />{value.label}</button>)}<span>{team.source.provider}{team.source.fetchedAt && ' · 获取于 ' + date(team.source.fetchedAt)}</span></div>{owned && <button className="delete-plan" onClick={() => cancel(owned)}><Trash2 size={15} />管理队伍收藏</button>}</footer>
    {editing && refs && <div className="team-editor-layer"><StrategyEditor initial={editing.set} refs={refs} onClose={() => setEditing(null)} onSave={editMember} notify={notify} /></div>}
    {metadata && <TeamMetadataEditor team={team} save={save} onClose={() => setMetadata(false)} notify={notify} />}
  </div>;
}
function ImportTeam({ initialFormat, formats, pokemon, user, save, close }: { initialFormat: string; formats: TeamFormat[]; pokemon: Map<number, Pokemon>; user: UserState; save: (team: PokemonTeam) => Promise<void>; close: () => void }) {
  const [format, setFormat] = useState(initialFormat), [text, setText] = useState(''), [title, setTitle] = useState('');
  const [preview, setPreview] = useState<PokemonTeam | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setPreview(null); setError(''); }, [format, text, title]);
  const read = async () => { setBusy(true); setError(''); try { setPreview(await window.pokedex.team<PokemonTeam>('preview', { text, title, format })); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
  const collect = async () => { if (!preview) return; setBusy(true); try { await save(preview); close(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } };
  return <div className="modal-backdrop"><div className="build-editor team-import" role="dialog" aria-modal="true" aria-label="导入完整队伍"><header><div><span className="eyebrow">把整套作业留在本地</span><h2>导入完整队伍</h2></div><button className="icon-button" disabled={busy} aria-label="关闭队伍导入" onClick={close}><X size={20} /></button></header><div className="build-editor-body"><div className="builder-form-grid"><label>适用规则<select aria-label="导入队伍规则" disabled={busy} value={format} onChange={event => setFormat(event.target.value)}>{formats.map(value => <option key={value.id} value={value.id}>第 {value.generation} 世代 · {value.label}</option>)}</select></label><label>队伍名称（可留空）<input aria-label="导入队伍名称" disabled={busy} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="留空时沿用分享队名" /></label></div><p className="team-import-help">粘贴 PokéPaste 或 VR Pastes 完整分享链接、Showdown 整队文本、中文配置或 Showdown JSON。一次导入一队，最多 6 位成员；请选择原队伍的对战规则。</p><textarea className="import-set-text" aria-label="完整队伍导入内容" disabled={busy} maxLength={120000} value={text} onChange={event => setText(event.target.value)} placeholder="https://pokepast.es/… 或六只宝可梦的配招文本（成员之间空行分隔）" />{error && <div className="build-errors" role="alert">{error}</div>}{preview && <div className="team-import-preview"><h3>{preview.title}</h3><p>{preview.formatLabel} · {preview.members.length} 位成员{preview.author && ' · 作者：' + preview.author}</p><TeamTags team={preview} /><Roster team={preview} pokemon={pokemon} user={user} /><details><summary>核对所有成员配置</summary>{preview.members.map((member, index) => <div className="team-import-member" key={index}><strong>{index + 1}. {member.pokemonName}</strong><p>特性：{setLabel(member, 'abilities', member.selection.ability)} · 性格：{setLabel(member, 'natures', member.selection.nature)} · 道具：{setLabel(member, 'items', member.selection.item)} · 等级 {member.selection.level}</p><p>{member.selection.moves.map(move => setLabel(member, 'moves', move)).join(' / ')}</p><p>努力值：{Object.values(member.selection.evs).join(' / ')} · 个体值：{Object.values(member.selection.ivs).join(' / ')}（HP／攻击／防御／特攻／特防／速度）</p></div>)}</details>{preview.sourceNotes && <details><summary>作者说明</summary><p className="team-source-text">{preview.sourceNotes}</p></details>}</div>}</div><footer><button className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="secondary-button" disabled={busy || !text.trim()} onClick={() => void read()}>{busy && !preview ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}读取并预览</button><button className="primary-button" disabled={busy || !preview || Boolean(preview.validation?.errors.length)} onClick={() => void collect()}><Save size={15} />收藏整队并加入培养</button></footer></div></div>;
}

export default function TeamPage({ data, user, catalog, onEntity, onPokemon, onBattle, personalOnly = false, request, onCultivate }: {
  data: Bootstrap; user: UserState; catalog: Pokemon[]; onEntity: (kind: EntityKind, id: number) => void; onPokemon: (id: number) => void;
  onBattle: (seed: BattleSeed) => void; personalOnly?: boolean; request?: { teamId?: string; token: number }; onCultivate?: (teamId?: string) => void;
}) {
  const currentGen = data.versions.find(version => version.id === user.settings.versionId)!.generation;
  const [view, setView] = useState<'source' | 'personal'>(personalOnly ? 'personal' : 'source'), [generation, setGeneration] = useState(currentGen);
  const [format, setFormat] = useState('all'), [mode, setMode] = useState(personalOnly ? 'all' : 'singles'), [tag, setTag] = useState('all'), [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all'), [quality, setQuality] = useState('complete');
  const [metadata, setMetadata] = useState<TeamFormats | null>(null), [response, setResponse] = useState<TeamLibrary | null>(null);
  const [personal, setPersonal] = useState<PokemonTeam[]>([]), [allPokemon, setAllPokemon] = useState(catalog), [refs, setRefs] = useState<StrategyReferences | null>(null);
  const [selected, setSelected] = useState<PokemonTeam | null>(null), [loading, setLoading] = useState(false), [importing, setImporting] = useState(false), [message, setMessage] = useState('');
  const [ownGen, setOwnGen] = useState(0), [ownFormat, setOwnFormat] = useState('all'), [count, setCount] = useState(12);
  const [deleting, setDeleting] = useState<PokemonTeam | null>(null);
  const processedRequest = useRef<number | null>(null);
  const [reload, setReload] = useState(0); const scroll = useRef<HTMLDivElement>(null); const scrollTop = useRef(0);
  useEffect(() => {
    let live = true;
    window.pokedex.team<TeamFormats>(personalOnly ? 'metadata' : 'formats').then(value => { if (live) setMetadata(value); }).catch(error => { if (live) setMessage(errorText(error)); });
    window.pokedex.strategy<StrategyReferences>('references').then(value => { if (live) setRefs(value); }).catch(error => { if (live) setMessage(errorText(error)); });
    window.pokedex.query<Pokemon[]>('catalog', { versionId: 27 }).then(value => { if (live) setAllPokemon(value); }).catch(error => { if (live) setMessage(errorText(error)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (view !== 'source') { setLoading(false); return; }
    let live = true, timer: ReturnType<typeof setTimeout> | undefined, request = 0;
    setLoading(true); setResponse(old => old?.cache.generation === generation ? old : null);
    const read = (start = false) => {
      const sequence = ++request;
      void window.pokedex.team<TeamLibrary>('browse', { generation, start }).then(value => {
        if (!live || sequence !== request) return;
        setResponse(value); setLoading(false);
        setSelected(old => old && !old.personal ? value.teams.find(team => team.id === old.id || team.aliases?.includes(old.id)) || old : old);
      }).catch(error => { if (live && sequence === request) { setMessage(errorText(error)); setLoading(false); } });
    };
    const unsubscribe = window.pokedex.onTeamUpdate(progress => {
      if (progress.generation !== generation) return;
      setResponse(old => old?.cache.generation === generation ? { ...old, sync: progress } : old);
      clearTimeout(timer); timer = setTimeout(() => read(), progress.state === 'running' ? 300 : 0);
    });
    read(true);
    return () => { live = false; clearTimeout(timer); unsubscribe(); };
  }, [reload, user.settings.versionId, view, generation]);
  useEffect(() => {
    let live = true;
    window.pokedex.team<PokemonTeam[]>('personal').then(value => {
      if (!live) return; setPersonal(value); setSelected(old => old?.personal ? value.find(team => team.id === old.id) || null : old);
    }).catch(error => { if (live) setMessage(errorText(error)); });
    return () => { live = false; };
  }, [user.teams, user.plans, user.settings.versionId]);
  useEffect(() => {
    if (!request?.teamId || processedRequest.current === request.token) return;
    const team = personal.find(value => value.id === request.teamId);
    if (!team) return;
    processedRequest.current = request.token; setView('personal'); setSelected(team);
  }, [request, personal]);
  const pokemon = useMemo(() => new Map(allPokemon.map(value => [value.id, value])), [allPokemon]);
  const formats = useMemo(() => {
    const fallback: TeamFormat[] = Array.from({ length: 9 }, (_, index) => ({ id: 'gen' + (index + 1) + 'ou', generation: index + 1, tier: 'ou', label: '单打 · OU', category: 'singles' }));
    const own: TeamFormat[] = personal.map(team => ({ id: team.format, generation: team.generation,
      tier: team.format.replace(/^gen[1-9]/, ''), label: team.formatLabel, category: team.category }));
    return [...new Map([...(metadata?.formats || fallback), ...(response?.formats || []), ...own].map(value => [value.id, value])).values()];
  }, [metadata, response?.formats, personal]);
  const importFormats = useMemo(() => {
    const map = new Map(formats.map(value => [value.id, value]));
    for (let gen = 1; gen <= 9; gen++) for (const rule of gen >= 5 ? ['ou', 'doublesou'] : ['ou']) {
      const id = 'gen' + gen + rule; if (!map.has(id)) map.set(id, { id, generation: gen, tier: rule, category: rule.includes('double') ? 'doubles' : 'singles', label: rule === 'ou' ? '单打 · OU' : '双打 · OU' });
    }
    for (const gen of [8, 9]) for (const rule of ['battlestadiumsingles', 'battlestadiumdoubles']) {
      const id = 'gen' + gen + rule; if (!map.has(id)) map.set(id, { id, generation: gen, tier: rule, category: rule.includes('double') ? 'doubles' : 'singles', label: rule.includes('double') ? '对战竞技场 · 双打' : '对战竞技场 · 单打' });
    }
    return [...map.values()].sort((a, b) => b.generation - a.generation || a.label.localeCompare(b.label, 'zh-CN'));
  }, [formats]);
  const availableFormats = formats.filter(value => value.generation === generation && (mode === 'all' || value.category === mode));
  const personalFormats = [...new Map(personal.map(team => [team.format, { id: team.format, label: '第 ' + team.generation + ' 世代 · ' + team.formatLabel }])).values()];
  const keys = useMemo(() => new Map((view === 'source' ? response?.teams || [] : personal).map(team => {
    const text = [team.title, team.originalName, team.author, team.notes, team.formatLabel, team.source.provider, ...team.tags.map(value => value.label), ...team.members.map(member => member.pokemonName + ' ' + (pokemon.get(member.pokemonId)?.englishName || member.showdownSpecies || ''))].join(' ');
    return [team.id, normalize(text) + normalize(pinyin(text, { toneType: 'none' })) + normalize(pinyin(text, { pattern: 'first', toneType: 'none' }))];
  })), [view, response?.teams, personal, pokemon]);
  const base = useMemo(() => (view === 'source' ? response?.teams || [] : personal).filter(team =>
    (mode === 'all' || team.category === mode) &&
    (view === 'source' ? ((provider === 'all' || (team.sources || [team.source]).some(value => value.providerId === provider)) &&
      (quality === 'all' || (quality === 'partial' ? incomplete(team) : team.completeness?.status === 'complete' || (!team.completeness && !incomplete(team))))) :
      ((!ownGen || team.generation === ownGen) && (ownFormat === 'all' || team.format === ownFormat))) &&
    (!query.trim() || keys.get(team.id)?.includes(normalize(query)))), [view, response?.teams, personal, mode, provider, quality, ownGen, ownFormat, query, keys]);
  const scope = useMemo(() => base.filter(team => view !== 'source' || format === 'all' || team.format === format), [base, view, format]);
  const filtered = useMemo(() => scope.filter(team => matchesTag(team, tag)), [scope, tag]);
  const tagCounts = new Map((metadata?.tags || []).map(value => [value.id, scope.filter(team => matchesTag(team, value.id)).length]));
  const unclassified = scope.filter(team => !team.tags.length).length;
  const otherRules = view === 'source' && format !== 'all' ? base.filter(team => team.format !== format && matchesTag(team, tag)).length : 0;
  const syncing = response?.sync.state === 'running';
  const hasMore = Boolean(response?.sources.some(value => (value.remaining || 0) > 0 || value.hasMore));
  useEffect(() => { setCount(12); }, [view, generation, format, tag, query, ownGen, ownFormat, mode, provider, quality]);
  useEffect(() => { if (selected) scroll.current?.scrollTo({ top: 0, behavior: 'instant' }); }, [selected?.id]);
  const save = async (team: PokemonTeam) => {
    const result = await window.pokedex.team<UserState>('save', { team });
    const saved = result.teams.find(value => alreadySaved(team, [value]));
    const all = await window.pokedex.team<PokemonTeam[]>('personal'); setPersonal(all);
    if ((selected || importing) && saved) {
      if (!personalOnly && onCultivate) onCultivate(saved.id);
      else { setSelected(all.find(value => value.id === saved.id) || null); setView('personal'); }
    }
    setMessage(team.personal ? '队伍修改已保存，已有培养计划保持同步。' : '整队已收藏，成员已加入“我的培养”。');
  };
  const remove = async (id: string, deletePlans: boolean) => {
    await window.pokedex.team('delete', { id, deletePlans });
    setSelected(old => old?.personal && old.id === id ? null : old);
    setMessage(deletePlans ? '队伍收藏及对应培养计划已删除。' : '已取消队伍收藏，成员配置与进度已保留为独立方案。');
  };
  const restore = async (id: string, memberId?: string) => {
    await window.pokedex.team('restore', { id, ...(memberId ? { memberId } : {}) });
    setMessage(memberId ? '这位成员已重新加入培养，沿用保存的配置与进度。' : '缺少的成员已重新加入培养，已有成员的配置与进度保持同步。');
  };
  const manage = (team: PokemonTeam) => {
    if (!personalOnly && onCultivate) onCultivate(team.id);
    else { setView('personal'); setSelected(personal.find(value => value.id === team.id) || team); }
  };
  const open = (team: PokemonTeam) => { scrollTop.current = scroll.current?.scrollTop || 0; setSelected(team); scroll.current?.scrollTo({ top: 0 }); };
  const back = () => { setSelected(null); requestAnimationFrame(() => scroll.current?.scrollTo({ top: scrollTop.current })); };
  const pick = (gen: number, category: string) => { setGeneration(gen); setMode(category); setFormat('all'); setTag('all'); setSelected(null); };
  const switchView = (value: 'source' | 'personal') => { setView(value); setSelected(null); setQuery(''); setTag('all'); setMode(value === 'source' ? 'singles' : 'all'); setOwnFormat('all'); };
  const sync = async (more: boolean) => {
    try {
      const progress = await window.pokedex.team<TeamSync>('sync', { generation, refresh: !more, more });
      setResponse(old => old?.cache.generation === generation ? { ...old, sync: progress } : old); setReload(value => value + 1);
    } catch (error) { setMessage(errorText(error)); }
  };
  return <div className={"utility-page team-page" + (personalOnly ? " cultivation-team-page" : "")} ref={scroll}>{personalOnly ? <div className="cultivation-section-toolbar"><p>{selected ? '成员配置、培养进度与队伍笔记' : '收藏与培养进度分别显示；可恢复缺少的成员计划，或取消收藏。'}</p><button className="primary-button" onClick={() => setImporting(true)}><Download size={16} />导入完整队伍</button></div> : <div className="page-heading"><div><span className="eyebrow">{personalOnly ? '按队伍组织自己的作业' : '整套体系，一起抄作业'}</span><h1>{personalOnly ? '整队培养' : '队伍推荐'} <span className="count-pill">{view === 'personal' ? personal.length : response?.teams.length || 0} 队</span></h1><p>{personalOnly ? '收藏与培养进度分别显示；成员计划移除后，可保留队伍作业或重新加入培养。' : '同世代跨规则浏览，核对原队伍规则后收藏培养。'}</p></div><button className="primary-button" onClick={() => setImporting(true)}><Download size={16} />导入完整队伍</button></div>}
    {!personalOnly && <div className="strategy-view-tabs team-view-tabs"><button className={view === 'source' ? 'active' : ''} onClick={() => switchView('source')}><CloudDownload size={17} />推荐队伍</button><button className={view === 'personal' ? 'active' : ''} onClick={() => onCultivate ? onCultivate() : switchView('personal')}><BookOpenCheck size={17} />我的队伍 {personal.length}</button></div>}
    {message && <div className="strategy-message team-message" role="status">{message}<button onClick={() => setMessage('')}>关闭</button></div>}
    {selected ? <TeamDetail key={selected.id} team={selected} pokemon={pokemon} user={user} refs={refs} data={data} saved={findSavedTeam(selected, user.teams)} back={back} save={save} restore={restore} cancel={setDeleting} manage={manage} onEntity={onEntity} onPokemon={onPokemon} notify={setMessage} onBattle={onBattle} /> : <>
      <div className="team-filter-toolbar">{view === 'source' ? <><label>来源世代<select aria-label="队伍来源世代" value={generation} onChange={event => pick(Number(event.target.value), mode)}>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} 世代</option>)}</select></label><label>单打／双打<select aria-label="队伍玩法筛选" value={mode} onChange={event => pick(generation, event.target.value)}><option value="all">全部玩法</option><option value="singles">单打</option><option value="doubles">双打</option></select></label><label className="team-format-select">适用规则<select aria-label="推荐队伍规则" value={format} onChange={event => { setFormat(event.target.value); setTag('all'); }}><option value="all">本世代全部{mode === 'singles' ? '单打' : mode === 'doubles' ? '双打' : ''}规则</option>{availableFormats.map(value => <option key={value.id} value={value.id}>{value.label}（{base.filter(team => team.format === value.id).length}）</option>)}</select></label><button className="secondary-button" disabled={loading || syncing} onClick={() => void sync(false)}><RefreshCw size={15} className={syncing ? 'spin' : ''} />{syncing ? '同步中…' : '联网更新'}</button><button className="secondary-button" disabled={loading || syncing || !hasMore} onClick={() => void sync(true)}><CloudDownload size={15} />继续收录精选</button></> : <><label>世代<select aria-label="收藏队伍世代" value={ownGen} onChange={event => setOwnGen(Number(event.target.value))}><option value={0}>全部世代</option>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} 世代</option>)}</select></label><label>单打／双打<select aria-label="队伍玩法筛选" value={mode} onChange={event => setMode(event.target.value)}><option value="all">全部玩法</option><option value="singles">单打</option><option value="doubles">双打</option></select></label><label className="team-format-select">适用规则<select aria-label="收藏队伍规则" value={ownFormat} onChange={event => setOwnFormat(event.target.value)}><option value="all">全部规则</option>{personalFormats.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label></>}</div>
      <div className="team-search-row"><div className="dictionary-search"><Search size={18} /><input aria-label="搜索队伍或成员" value={query} onChange={event => setQuery(event.target.value)} placeholder="队名、作者、宝可梦中文名／拼音，或打法笔记…" />{query && <button className="icon-button" aria-label="清空队伍搜索" onClick={() => setQuery('')}><X size={16} /></button>}</div><select aria-label="队伍体系筛选" value={tag} onChange={event => setTag(event.target.value)}><option value="all">全部体系（{scope.length}）</option>{metadata?.tags.map(value => <option key={value.id} value={value.id} disabled={!tagCounts.get(value.id)}>{value.label}（{tagCounts.get(value.id) || 0}）</option>)}<option value="unclassified" disabled={!unclassified}>未标注体系（{unclassified}）</option></select></div>
      {view === 'source' && <><div className="team-source-filters"><label>队伍来源<select aria-label="队伍来源筛选" value={provider} onChange={event => { setProvider(event.target.value); setTag('all'); }}><option value="all">全部来源</option>{(response?.sources || metadata?.providers || []).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label>配置范围<select aria-label="队伍配置完整度" value={quality} onChange={event => { setQuality(event.target.value); setTag('all'); }}><option value="complete">完整培育配置</option><option value="all">全部公开阵容</option><option value="partial">培养数值未公开</option></select></label></div><div className="team-cache">{response?.cache.available ? <span><Database size={15} />已缓存 {response.cache.totalTeams} 支队伍 · {date(response.cache.fetchedAt!)}</span> : <span>首次获取需要联网，之后支持离线查看。</span>}<span>体系标签标明“原名”或“推断”{Boolean(response?.duplicateCount) && ' · 已合并 ' + response!.duplicateCount + ' 支重复队伍'}</span></div><div className="team-source-counts">{response?.sources.map(value => <span key={value.id}>{value.name}<strong>{value.count} 队</strong>{Boolean(value.remaining) && <small>目录待检查 {value.remaining} 条</small>}</span>)}</div>{response?.sync.state !== 'idle' && response?.sync && <div className="team-sync" role="status">{syncing && <LoaderCircle size={16} className="spin" />}<span>{response.sync.current}</span><span>{response.sync.completed} / {response.sync.total}</span>{syncing && <progress value={response.sync.completed} max={Math.max(1, response.sync.total)} />}</div>}{Boolean(response?.sync.errors.length) && <details className="team-skipped"><summary>部分来源同步失败，已有缓存仍可使用</summary>{response!.sync.errors.map((value, index) => <p key={index}>{value}</p>)}</details>}</>}
      {view === 'source' && metadata?.error && <div className="notice" role="status">{metadata.error}</div>}
      {view === 'source' && Boolean(response?.skipped.length) && <details className="team-skipped"><summary>{response!.skipped.length} 个来源条目未收录</summary>{response!.skipped.map((value, index) => <p key={index}>{value.provider && value.provider + ' · '}{value.name}：{value.reason}</p>)}</details>}
      {loading && !response && view === 'source' ? <div className="strategy-loading"><LoaderCircle className="spin" /><p>正在读取队伍库…</p><span>本地缓存先显示，联网队伍随后加入。</span></div> : filtered.length ? <><p className="team-result-count">{filtered.length} 支队伍符合条件{view === 'source' && format === 'all' && ' · 使用前请核对各队的原规则'}</p><div className="team-grid">{filtered.slice(0, count).map(team => <TeamCard key={team.id} team={team} pokemon={pokemon} user={user} saved={findSavedTeam(team, user.teams)} open={() => open(team)} save={save} restore={restore} cancel={setDeleting} manage={manage} notify={setMessage} />)}</div>{filtered.length > count && <button className="secondary-button load-more-strategies" onClick={() => setCount(value => value + 12)}>显示更多队伍</button>}</> : <EmptyState title={view === 'personal' && !personal.length ? '还没有收藏整队作业' : syncing ? '正在补充本世代队伍' : '没有符合条件的队伍'} description={view === 'personal' && !personal.length ? '收藏推荐队伍，或导入别人分享的完整阵容。' : '可以放宽规则与配置范围，或继续收录其他公开队伍。'} action={<div className="team-empty-actions">{otherRules > 0 && <button className="primary-button" onClick={() => setFormat('all')}>查看其他规则的同体系队伍（{otherRules}）</button>}<button className="secondary-button" onClick={() => { setTag('all'); setQuery(''); setProvider('all'); setOwnGen(0); setOwnFormat('all'); setFormat('all'); }}>清除筛选</button>{view === 'source' && <button className="secondary-button" disabled={syncing || !hasMore} onClick={() => void sync(true)}>继续收录精选</button>}</div>} />}
      {view === 'source' && <p className="section-footnote team-footnote">来源：Smogon 样例队伍、Team Showcase、RMT Archive 和 Victory Road 公开队伍。精选来源分批收录，可继续加载；历史队伍保留原规则、作者与出处，配置完整不代表符合当前赛事规则。<button onClick={() => void window.pokedex.team('source', { url: 'https://pkmn.github.io/smogon/data/teams/' }).catch(error => setMessage(errorText(error)))}>来源说明 <ExternalLink size={12} /></button></p>}
    </>}
    {deleting && <TeamRemovalDialog team={deleting} user={user} close={() => setDeleting(null)} remove={remove} notify={setMessage} />}
    {importing && <ImportTeam initialFormat={selected?.format || (format !== 'all' ? format : 'gen' + generation + (mode === 'doubles' ? 'doublesou' : 'ou'))} formats={importFormats} pokemon={pokemon} user={user} save={save} close={() => setImporting(false)} />}
  </div>;
}
