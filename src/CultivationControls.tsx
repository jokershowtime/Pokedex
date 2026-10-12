import { useState } from 'react';
import { BookOpenCheck, Check, LoaderCircle, Trash2, X } from 'lucide-react';
import type { PokemonTeam, UserState } from './types';
import { linkedPlans, planComplete } from './cultivation-model';

export function TeamTrainingStatus({ team, user }: { team: PokemonTeam; user: UserState }) {
  const plans = linkedPlans(team, user), completed = plans.filter(planComplete).length;
  return <div className="team-training-status" data-linked={plans.length} data-total={team.members.length}>
    <span><BookOpenCheck size={15} />队伍已收藏</span><strong>培养计划 {plans.length}/{team.members.length}</strong>
    <span><Check size={15} />培养完成 {completed}/{team.members.length}</span>
    {plans.length === 0 && <p>成员培养计划已移除，队伍配置与笔记仍保留。</p>}
  </div>;
}

export function TeamRemovalDialog({ team, user, close, remove, notify }: {
  team: PokemonTeam; user: UserState; close: () => void; remove: (id: string, deletePlans: boolean) => Promise<void>; notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const count = linkedPlans(team, user).length;
  const submit = async (deletePlans: boolean) => {
    setBusy(true);
    try { await remove(team.id, deletePlans); close(); }
    catch (error) { notify((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop team-editor-layer"><div className="build-editor team-removal-dialog" role="dialog" aria-modal="true" aria-label="管理队伍收藏">
    <header><h2>管理队伍收藏</h2><button className="icon-button" disabled={busy} aria-label="关闭队伍收藏管理" onClick={close}><X size={20} /></button></header>
    <div className="build-editor-body"><h3>{team.title}</h3><p>当前有 {count} 位成员的培养计划。以下操作都会移除这支收藏队伍及其队伍笔记。</p>
      <button className="team-removal-choice" aria-label="取消收藏，保留培养方案" disabled={busy} onClick={() => void submit(false)}><BookOpenCheck size={20} /><span><strong>取消收藏，保留培养方案</strong><small>保留现有 {count} 套成员配置与进度，归入单只培养的独立方案。</small></span></button>
      <button className="team-removal-choice destructive" aria-label="删除整队及培养方案" disabled={busy} onClick={() => void submit(true)}><Trash2 size={20} /><span><strong>删除整队及培养方案</strong><small>同时删除这支队伍的 {count} 套成员计划，其他队伍和独立方案保留。</small></span></button>
    </div><footer>{busy && <LoaderCircle size={16} className="spin" />}<button className="secondary-button" disabled={busy} onClick={close}>保留队伍</button></footer>
  </div></div>;
}
