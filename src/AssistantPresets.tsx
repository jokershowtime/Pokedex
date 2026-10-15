import { useState } from 'react';
import type { AssistantPreset, TeamConditions } from './types';
export default function AssistantPresets({ presets, conditions, disabled, apply }: {
  presets: AssistantPreset[]; conditions: TeamConditions; disabled: boolean; apply: (conditions: TeamConditions) => void;
}) {
  const [selected, setSelected] = useState(''), [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const current = presets.find(value => value.id === selected);
  const save = async (update: boolean) => {
    setBusy(true); setMessage('');
    try {
      const saved = await window.pokedex.team<AssistantPreset>('assistant-preset-save', { preset: { id: update ? current?.id : undefined, title, conditions } });
      setSelected(saved.id); setTitle(saved.title); setMessage('已保存条件模板：' + saved.title);
    } catch (error) { setMessage((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!current) return; setBusy(true); setMessage('');
    try { await window.pokedex.team('assistant-preset-delete', { id: current.id }); setSelected(''); setTitle(''); setMessage('条件模板已删除。'); }
    catch (error) { setMessage((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { setBusy(false); }
  };
  return <section className="assistant-section assistant-presets"><h2>常用条件模板</h2><fieldset disabled={disabled || busy}>
    <div className="assistant-form-grid"><label>已保存的模板<select aria-label="常用条件模板" value={current?.id || ''} onChange={event => {
      setSelected(event.target.value); setTitle(presets.find(value => value.id === event.target.value)?.title || ''); setMessage('');
    }}><option value="">选择模板</option>{presets.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label>
      <label>模板名称<input aria-label="条件模板名称" value={title} maxLength={60} onChange={event => setTitle(event.target.value)} placeholder="例如：雨天双打" /></label></div>
    <div className="assistant-result-tools"><button className="secondary-button" disabled={!current} onClick={() => { if (current) { apply(current.conditions); setMessage('已应用：' + current.title + '。可检查条件后计算。'); } }}>应用模板</button>
      <button className="secondary-button" disabled={!title.trim()} onClick={() => void save(false)}>保存为新模板</button>
      <button className="secondary-button" disabled={!current || !title.trim()} onClick={() => void save(true)}>更新所选模板</button>
      <button className="secondary-button" disabled={!current} onClick={() => void remove()}>删除所选模板</button></div>
    </fieldset><p className="assistant-help">最多保存 30 个模板，包含你填写的筛选条件；配置锁定仅用于当前队伍的重算。</p>{message && <p className="assistant-help" role="status">{message}</p>}</section>;
}
