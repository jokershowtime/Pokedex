import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { AssistantSummary } from './types';

export default function AssistantTaskIndicator({ open }: { open: () => void }) {
  const [task, setTask] = useState<AssistantSummary | null>(null);
  useEffect(() => {
    let live = true;
    const unsubscribe = window.pokedex.onAssistantUpdate(value => { if (live) setTask(value); });
    void window.pokedex.team<AssistantSummary | null>('assistant-status', { summary: true }).then(value => {
      if (live) setTask(value);
    }).catch(() => {});
    return () => { live = false; unsubscribe(); };
  }, []);
  if (!task || !['running', 'cancelling'].includes(task.state)) return null;
  return <button className="assistant-task-link" onClick={open} aria-label="返回正在计算的阵容" title="返回阵容助手查看进度或取消计算">
    <LoaderCircle size={18} className="spin" /><span>{task.state === 'cancelling' ? '正在取消计算' : task.phase === 'inspection' ? '队伍伤害检查中' : '阵容计算进行中'}<small>{task.percent > 0 && task.percent < 0.01 ? '<0.01%' : task.percent.toFixed(1) + '%'}</small></span>
  </button>;
}
