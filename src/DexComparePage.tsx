import { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, LoaderCircle } from 'lucide-react';
import type { Bootstrap, DexComparison, EntityKind, LearnedMove, Pokemon, UserState } from './types';
import { EmptyState, PokemonImage, TypeChip } from './components';
import ReferencePicker, { searchText } from './ReferencePicker';
import { LearningNotice, learningMethod } from './LearningInfo';
import { dexError } from './DiscoveryPage';
export default function DexComparePage({ data, user, catalog, ids, update, onPokemon, onEntity }: {
  data: Bootstrap; user: UserState; catalog: Pokemon[]; ids: number[]; update: (values: number[]) => void;
  onPokemon: (id: number) => void; onEntity: (kind: EntityKind, id: number) => void;
}) {
  const [report, setReport] = useState<DexComparison | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('base'), [moveMode, setMoveMode] = useState('common'), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const version = data.versions.find(value => value.id === user.settings.versionId)!;
  const options = useMemo(() => catalog.map(pokemon => ({ id: pokemon.id, name: pokemon.name + (pokemon.formName ? ' · ' + pokemon.formName : ''), searchKey: pokemon.searchKey, subtitle: '#' + pokemon.speciesId })), [catalog]);
  useEffect(() => {
    let live = true; setReport(null); setError(''); setPage(0);
    if (ids.length < 2) { setLoading(false); return; }
    setLoading(true);
    void window.pokedex.query<DexComparison>('compare', { ids, versionId: version.id }).then(value => { if (live) setReport(value); })
      .catch(failure => { if (live) setError(dexError(failure)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [ids.join(','), version.id]);
  const columns = report?.columns || [];
  const allMoves = [...new Map(columns.flatMap(column => column.moves).map(move => [move.id, move])).values()].sort((a, b) => a.id - b.id);
  const unique = new Set(report?.unique.flat() || []);
  const filteredMoves = allMoves.filter(move => (moveMode === 'all' || moveMode === 'common' && report?.common.includes(move.id) || moveMode === 'unique' && unique.has(move.id)) &&
    (!query || searchText(move.name + move.identifier).includes(searchText(query)) || String(move.id) === searchText(query)));
  const methodText = (move?: LearnedMove) => move ? move.methods.map(method => learningMethod(method, version.generation)).join(' / ') : '没有学习记录';
  const header = <tr><th>比较项目</th>{columns.map(column => <th key={column.pokemon.id}><PokemonImage pokemon={column.pokemon} settings={user.settings} thumbnail /><button className="dex-link" onClick={() => onPokemon(column.pokemon.id)}>{column.pokemon.name}{column.pokemon.formName && ' · ' + column.pokemon.formName}</button><small>#{column.pokemon.speciesId}</small><button className="secondary-button" aria-label={'移出对比' + column.pokemon.name + column.pokemon.formName} onClick={() => update(ids.filter(id => id !== column.pokemon.id))}>移除</button></th>)}</tr>;
  return <div className="utility-page dex-tools-page dex-compare-page" style={{ '--dex-columns': ids.length } as React.CSSProperties}><div className="page-heading"><div><span className="eyebrow">把伙伴放在一起看</span><h1><GitCompareArrows size={25} />宝可梦并排对比</h1><p>比较 2–4 只宝可梦的基础资料、属性抗性与招式学习记录。</p></div><div className="version-picker"><span>资料版本</span><select aria-label="对比资料版本" value={version.id} onChange={event => void window.pokedex.user('settings', { versionId: Number(event.target.value) }).catch(failure => setError(dexError(failure)))}>{data.versions.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div></div>
    <section className="dex-tool-card"><ReferencePicker label="对比宝可梦" entries={options} selected={ids} limit={4} update={update} /><p className="dex-help">也可以在宝可梦详情或反查结果点击“加入对比”。切换版本时，只保留该资料版本已经登场的成员与形态。</p></section>
    {error && <div className="build-errors" role="alert">{error}</div>}
    {loading && <div className="dex-loading" role="status"><LoaderCircle className="spin" />正在整理对比资料…</div>}
    {!loading && ids.length < 2 && <EmptyState title="至少选择两只宝可梦" description="还可以添加不同形态，比较同一物种的变化。" />}
    {report && <><div className="dex-tool-tabs" role="tablist" aria-label="宝可梦对比内容">{[['base', '基础资料'], ['defense', '弱点与抗性'], ['moves', '招式学习对比']].map(([id, label]) => <button role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'base' && <section className="dex-tool-card"><div className="dex-table-scroll" tabIndex={0} aria-label="横向浏览宝可梦基础对比"><table className="dex-comparison-table"><thead>{header}</thead><tbody>
        <tr><th>属性</th>{columns.map(column => <td key={column.pokemon.id}><div className="dex-type-list">{column.pokemon.types.map(id => <TypeChip key={id} id={id} types={data.types} small />)}</div></td>)}</tr>
        <tr><th>特性</th>{columns.map(column => <td key={column.pokemon.id}>{column.pokemon.abilities.length ? column.pokemon.abilities.map(ability => <p key={ability.id + ':' + ability.hidden}><button className="dex-link" onClick={() => onEntity('abilities', ability.id)}>{ability.name}</button>{ability.hidden && <small>隐藏特性</small>}</p>) : '当前世代没有特性'}</td>)}</tr>
        {columns[0].pokemon.stats.map(stat => <tr key={stat.id}><th>{stat.name}种族值</th>{columns.map(column => {
          const value = column.pokemon.stats.find(value => value.id === stat.id)?.value, max = Math.max(...columns.map(column => column.pokemon.stats.find(value => value.id === stat.id)?.value || 0));
          return <td key={column.pokemon.id} className={value === max ? 'dex-best' : ''}>{value ?? '—'}</td>;
        })}</tr>)}
        <tr><th>种族值总和</th>{columns.map(column => <td key={column.pokemon.id} className={column.pokemon.total === Math.max(...columns.map(value => value.pokemon.total)) ? 'dex-best' : ''}>{column.pokemon.total}</td>)}</tr>
        <tr><th>身高／体重</th>{columns.map(column => <td key={column.pokemon.id}>{column.pokemon.height.toFixed(1)} m / {column.pokemon.weight.toFixed(1)} kg</td>)}</tr>
      </tbody></table></div><p className="dex-help">高亮表示当前所选成员中该项最高，采用本次资料世代的种族值。种族值不等于实际能力或综合强度。</p></section>}
      {tab === 'defense' && <section className="dex-tool-card"><div className="dex-table-scroll" tabIndex={0} aria-label="横向浏览宝可梦抗性对比"><table className="dex-comparison-table"><thead>{header}</thead><tbody>{columns[0].matchup.map(type => <tr key={type.id}><th><TypeChip id={type.id} types={data.types} small /></th>{columns.map(column => {
        const multiplier = column.matchup.find(value => value.id === type.id)?.multiplier ?? 1;
        return <td key={column.pokemon.id} className={multiplier > 1 ? 'dex-weak' : multiplier < 1 ? 'dex-best' : ''}>{multiplier === 0 ? '免疫' : '×' + multiplier}</td>;
      })}</tr>)}</tbody></table></div><p className="dex-help">防御倍率只按当前世代的属性相性叠加，特性、道具和战况另行影响实际承伤。</p></section>}
      {tab === 'moves' && <section className="dex-tool-card"><LearningNotice source={report.learning} unknown={columns.filter(column => !column.recorded).length} />
        <div className="dex-filter-grid"><label>显示范围<select aria-label="对比招式显示范围" value={moveMode} onChange={event => { setMoveMode(event.target.value); setPage(0); }}><option value="common" disabled={!report.complete}>共同招式（{report.common.length}）</option><option value="unique" disabled={!report.complete}>仅一位成员有记录的招式（{unique.size}）</option><option value="all">全部已记录招式（{allMoves.length}）</option></select></label><label>查找招式<input aria-label="搜索对比招式" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="中文、英文或编号" /></label></div>
        {!report.complete && <p className="dex-help">成员学习资料不完整，暂不判断共同或独有招式。可以切到“全部已记录招式”查看已有记录。</p>}
        {filteredMoves.length ? <div className="dex-table-scroll" tabIndex={0} aria-label="横向浏览招式学习对比"><table className="dex-comparison-table"><thead>{header}</thead><tbody>{filteredMoves.slice(page * 40, (page + 1) * 40).map(move => <tr key={move.id}><th><button className="dex-link" onClick={() => onEntity('moves', move.id)}>{move.name}</button></th>{columns.map(column => <td key={column.pokemon.id}>{methodText(column.moves.find(value => value.id === move.id))}</td>)}</tr>)}</tbody></table></div> : <EmptyState title="当前显示范围没有已确认的招式" />}
        {filteredMoves.length > 40 && <div className="dex-pagination"><button className="secondary-button" disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(filteredMoves.length / 40)} 页 · {filteredMoves.length} 个招式</span><button className="secondary-button" disabled={(page + 1) * 40 >= filteredMoves.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
        <p className="dex-help">“仅一位有记录”限当前所选成员及所用学习表，资料不全时不会判定独有。</p>
      </section>}
    </>}
  </div>;
}
