import { useEffect, useState } from 'react';
import { BookOpenCheck, CloudDownload, Users } from 'lucide-react';
import type { Bootstrap, EntityKind, Pokemon, UserState } from './types';
import type { BattleSeed } from './BattlePage';
import TeamPage from './TeamPage';
import { PersonalStrategies } from './StrategyPanel';

export type CultivationRequest = { teamId?: string; token: number };
export default function CultivationPage({ data, user, catalog, request, onEntity, onPokemon, onBattle, onRecommend }: {
  data: Bootstrap; user: UserState; catalog: Pokemon[]; request: CultivationRequest;
  onEntity: (kind: EntityKind, id: number) => void; onPokemon: (id: number) => void;
  onBattle: (seed: BattleSeed) => void; onRecommend: () => void;
}) {
  const [view, setView] = useState<'teams' | 'single'>('teams');
  const [teamRequest, setTeamRequest] = useState(request);
  useEffect(() => { setTeamRequest(request); setView('teams'); }, [request]);
  const openTeam = (teamId: string) => { setTeamRequest(old => ({ teamId, token: old.token + 1 })); setView('teams'); };
  return <div className="cultivation-page">
    <div className="cultivation-heading"><div><span className="eyebrow">同一份作业，整队与单只同步培养</span><h1>我的培养</h1><p>已收藏 {user.teams.length} 支队伍 · {user.plans.length} 套培养方案</p></div><button className="secondary-button" onClick={onRecommend}><CloudDownload size={16} />推荐队伍</button></div>
    <div className="strategy-view-tabs cultivation-tabs" role="tablist" aria-label="培养视图">
      <button role="tab" aria-label="整队培养" aria-selected={view === 'teams'} className={view === 'teams' ? 'active' : ''} onClick={() => setView('teams')}><Users size={17} />整队培养 <span>{user.teams.length} 队</span></button>
      <button role="tab" aria-label="单只培养" aria-selected={view === 'single'} className={view === 'single' ? 'active' : ''} onClick={() => setView('single')}><BookOpenCheck size={17} />单只培养 <span>{user.plans.length} 套</span></button>
    </div>
    <div className="cultivation-content" role="tabpanel" aria-label={view === 'teams' ? '整队培养' : '单只培养'}>
      {view === 'teams' ? <TeamPage data={data} user={user} catalog={catalog} onEntity={onEntity} onPokemon={onPokemon} onBattle={onBattle} personalOnly request={teamRequest} /> :
        <PersonalStrategies data={data} user={user} catalog={catalog} onEntity={onEntity} onPokemon={onPokemon} onTeam={openTeam} />}
    </div>
  </div>;
}
