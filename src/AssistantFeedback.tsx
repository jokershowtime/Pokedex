import type { AssistantIssue, AssistantPreview, Pokemon, StrategyReferences, UserState } from './types';
import { PokemonImage } from './components';
const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export function AssistantConflicts({ issues, adjust }: { issues: AssistantIssue[]; adjust: () => void }) {
  if (!issues.length) return null;
  return <section className="assistant-diagnostics" aria-label="条件冲突与资料诊断"><h3>检查这些条件</h3>{issues.map((issue, index) => <article className="assistant-issue" key={index}>
    <span className={'assistant-issue-kind ' + issue.kind}>{{ conflict: '条件冲突', data: '资料不足', range: '当前范围限制', search: '组合搜索结果' }[issue.kind]}</span><strong>{issue.title}</strong>
    {issue.conditions.length > 0 && <div className="assistant-issue-conditions">{issue.conditions.map((condition, index) => <span key={index}>{condition}</span>)}</div>}
    <p>{issue.explanation}</p><ul>{issue.suggestions.map(suggestion => <li key={suggestion}>{suggestion}</li>)}</ul>
  </article>)}<button className="secondary-button" onClick={adjust}>返回调整条件</button><p className="assistant-help">建议供你手动调整，软件不会自动放宽条件；调整后仍需重新计算。</p></section>;
}
export function AssistantLivePreview({ previews, pokemon, refs, user, cancel }: {
  previews: AssistantPreview[]; pokemon: Map<number, Pokemon>; refs: StrategyReferences | null; user: UserState; cancel: () => void;
}) {
  if (!previews.length) return null;
  const label = (kind: 'abilities' | 'items' | 'natures' | 'moves', value: string) => refs?.[kind].find(entry => entry.english === value)?.name || value || '无';
  return <section className="assistant-live-preview" aria-label="计算中的队伍预览"><div className="assistant-preview-toolbar"><h2>已找到可行队伍 · 先预览 {previews.length} 队</h2><button className="secondary-button" aria-label="取消预览中的计算" onClick={cancel}>取消计算</button></div>
    <p className="assistant-help">以下队伍已满足本次全部硬条件。搜索仍在继续，成员配置、评分和排序可能更新；完成后按所选数量展示结果，再进行保存、对比或锁定重算。</p>
    <div className="assistant-preview-grid">{previews.map((preview, index) => <article className="assistant-preview-card" key={preview.key}><h3>当前预览 {index + 1}<span>{preview.score} 分</span></h3><p>打击面 {preview.metrics.coverage} · 最大共同弱点 {preview.metrics.maxWeak}</p>
      <div className="assistant-preview-members">{preview.members.map(member => { const entry = pokemon.get(member.pokemonId); return <div key={member.pokemonId}>
        {entry && <PokemonImage pokemon={entry} settings={user.settings} thumbnail />}<strong>{member.name}</strong><small>常态速度 {member.speed}</small>
      </div>; })}</div><details><summary>查看当前配招与培养数值</summary>{preview.members.map(member => <div className="assistant-preview-build" key={member.pokemonId}>
        <strong>{member.name}</strong><p>{label('abilities', member.selection.ability)} · {label('natures', member.selection.nature)} · {label('items', member.selection.item)}</p>
        <p>{member.selection.moves.map(move => label('moves', move)).join(' / ')}</p><p>努力值：{stats.map(stat => member.selection.evs[stat]).join(' / ')} · 个体值：{stats.map(stat => member.selection.ivs[stat]).join(' / ')}</p>
      </div>)}<small>数值顺序：HP／攻击／防御／特攻／特防／速度。</small></details>
    </article>)}</div></section>;
}
