import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, ClipboardCopy, Edit3, ExternalLink, LoaderCircle, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import type { EntityKind, Pokemon, StrategyReferences, StrategySelection, StrategySet, StrategyValidation, StatKey, UserState } from './types';

export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABELS: Record<StatKey, string> = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
export function setLabel(set: StrategySet, kind: string, value: string, refs?: StrategyReferences) {
  return set.labels?.[kind]?.[value]?.name || refs?.[kind as keyof StrategyReferences]?.find(ref => ref.english === value || ref.name === value)?.name || value || '无';
}
export function emptySet(pokemon: Pokemon, refs: StrategyReferences): StrategySet {
  const ability = refs.abilities.find(ref => ref.id === pokemon.abilities[0]?.id)?.english || '';
  const evs = Object.fromEntries(STAT_KEYS.map(key => [key, 0])) as StrategySelection['evs'];
  const ivs = Object.fromEntries(STAT_KEYS.map(key => [key, 31])) as StrategySelection['ivs'];
  return { id: 'new', pokemonId: pokemon.id, pokemonName: pokemon.name, generation: Math.max(3, pokemon.generation), tier: 'custom',
    format: 'custom', formatLabel: '自定义', category: 'custom', title: `${pokemon.name} · 我的配招`, originalTitle: 'Custom set',
    abilityOptions: [ability], itemOptions: [], natureOptions: ['Serious'], teraOptions: [], moveOptions: [[], [], [], []],
    evSpreads: [evs], ivSpreads: [ivs], evsSpecified: true, level: 100, defaults: [],
    source: { provider: '自建', url: null, fetchedAt: null },
    selection: { ability, item: '', nature: 'Serious', teraType: '', moves: ['', '', '', ''], evs, ivs, level: 100 } };
}
function VectorDisplay({ title, values, dv = false }: { title: string; values: StrategySelection['evs']; dv?: boolean }) {
  return <div className="build-vector"><span className="build-field-title">{title}</span><div className="build-stat-grid">{STAT_KEYS.map(key => <div key={key}><span>{STAT_LABELS[key]}</span><b>{values[key]}</b>{dv && <small>DV {Math.floor(values[key] / 2)}</small>}</div>)}</div></div>;
}
function summary(set: StrategySet) {
  const evs = set.selection.evs;
  if (!set.evsSpecified) return '来源没有注明努力值分配，培养前请查看原文说明。';
  const offense = evs.atk > evs.spa ? '物理输出' : evs.spa > evs.atk ? '特殊输出' : '综合配置';
  if (evs.hp + evs.def + evs.spd > evs.atk + evs.spa + evs.spe) return '这套分配更侧重耐久。结合下方功能招式与队伍需要选择使用时机。';
  const alternatives = [...set.moveOptions, set.itemOptions, set.abilityOptions, set.natureOptions].some(options => options.length > 1);
  return `这套分配侧重${offense}${evs.spe >= 200 ? '与速度' : ''}。${alternatives ? '备选项属于同一条路线，可按队伍需要调整。' : '请结合队友分工使用这套配置。'}`;
}
export function StrategyCard({ source, saved, refs, onSave, onEdit, onDelete, onProgress, onEntity, notify, deleteContext }: {
  source: StrategySet; saved?: boolean; refs?: StrategyReferences;
  onSave: (set: StrategySet) => Promise<void>; onEdit: (set: StrategySet) => void; onDelete?: (id: string) => Promise<void>;
  onProgress?: (id: string, key: string, value: boolean) => Promise<void>; onEntity: (kind: EntityKind, id: number) => void; notify: (message: string) => void;
  deleteContext?: string;
}) {
  const [set, setSet] = useState(source);
  const [validation, setValidation] = useState(source.validation);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState(false);
  useEffect(() => { setSet(source); setValidation(source.validation); }, [source]);
  useEffect(() => {
    let live = true;
    window.pokedex.strategy<StrategyValidation>('validate', { set }).then(value => { if (live) setValidation(value); }).catch(error => { if (live) notify(error.message); });
    return () => { live = false; };
  }, [set.selection, set.generation]);
  const choose = (patch: Partial<StrategySelection>) => setSet(value => ({ ...value, selection: { ...value.selection, ...patch } }));
  const copy = async (language: string) => {
    try { await window.pokedex.strategy('export', { set, language }); notify(language === 'chinese' ? '整套中文配置已复制。' : 'Showdown 配招文本已复制。'); }
    catch (error) { notify((error as Error).message); }
  };
  const save = async () => { setBusy(true); try { await onSave(set); notify('已保存到我的培养。'); } catch (error) { notify((error as Error).message); } finally { setBusy(false); } };
  const toggleProgress = (key: string, value: boolean) => {
    const previous = Boolean(set.progress?.[key]);
    setSet(current => ({ ...current, progress: { ...current.progress, [key]: value } }));
    void onProgress?.(set.id, key, value).catch(error => { setSet(current => ({ ...current, progress: { ...current.progress, [key]: previous } })); notify(error.message); });
  };
  const selectField = (kind: string, value: string, alternatives: string[], field: keyof StrategySelection) => alternatives.length > 1 ?
    <select aria-label={`${set.title}的${({ abilities: '特性', items: '道具', natures: '性格', types: '太晶属性' } as Record<string, string>)[kind]}`} value={value} onChange={event => choose({ [field]: event.target.value })}>{alternatives.map(option => <option key={option} value={option}>{setLabel(set, kind, option, refs)}</option>)}</select> :
    <strong>{setLabel(set, kind, value, refs)}</strong>;
  const progressFields = [{ key: 'item', label: '道具已准备' }, { key: 'evs', label: '努力值已完成' }, { key: 'ivs', label: '个体值已确认' },
    ...(set.generation >= 3 ? [{ key: 'ability', label: '特性已确认' }, { key: 'nature', label: '性格已确认' }] : []),
    ...set.selection.moves.flatMap((move, index) => move ? [{ key: `move${index}`, label: `${setLabel(set, 'moves', move, refs)}已学会` }] : [])];
  return <article className="strategy-card"><header className="strategy-card-header"><div><div className="strategy-tags"><span>第 {set.generation} 世代</span><span>{set.formatLabel}</span>{set.personal && <span className="personal-tag">我的方案</span>}</div><h3>{set.title}</h3>{set.originalTitle && set.originalTitle !== set.title && <p>{set.originalTitle}</p>}</div><span className="strategy-origin">{set.source.provider}</span></header>
    {source.pokemonName && <div className="build-pokemon-name">{source.pokemonName}</div>}
    <p className="strategy-summary">{summary(set)}</p>
    <div className="build-main-fields">{set.generation >= 3 && <><div><span>特性</span>{selectField('abilities', set.selection.ability, set.abilityOptions, 'ability')}{set.labels?.abilities?.[set.selection.ability]?.id && <button className="build-inline-link" title="查看特性效果" aria-label="查看方案特性" onClick={() => onEntity('abilities', set.labels!.abilities[set.selection.ability].id!)}><ArrowUpRight size={13} /></button>}</div><div><span>性格</span>{selectField('natures', set.selection.nature, set.natureOptions, 'nature')}</div></>}
      <div><span>道具</span>{selectField('items', set.selection.item, set.itemOptions, 'item')}{set.labels?.items?.[set.selection.item]?.id && <button className="build-inline-link" title="查看道具用途" aria-label="查看方案道具" onClick={() => onEntity('items', set.labels!.items[set.selection.item].id!)}><ArrowUpRight size={13} /></button>}</div><div><span>等级</span><strong>{set.selection.level}</strong></div>{set.selection.teraType && <div><span>太晶属性</span>{selectField('types', set.selection.teraType, set.teraOptions, 'teraType')}</div>}</div>
    {set.evSpreads.length > 1 && <label className="spread-choice">努力值备选分配<select aria-label={`${set.title}的努力值备选分配`} value={Math.max(0, set.evSpreads.findIndex(values => JSON.stringify(values) === JSON.stringify(set.selection.evs)))} onChange={event => choose({ evs: structuredClone(set.evSpreads[Number(event.target.value)]) })}>{set.evSpreads.map((_, index) => <option key={index} value={index}>分配 {index + 1}</option>)}</select></label>}
    <VectorDisplay title="努力值" values={set.selection.evs} />
    {(set.selection.nickname || set.selection.gender || set.selection.happiness !== undefined || set.selection.hpType || set.selection.gigantamax || set.selection.dynamaxLevel !== undefined || set.selection.shiny || set.selection.pokeball) && <div className="build-extra-fields">
      {set.selection.nickname && <span>昵称：{set.selection.nickname}</span>}
      {set.selection.gender && <span>性别：{set.selection.gender === 'M' ? '雄性' : '雌性'}</span>}
      {set.selection.happiness !== undefined && <span>亲密度：{set.selection.happiness}</span>}
      {set.selection.hpType && <span>觉醒力量属性：{setLabel(set, 'types', set.selection.hpType, refs)}</span>}
      {set.selection.gigantamax && <span>超极巨化：是</span>}
      {set.selection.dynamaxLevel !== undefined && <span>极巨化等级：{set.selection.dynamaxLevel}</span>}
      {set.selection.shiny && <span>异色：是</span>}
      {set.selection.pokeball && <span>精灵球：{setLabel(set, 'items', set.selection.pokeball, refs)}</span>}
    </div>}
    {set.ivSpreads.length > 1 && <label className="spread-choice">个体值备选分配<select aria-label={`${set.title}的个体值备选分配`} onChange={event => choose({ ivs: structuredClone(set.ivSpreads[Number(event.target.value)]) })}>{set.ivSpreads.map((_, index) => <option key={index} value={index}>分配 {index + 1}</option>)}</select></label>}
    <VectorDisplay title={set.generation <= 2 ? '个体值（附原作 DV）' : '个体值'} values={set.selection.ivs} dv={set.generation <= 2} />
    <div className="build-moves"><span className="build-field-title">招式与备选</span>{set.moveOptions.map((alternatives, index) => <div key={index}><span className="move-slot">{index + 1}</span>{alternatives.length > 1 ? <select aria-label={`${set.title}的第${index + 1}招式`} value={set.selection.moves[index] || ''} onChange={event => { const moves = [...set.selection.moves]; moves[index] = event.target.value; choose({ moves }); }}>{alternatives.map(move => <option value={move} key={move}>{setLabel(set, 'moves', move, refs)}</option>)}</select> : <strong>{setLabel(set, 'moves', set.selection.moves[index], refs)}</strong>}{set.labels?.moves?.[set.selection.moves[index]]?.id && <button className="build-inline-link" title="查看招式和学习方式" aria-label={`查看${setLabel(set, 'moves', set.selection.moves[index], refs)}的学习资料`} onClick={() => onEntity('moves', set.labels!.moves[set.selection.moves[index]].id!)}><ArrowUpRight size={15} /></button>}<p className="build-move-help">学习方式：{set.labels?.moves?.[set.selection.moves[index]]?.learning?.join(" / ") || "当前版本未收录，需核对"}{set.learningReference && <span> · 参考 {set.learningReference}</span>}</p></div>)}</div>
    {set.defaults.length > 0 && <details className="source-defaults"><summary>来源默认值说明</summary>{set.defaults.map(text => <p key={text}>{text}</p>)}</details>}
    {validation && <details className={`strategy-validation ${validation.errors.length ? 'invalid' : validation.warnings.length ? 'review' : 'valid'}`}><summary><ShieldCheck size={15} />{validation.errors.length ? `${validation.errors.length} 项配置需要调整` : validation.warnings.length ? `${validation.warnings.length} 项需要核对` : '数值和当前版本记录检查通过'}</summary>{[...validation.errors, ...validation.warnings].map(message => <p key={message}>{message}</p>)}<p className="validation-note">{validation.note}</p></details>}
    {set.notes && <p className="plan-notes">{set.notes}</p>}
    {set.personal && onProgress && <div className="cultivation-progress"><span className="build-field-title">培养进度 · {progressFields.filter(field => set.progress?.[field.key]).length}/{progressFields.length}</span><div>{progressFields.map(field => <label key={field.key}><input type="checkbox" checked={Boolean(set.progress?.[field.key])} onChange={event => toggleProgress(field.key, event.target.checked)} />{field.label}</label>)}</div></div>}
    {remove && deleteContext && <p className="strategy-delete-context">{deleteContext}</p>}
    <footer className="strategy-actions"><button className="secondary-button" onClick={() => void copy('chinese')} disabled={Boolean(validation?.errors.length)}><ClipboardCopy size={15} />复制中文</button><button className="secondary-button" onClick={() => void copy('showdown')} disabled={Boolean(validation?.errors.length)}>Showdown</button><button className="secondary-button" onClick={() => onEdit(set)}><Edit3 size={14} />编辑</button>{!set.personal && <button className="primary-button" disabled={busy || saved || Boolean(validation?.errors.length)} onClick={() => void save()}>{busy ? <LoaderCircle size={14} className="spin" /> : saved ? <Check size={14} /> : <Save size={14} />}{saved ? '已收藏' : '存为我的方案'}</button>}{set.personal && onDelete && (remove ? <><button className="danger-button" disabled={busy} onClick={() => { setBusy(true); void onDelete(set.id).catch(error => notify(error.message)).finally(() => setBusy(false)); }}>确认删除</button><button disabled={busy} onClick={() => setRemove(false)}>保留</button></> : <button className="delete-plan" aria-label={`删除${set.title}`} onClick={() => setRemove(true)}><Trash2 size={14} /></button>)}</footer>
    <div className="strategy-source-footer">{set.source.url && <button onClick={() => void window.pokedex.strategy('source', { url: set.source.url }).catch(error => notify(error.message))}><ExternalLink size={12} />查看原始作业</button>}{set.source.fetchedAt && <span>{new Date(set.source.fetchedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>}</div>
  </article>;
}

export function StrategyEditor({ initial, refs, onClose, onSave, notify }: { initial: StrategySet; refs: StrategyReferences; onClose: () => void; onSave: (set: StrategySet) => Promise<void>; notify: (text: string) => void }) {
  const [draft, setDraft] = useState<StrategySet>(() => structuredClone(initial));
  const [validation, setValidation] = useState<StrategyValidation | null>(null);
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<StrategySelection>) => setDraft(value => ({ ...value, selection: { ...value.selection, ...patch } }));
  useEffect(() => { let live = true; window.pokedex.strategy<StrategyValidation>('validate', { set: draft }).then(value => { if (live) setValidation(value); }).catch(error => notify(error.message)); return () => { live = false; }; }, [draft]);
  const submit = async () => { setSaving(true); try { await onSave(draft); onClose(); notify('培养方案已保存。'); } catch (error) { notify((error as Error).message); } finally { setSaving(false); } };
  const pickerReferences = (kind: keyof StrategyReferences, value: string) => refs[kind].filter(ref => !ref.generation || ref.generation <= draft.generation).filter(ref => kind !== 'abilities' || ref.english === value || refs.pokemon.find(p => p.id === draft.pokemonId)?.abilityIds?.includes(ref.id));
  const chooser = (kind: keyof StrategyReferences, value: string, callback: (value: string) => void, label: string, empty = false) => <select aria-label={label} value={value} onChange={event => callback(event.target.value)}>{empty && <option value="">无 / 未选择</option>}{value && !refs[kind].some(ref => ref.english === value) && <option value={value}>{setLabel(initial, kind, value, refs)}</option>}{pickerReferences(kind, value).map(ref => <option key={ref.id} value={ref.english}>{ref.name}{kind === 'natures' && ref.increased !== ref.decreased ? `（${STAT_LABELS[STAT_KEYS[(ref.increased || 1) - 1]]}↑ ${STAT_LABELS[STAT_KEYS[(ref.decreased || 1) - 1]]}↓）` : ''}</option>)}</select>;
  return <div className="modal-backdrop"><div className="build-editor" role="dialog" aria-modal="true" aria-label="编辑培养方案"><header><div><span className="eyebrow">留一份自己的作业</span><h2>{initial.personal ? '编辑培养方案' : '保存为单只培养方案'}</h2></div><button className="icon-button" aria-label="关闭培养编辑器" onClick={onClose}><X size={20} /></button></header><div className="build-editor-body"><label>方案名称<input aria-label="培养方案名称" value={draft.title} maxLength={100} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label><div className="builder-form-grid"><label>世代<select aria-label="培养方案世代" value={draft.generation} onChange={event => setDraft(value => ({ ...value, generation: Number(event.target.value) }))}>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} 世代</option>)}</select></label><label>用途<select aria-label="培养方案用途" value={draft.category} onChange={event => setDraft(value => ({ ...value, category: event.target.value, formatLabel: ({ singles: '单打', doubles: '双打', pve: '通关实用', custom: '自定义' } as Record<string, string>)[event.target.value] }))}><option value="singles">单打</option><option value="doubles">双打</option><option value="pve">通关实用</option><option value="custom">自定义</option></select></label><label>等级<input type="number" aria-label="培养方案等级" min={1} max={100} value={draft.selection.level} onChange={event => update({ level: Number(event.target.value) })} /></label>{draft.generation >= 3 && <><label>特性{chooser('abilities', draft.selection.ability, value => update({ ability: value }), '培养方案特性', true)}</label><label>性格{chooser('natures', draft.selection.nature, value => update({ nature: value }), '培养方案性格')}</label></>}<label>道具{chooser('items', draft.selection.item, value => update({ item: value }), '培养方案道具', true)}</label>{draft.generation >= 9 && <label>太晶属性{chooser('types', draft.selection.teraType, value => update({ teraType: value }), '培养方案太晶属性', true)}</label>}</div>
    <section className="edit-stat-section"><h3>努力值 <span>总和 {STAT_KEYS.reduce((sum, key) => sum + draft.selection.evs[key], 0)}{draft.generation >= 3 && ' / 510'}</span></h3><div className="edit-stat-grid">{STAT_KEYS.map(key => <label key={key}>{STAT_LABELS[key]}<input type="number" aria-label={`${STAT_LABELS[key]}努力值`} min={0} max={draft.generation <= 5 ? 255 : 252} value={draft.selection.evs[key]} onChange={event => update({ evs: { ...draft.selection.evs, [key]: Number(event.target.value) } })} /></label>)}</div></section>
    <section className="edit-stat-section"><h3>个体值</h3><div className="edit-stat-grid">{STAT_KEYS.map(key => <label key={key}>{STAT_LABELS[key]}<input type="number" aria-label={`${STAT_LABELS[key]}个体值`} min={0} max={31} value={draft.selection.ivs[key]} onChange={event => update({ ivs: { ...draft.selection.ivs, [key]: Number(event.target.value) } })} /></label>)}</div>{draft.generation <= 2 && <p className="section-footnote">早期世代原作的 DV 为这里数值除以 2 后向下取整；培养时请核对原文。</p>}</section>
    <section className="edit-moves"><h3>招式</h3><div className="builder-form-grid">{Array.from({ length: 4 }, (_, index) => <label key={index}>第 {index + 1} 招式{chooser('moves', draft.selection.moves[index] || '', value => { const moves = [...draft.selection.moves]; moves[index] = value; update({ moves }); }, `培养方案第${index + 1}招式`, true)}</label>)}</div></section><label>自己的打法与备注<textarea aria-label="培养方案备注" value={draft.notes || ''} maxLength={5000} onChange={event => setDraft(value => ({ ...value, notes: event.target.value }))} placeholder="记录使用思路、队友搭配，或者为通关调整的招式…" /></label>
    {validation?.errors.length ? <div className="build-errors">{validation.errors.map(error => <p key={error}>{error}</p>)}</div> : null}{Boolean(validation?.warnings.length) && <details className="strategy-validation review"><summary>{validation!.warnings.length} 项需要核对</summary>{validation!.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}</div><footer><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => void submit()} disabled={saving || !draft.title.trim() || Boolean(validation?.errors.length)}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存培养方案</button></footer></div></div>;
}

export function ImportStrategies({ generation, onClose, notify }: { generation: number; onClose: () => void; notify: (message: string) => void }) {
  const [text, setText] = useState(''); const [gen, setGen] = useState(generation); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async () => { setBusy(true); setError(''); try { const result = await window.pokedex.strategy<{ count: number }>('import', { text, generation: gen }); onClose(); notify(`已导入 ${result.count} 套方案。`); } catch (failure) { setError((failure as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); } finally { setBusy(false); } };
  return <div className="modal-backdrop"><div className="build-editor import-editor" role="dialog" aria-modal="true" aria-label="导入配招文本"><header><h2>导入作业</h2><button className="icon-button" aria-label="关闭配招导入" onClick={onClose}><X size={20} /></button></header><div className="build-editor-body"><p className="settings-description">粘贴 Showdown 配招、工具导出的中文配置，或 Showdown JSON。多只宝可梦的文本用空行分隔。</p><label>适用世代<select aria-label="导入方案世代" value={gen} onChange={event => setGen(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => <option value={index + 1} key={index}>第 {index + 1} 世代</option>)}</select></label><textarea className="import-set-text" aria-label="配招导入文本" value={text} onChange={event => setText(event.target.value)} maxLength={120000} placeholder={'Garchomp @ Rocky Helmet\nAbility: Rough Skin\nEVs: 252 HP / 216 Def / 40 Spe\nImpish Nature\n- Earthquake\n- Dragon Tail\n- Stealth Rock\n- Spikes'} />{error && <div className="build-errors" role="alert">{error}</div>}</div><footer><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}导入为我的方案</button></footer></div></div>;
}
