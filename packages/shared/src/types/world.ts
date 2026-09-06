/** 기획서 10부(맵 19종) · 7~8부(직업) · 12~13부(던전/레이드) 타입 */
import type { BackgroundId, EndingId, FactionId, RoleTag, Stats } from './core.js';

export interface MapDef {
  id: string;
  index: number;
  name: string;
  /** 권장 레벨 — 진입 제한은 아니다. 기획서 1-2 ①: 레벨 제한으로 맵을 막지 않는다 */
  levelRange: [number, number];
  kind: 'TOWN' | 'FIELD' | 'DUNGEON_HUB' | 'HIDDEN' | 'ENDGAME';
  /** 지도에 없는 히든 맵 */
  hidden: boolean;
  /** 인접 맵 id — 기획서 10-0 월드 구조 그래프 */
  connections: string[];
  npcs: string[];
  monsters: string[];
  fieldBoss: string | null;
  /** 모닥불 세이브 포인트 3~6개 */
  campfires: number;
  /** 별책 PvP 기획서 4-1: 오픈월드 PK 허용 여부 */
  pk: 'NONE' | 'DUEL_ONLY' | 'FREE';
  description: string;
}

export interface ClassBranch {
  id: string;
  name: string;
  level: 20 | 40;
  parent: string | null;
  description: string;
}

export interface ClassDef {
  id: string;
  name: string;
  roles: RoleTag[];
  /** 난이도 ★1~5 */
  difficulty: 1 | 2 | 3 | 4 | 5;
  mainStats: (keyof Stats)[];
  weapons: string[];
  concept: string;
  /** 레벨업당 직업 고정 성장치 */
  growth: Partial<Stats>;
  /** 기획서 6-3-4. 패리 판정 창(ms) — 직업별로 다르다 */
  parryWindowMs: number;
  skills: string[];
  branches: ClassBranch[];
  /** 솔로 사냥 대책 — 기획서 7부 공통 규칙 */
  soloNote?: string;
}

export interface HiddenClassDef {
  id: string;
  name: string;
  /** 원 직업 */
  baseClasses: string[];
  levelReq: number;
  concept: string;
  /** 해금 조건 — UI에 어떤 힌트도 없다(기획서 8부 공통 규칙 1) */
  unlockSteps: string[];
  skills: string[];
  /** 성능 상한 105% 원칙 */
  powerCap: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  kind: 'NORMAL' | 'ELITE' | 'FIELD_BOSS' | 'DUNGEON_BOSS' | 'RAID_BOSS';
  hp: number;
  atk: number;
  def: number;
  /** 자세 게이지 최대치 (기획서 6-3-3) */
  poise: number;
  exp: number;
  gold: [number, number];
  map: string;
  dropTable: string;
}

export interface DungeonDef {
  id: string;
  name: string;
  levelRange: [number, number];
  map: string;
  players: 4;
  boss: string;
  gimmick: string;
  difficulties: ('NORMAL' | 'HARD' | 'HELL')[];
  dailyEntries: number;
}

export interface RaidDef {
  id: string;
  name: string;
  levelRange: [number, number];
  players: 8 | 16;
  boss: string;
  phases: number;
  gimmick: string;
  difficulties: ('NORMAL' | 'ELITE' | 'CHAOS')[];
  /** 주 1회 보상 */
  weeklyReward: true;
  reward?: string;
}

export interface CharacterState {
  id: string;
  nickname: string;
  background: BackgroundId;
  classId: string | null;
  hiddenClassId: string | null;
  level: number;
  exp: number;
  awakenRank: number;
  awakenPoint: number;
  stats: Stats;
  freePoints: number;
  skillPoints: number;
  mapId: string;
  gold: number;
  endingSeen: EndingId[];
  reputation: Record<FactionId, number>;
}
