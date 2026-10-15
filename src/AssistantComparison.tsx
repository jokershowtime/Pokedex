import type { AssistantResult, OpponentReference, TypeInfo } from './types';
import { TypeChip } from './components';
export default function AssistantComparison({ results, selected, types, remove, view, opponents = [] }: {
  results: AssistantResult[]; selected: number[]; types: TypeInfo[]; remove: (index: number) => void; view: (index: number) => void; opponents?: OpponentReference[];
}) {
  if (selected.length < 2) return null;
  const shared = new Set(results[selected[0]].team.members.filter(member => selected.every(index =>
    results[index].team.members.some(other => other.pokemonId === member.pokemonId))).map(member => member.pokemonId));
  const typeList = (ids: number[]) => <div className="assistant-compare-types">{ids.map(id => <TypeChip key={id} id={id} types={types} small />)}</div>;
  const rows = [
    { label: '排序分数', render: (result: AssistantResult) => <strong>{result.assessment.score} 分</strong> },
    { label: '队伍成员', render: (result: AssistantResult) => <div className="assistant-compare-members">{result.team.members.map(member =>
      <span key={member.id} className={shared.has(member.pokemonId) ? 'shared' : ''}>{member.pokemonName}</span>)}</div> },
    { label: '克制的单属性目标', render: (result: AssistantResult) => typeList(result.assessment.attackTypes) },
    { label: '有人抵抗／免疫', render: (result: AssistantResult) => typeList(result.assessment.resistTypes) },
    { label: '共同弱点', render: (result: AssistantResult) => result.assessment.sharedWeaknesses.length ?
      <div className="assistant-compare-types">{result.assessment.sharedWeaknesses.map(row => <span key={row.typeId}><TypeChip id={row.typeId} types={types} small /> × {row.count}</span>)}</div> : '没有两位以上成员共同的属性弱点' },
    { label: '攻击类别', render: (result: AssistantResult) => '携带物理攻击 ' + result.assessment.physical + ' 位 · 特殊攻击 ' + result.assessment.special + ' 位' },
    { label: '常态速度（高到低）', render: (result: AssistantResult) => result.assessment.speeds.map(entry => <div key={entry.pokemonId}>{entry.name}：{entry.value}</div>) },
    { label: '功能分工', render: (result: AssistantResult) => result.assessment.roles.map(role => <div key={role.id}>{role.label} × {role.count}</div>) },
    { label: '体系联动', render: (result: AssistantResult) => result.assessment.synergies.join('、') || '未识别到预设的联动组合' },
    ...(opponents.length ? [{ label: '指定对手应对', render: (result: AssistantResult) => <>{(result.opponentMatchups || []).map((row, index) => <p key={row.targetId}>{opponents.find(value => value.targetId === row.targetId)?.name} · 路线 {index + 1}：克制 {row.attackers.length} 位 · 抗性 {row.resistors.length} 位 · 战况先手 {row.faster.length} 位</p>)}</> }] : []),
    { label: '需要留意', render: (result: AssistantResult) => result.assessment.warnings.length ? result.assessment.warnings.map(text => <p key={text}>{text}</p>) : '未发现当前结构检查项的问题' },
  ];
  return <section className="assistant-comparison" aria-label="计算队伍对比"><h3>队伍对比 · {selected.length} 队</h3>
    <p className="assistant-help">标记颜色的成员为这些队伍共同拥有的成员。速度按本次计算等级统计；同一成员可承担多个功能。</p>
    <div className="assistant-comparison-scroll" tabIndex={0} aria-label="横向浏览队伍对比"><table><thead><tr><th scope="col">比较项目</th>{selected.map(index => <th scope="col" key={index}>
      <button onClick={() => view(index)} aria-label={'定位对比队伍' + (index + 1)}>队伍 {index + 1}</button><button className="icon-button" onClick={() => remove(index)} aria-label={'移出对比队伍' + (index + 1)}>×</button>
    </th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{selected.map(index => <td key={index}>{row.render(results[index])}</td>)}</tr>)}</tbody></table></div>
  </section>;
}
