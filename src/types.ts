export interface TypeInfo { id: number; name: string; generation: number }
export interface Version { id: number; name: string; generation: number; order: number; learnsetCount: number }
export interface Stat { id: number; name: string; value: number; effort: number }
export interface Ability { id: number; name: string; hidden: boolean }
export interface Pokemon {
  id: number; speciesId: number; name: string; englishName: string; identifier: string; formName: string;
  generation: number; isDefault: boolean; introducedOrder: number; height: number; weight: number;
  genus: string; genderRate: number; captureRate: number; happiness: number; hatchCounter: number;
  growthRateId: number; isLegendary: boolean; isMythical: boolean; isBaby: boolean;
  chainId: number; parentSpeciesId: number | null; images: Record<string, string>;
  types: number[]; stats: Stat[]; abilities: Ability[]; total: number; searchKey: string; aliases: string[]; available: boolean;
}
export interface Effectiveness { id: number; name: string; multiplier: number }
export interface EvolutionEdge { from: number; to: number; pokemon: Pokemon; conditions: string[]; referenceVersion: string | null }
export interface Move {
  id: number; name: string; identifier: string; generation: number; type: number; power: number | null;
  pp: number | null; accuracy: number | null; priority: number; damageClass: number; className: string;
  methodId?: number; method?: string; level?: number; machineNumber?: number | null; searchKey?: string;
}
export interface PokemonDetail extends Pokemon {
  text: string; referenceVersion: string | null; version: Version; learnset: Move[];
  learnsetReference: string | null; eggGroups: string[]; forms: Pokemon[];
  matchup: Effectiveness[]; evolution: { roots: Pokemon[]; edges: EvolutionEdge[] };
}
export interface Entity {
  id: number; name: string; identifier: string; searchKey: string; generation?: number;
  type?: number; power?: number | null; pp?: number | null; accuracy?: number | null; className?: string;
  damageClass?: number; category?: number; cost?: number;
}
export interface EntityDetail extends Entity {
  kind: EntityKind; text: string; referenceVersion: string | null;
  meta?: { drain: number; healing: number; min_hits: number | null; max_hits: number | null; crit_rate: number; ailment_chance: number; flinch_chance: number } | null;
  machineNumber?: number | null; priority?: number; image?: string; categoryName?: string;
  learners?: Pokemon[]; learnsetReference?: string | null;
}
export interface ItemScope { generation: number; indexed: boolean; notice: string }
export type EntityKind = 'moves' | 'abilities' | 'items';
export type Page = 'dex' | EntityKind | 'matchup' | 'favorites' | 'history' | 'plans' | 'teams' | 'battle' | 'settings';
export interface Settings { versionId: number; theme: 'light' | 'dark'; imageStyle: 'artwork' | 'sprite'; shortcut: string; keepOnTop: boolean; uiScale: number }
export interface UserState { favorites: number[]; history: { id: number; at: string }[]; notes: Record<string, string>; plans: StrategySet[]; teams: PokemonTeam[]; settings: Settings; shortcutAvailable?: boolean }
export interface Bootstrap {
  manifest: { speciesCount: number; pokemonCount: number; moveCount: number; abilityCount: number; itemCount: number; importedAt: string; chineseNameCount: number; imageCounts: Record<string, number> };
  versions: Version[]; types: TypeInfo[]; generations: string[]; methods: Record<string, string>;
}
export interface DesktopAPI {
  query<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  strategy<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  team<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  battle<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  backup<T>(action: string, args?: Record<string, unknown>): Promise<T>;
  user(action: string, args?: Record<string, unknown>): Promise<UserState>;
  window(action: string): Promise<boolean>;
  onUserChange(callback: (state: UserState) => void): () => void;
  onTeamUpdate(callback: (progress: TeamSync) => void): () => void;
  onNavigate(callback: (id: number) => void): () => void;
}
export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatVector = Record<StatKey, number>;
export interface StrategySelection {
  ability: string; item: string; nature: string; teraType: string; moves: string[]; evs: StatVector; ivs: StatVector; level: number;
  gender?: string; happiness?: number; shiny?: boolean;
  nickname?: string; hpType?: string; pokeball?: string; gigantamax?: boolean; dynamaxLevel?: number;
}
export interface StrategyValidation { errors: string[]; warnings: string[]; note?: string }
export interface StrategyRef { id: number; identifier: string; name: string; english: string; generation?: number | null; type?: number | null; isDefault?: boolean; increased?: number; decreased?: number; abilityIds?: number[] }
export interface StrategyReferences { pokemon: StrategyRef[]; moves: StrategyRef[]; items: StrategyRef[]; abilities: StrategyRef[]; natures: StrategyRef[]; types: StrategyRef[] }
export interface StrategySet {
  id: string; pokemonId: number; pokemonName?: string; generation: number; tier: string; format: string; formatLabel: string;
  category: string; title: string; originalTitle: string; abilityOptions: string[]; itemOptions: string[]; natureOptions: string[];
  teraOptions: string[]; moveOptions: string[][]; evSpreads: StatVector[]; ivSpreads: StatVector[]; evsSpecified: boolean;
  level: number; defaults: string[]; selection: StrategySelection;
  source: { provider: string; url: string | null; fetchedAt: string | null };
  labels?: Record<string, Record<string, { name: string; id: number | null; learning?: string[] }>>;
  learningReference?: string | null;
  validation?: StrategyValidation; personal?: boolean; originId?: string | null; notes?: string;
  progress?: Record<string, boolean>; createdAt?: string; updatedAt?: string;
  showdownSpecies?: string; teamId?: string;
  missingFields?: ('evs' | 'ivs' | 'nature')[];
}
export interface StrategyList {
  sets: StrategySet[]; formats: { id: string; label: string; category: string }[]; error: string | null;
  cache: { fetchedAt: string | null; totalSets: number; generation: number; available: boolean };
}
export interface TeamTag { id: string; label: string; origin: 'source' | 'inferred'; reason: string }
export interface TeamFormat { id: string; generation: number; tier: string; label: string; category: string }
export interface TeamFormats { formats: TeamFormat[]; tags: { id: string; label: string }[]; providers?: { id: string; name: string }[]; error: string | null; fetchedAt: string | null }
export interface PokemonTeam {
  id: string; title: string; originalName: string; author: string; generation: number; format: string; formatLabel: string; category: string;
  members: StrategySet[]; tags: TeamTag[]; roles?: string[][]; notes: string; sourceNotes: string;
  source: { provider: string; url: string | null; fetchedAt: string | null; providerId?: string; publishedAt?: string | null; pasteUrl?: string | null; sourcePage?: string | null; achievement?: string | null; ruleConfidence?: string };
  personal?: boolean; originId?: string | null; createdAt?: string; updatedAt?: string; linkedPlanIds?: string[];
  validation?: StrategyValidation;
  fingerprint?: string; aliases?: string[]; sources?: PokemonTeam['source'][];
  completeness?: { status: 'complete' | 'partial' | 'short'; members: number; label: string; missing: string[] };
}
export interface TeamList {
  teams: PokemonTeam[]; skipped: { name: string; reason: string }[]; error: string | null;
  cache: { available: boolean; fetchedAt: string | null; totalTeams: number; format: string };
}
export interface TeamSync { generation: number; state: 'idle' | 'running' | 'complete' | 'partial'; completed: number; total: number; current: string; errors: string[]; updatedAt: string | null }
export interface TeamLibrary {
  teams: PokemonTeam[]; formats: TeamFormat[]; skipped: { name: string; reason: string; provider?: string }[]; error: string | null; duplicateCount: number;
  sources: { id: string; name: string; count: number; fetchedAt?: string | null; checked?: number; remaining?: number; hasMore?: boolean }[];
  cache: { available: boolean; fetchedAt: string | null; totalTeams: number; generation: number }; sync: TeamSync;
}
export interface BattleState {
  hpPercent?: number; boosts?: Partial<StatVector>; status?: string; tailwind?: boolean; abilityOn?: boolean; teraActive?: boolean;
  dynamax?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; helpingHand?: boolean; friendGuard?: boolean;
  protected?: boolean; stealthRock?: boolean; spikes?: number; alliesFainted?: number;
}
export interface BattleFighter { pokemonId: number; showdownSpecies?: string; selection: StrategySelection; state: BattleState }
export interface BattleField { weather: string; terrain: string; gameType: string; gravity?: boolean; trickRoom?: boolean; members?: Record<string, BattleState> }
export interface BattleReferences extends StrategyReferences { generation: number; pokemon: (StrategyRef & { engineName: string; searchKey: string })[] }
export interface BattleStats {
  pokemonId: number; name: string; engineName: string; level: number; stats: StatVector; baseStats: StatVector; finalSpeed: number;
  types: { id: number; name: string }[]; ivsUsed: StatVector; warnings: string[];
}
export interface DamageMove {
  move: string; englishMove: string; type: string; category: string; min: number; max: number; minPercent: number; maxPercent: number;
  targetHP: number; currentHP: number; oneHitChance: number | null; ko: { n: number; chance: number | null; originalText: string } | null;
  rolls: number[] | null; description: string;
}
export interface DamageReport {
  generation: number; attacker: BattleStats; defender: BattleStats; results: DamageMove[];
  speed: { attacker: number; defender: number; tie: boolean; first: string }; note: string;
}
export interface TeamAnalysis {
  generation: number; level: string | number;
  members: (BattleStats & { id: string; fighter: BattleFighter; roles: string[] })[];
  defensive: { id: number; name: string; values: number[]; weak: number; resist: number; immune: number }[];
  offensive: { id: number; name: string; moves: { pokemon: string; move: string; type: string }[] }[];
  observations: { kind: string; text: string }[]; roles: string[]; speedOrder: string[]; warnings: string[]; note: string;
}
declare global { interface Window { pokedex: DesktopAPI } }
