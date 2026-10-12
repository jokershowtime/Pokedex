import { useState } from 'react';
import { Archive, Download, FolderOpen, LoaderCircle, X } from 'lucide-react';
import { SectionTitle } from './components';
interface BackupResult { canceled?: boolean; path?: string; token?: string; recovery?: string; summary?: { exportedAt: string | null; favorites: number; history: number; notes: number; plans: number; teams: number } }
const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
export default function BackupPanel() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [preview, setPreview] = useState<BackupResult | null>(null);
  const exportBackup = async () => {
    setBusy(true); setMessage('');
    try { const result = await window.pokedex.backup<BackupResult>('export'); if (!result.canceled) setMessage('备份已保存：' + result.path); }
    catch (failure) { setMessage(errorText(failure)); } finally { setBusy(false); }
  };
  const chooseBackup = async () => {
    setBusy(true); setMessage(''); setPreview(null);
    try { const result = await window.pokedex.backup<BackupResult>('preview'); if (!result.canceled) setPreview(result); }
    catch (failure) { setMessage(errorText(failure)); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!preview?.token) return; setBusy(true); setMessage('');
    try { const result = await window.pokedex.backup<BackupResult>('restore', { token: preview.token }); setPreview(null); setMessage('个人资料已恢复。恢复前的数据副本：' + result.recovery); }
    catch (failure) { setMessage(errorText(failure)); } finally { setBusy(false); }
  };
  return <section className="utility-card backup-card"><SectionTitle title="备份与恢复" right={<Archive size={20} />} /><p className="settings-description">把收藏、查询记录、笔记、队伍和培养进度保存为一个文件，换电脑时可以继续使用。来源缓存可重新下载。</p><div className="backup-actions"><button className="primary-button" disabled={busy} onClick={() => void exportBackup()}><Download size={16} />导出个人资料备份</button><button className="secondary-button" disabled={busy} onClick={() => void chooseBackup()}><FolderOpen size={16} />选择备份恢复</button>{busy && <LoaderCircle size={17} className="spin" />}</div>{message && <p className="backup-message" role="status">{message}</p>}{preview?.summary && <div className="backup-preview"><header><strong>确认这份备份</strong><button className="icon-button" aria-label="取消备份恢复" disabled={busy} onClick={() => setPreview(null)}><X size={17} /></button></header><div className="backup-counts">{[{ key: 'favorites', name: '收藏' }, { key: 'notes', name: '笔记' }, { key: 'plans', name: '培养方案' }, { key: 'teams', name: '队伍' }].map(value => <div key={value.key}><b>{preview.summary![value.key as keyof NonNullable<BackupResult['summary']>]}</b><span>{value.name}</span></div>)}</div><p>恢复后，个人资料会使用备份中的内容。本机显示、规则版本和快捷键设置保留；恢复前的资料会自动保存副本。</p><button className="primary-button" disabled={busy} onClick={() => void restore()}>确认恢复并保留当前数据副本</button></div>}</section>;
}
