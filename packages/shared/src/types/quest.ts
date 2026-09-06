/** 기획서 9부 — 퀘스트 시스템 타입 */

/** 기획서 9-1. 퀘스트 5종 분류 */
export type QuestType = 'MAIN' | 'SUB' | 'DAILY' | 'WORLD' | 'HIDDEN';

/** 기획서 9-2. objective 타입 10종 */
export const OBJECTIVE_TYPES = [
  'KILL',
  'COLLECT',
  'TALK',
  'REACH',
  'ESCORT',
  'DEFEND',
  'USE',
  'CRAFT',
  'SURVIVE',
  'CHOICE',
] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

export interface QuestObjective {
  type: ObjectiveType;
  /** 대상 id — mob_/item_/npc_/poi_ 접두사. validate-data.ts가 참조 무결성을 검사한다 */
  target?: string;
  count?: number;
  /** SURVIVE / DEFEND용 지속 시간(ms) */
  durationMs?: number;
  /** CHOICE용 선택지 */
  choices?: string[];
  description?: string;
}

export interface QuestRewards {
  exp: number;
  gold: number;
  items?: [itemId: string, count: number][];
  skillPoint?: number;
  /** 세력 평판 */
  reputation?: { faction: string; amount: number };
}

export interface QuestFlags {
  repeatable: boolean;
  shareable: boolean;
  autoTrack: boolean;
  /** 일일 05:00 / 주간 월요일 05:00 초기화 */
  reset?: 'DAILY' | 'WEEKLY';
}

export interface QuestDef {
  id: string;
  type: QuestType;
  title: string;
  map: string;
  level: number;
  giver: string | null;
  prerequisites: string[];
  objectives: QuestObjective[];
  rewards: QuestRewards;
  flags: QuestFlags;
  /**
   * 기획서 9-3. 히든 퀘스트는 퀘스트 로그에 등록되지 않는다.
   * 트리거는 명시적 대화가 아니라 '행동'이다.
   */
  hiddenTrigger?: HiddenTrigger;
  /** 히든 직업 해금 단계와 연결 */
  unlocksHiddenClass?: string;
  summary?: string;
}

/**
 * 기획서 9-3 / 8부. 히든 트리거 — 서버가 조용히 추적한다.
 * 클라이언트에 절대 노출하지 않는다.
 */
export interface HiddenTrigger {
  kind:
    | 'TIME_OF_DAY'
    | 'INTERACT_SEQUENCE'
    | 'NO_KILL_CLEAR'
    | 'NO_SKILL_KILL'
    | 'STEALTH_PASS'
    | 'REPEAT_VISIT'
    | 'DEATH_COUNT'
    | 'IDLE_IN_ZONE'
    | 'WEATHER'
    | 'ITEM_HELD'
    | 'CUMULATIVE_STAT';
  /** 조건 파라미터. kind별로 해석이 다르다 */
  params: Record<string, string | number | boolean | string[]>;
  /** 이 트리거가 히든 진행의 몇 단계인가 */
  step: number;
}

export type QuestState = 'AVAILABLE' | 'ACTIVE' | 'COMPLETE' | 'TURNED_IN' | 'LOCKED';

export interface ObjectiveProgress {
  index: number;
  current: number;
  required: number;
  done: boolean;
}

export interface QuestProgress {
  questId: string;
  state: QuestState;
  objectives: ObjectiveProgress[];
  choiceMade?: string;
  completedAt?: number;
  resetAt?: number;
}

/** 퀘스트 엔진이 소비하는 게임 이벤트 */
export type GameEvent =
  | { type: 'KILL'; target: string; count?: number }
  | { type: 'COLLECT'; target: string; count?: number }
  | { type: 'TALK'; target: string }
  | { type: 'REACH'; target: string }
  | { type: 'ESCORT'; target: string }
  | { type: 'DEFEND'; target: string }
  | { type: 'USE'; target: string }
  | { type: 'CRAFT'; target: string; count?: number }
  | { type: 'SURVIVE'; target: string; durationMs: number }
  | { type: 'CHOICE'; target: string; choice: string };
