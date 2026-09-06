/** 기획서 4-1 / 4-3 — 캐릭터 생성과 시작 배경 보너스. */
import { FREE_POINTS_PER_LEVEL, SKILL_POINTS_PER_LEVEL, type BackgroundId, type Stats } from '@eternia/shared';
import type { CharacterRecord } from '../db/repository.js';

/** 기획서 4-3. 시작 배경 5종 */
export const BACKGROUND_BONUSES: Record<
  BackgroundId,
  { name: string; stats: Partial<Stats>; gold: number; note: string }
> = {
  fallen_noble: {
    name: '몰락 귀족',
    stats: { int: 2 },
    gold: 900,
    note: '시작 골드 3배. 일부 NPC가 우호적',
  },
  border_mercenary: {
    name: '국경 용병',
    stats: { str: 2, vit: 1 },
    gold: 300,
    note: '전투 NPC 대사 분기',
  },
  rift_survivor: {
    name: '균열 생존자',
    stats: { wil: 3 },
    gold: 300,
    note: '균열 관련 히든 단서 1개 선공개',
  },
  guild_apprentice: {
    name: '조합 견습생',
    stats: {},
    gold: 300,
    note: '제작 숙련도 +10%. 연금술사/제작 유리',
  },
  nameless_orphan: {
    name: '이름 없는 고아',
    stats: { luk: 3 },
    gold: 300,
    note: '히든 직업 조건 일부가 완화됨',
  },
};

/** 1레벨 기본 스탯 */
const BASE_STATS: Stats = { str: 5, agi: 5, int: 5, vit: 5, wil: 5, luk: 5 };

export interface NewCharacterInput {
  accountId: string;
  nickname: string;
  nicknameKey: string;
  background: BackgroundId;
}

/**
 * 시작 캐릭터를 만든다.
 *
 * 기획서 4-1의 의도적 설계: **직업을 처음에 고르게 하지 않는다.**
 * 튜토리얼에서 무기 4종을 체험시킨 뒤 5레벨에 결정하게 한다.
 * 그래서 classId는 null로 시작한다.
 */
export function buildStartingCharacter(
  input: NewCharacterInput,
): Omit<CharacterRecord, 'id' | 'createdAt'> {
  const background = BACKGROUND_BONUSES[input.background];
  const stats: Stats = { ...BASE_STATS };
  for (const [key, value] of Object.entries(background.stats)) {
    stats[key as keyof Stats] += value as number;
  }

  return {
    accountId: input.accountId,
    nickname: input.nickname,
    nicknameKey: input.nicknameKey,
    nicknameChangedAt: null,
    nicknameFreeUsed: false,
    background: input.background,
    classId: null, // 5레벨에 결정한다
    hiddenClassId: null,
    level: 1,
    exp: 0,
    awakenRank: 0,
    awakenPoint: 0,
    stats,
    freePoints: FREE_POINTS_PER_LEVEL,
    skillPoints: SKILL_POINTS_PER_LEVEL,
    mapId: 'dawnhollow',
    gold: background.gold,
  };
}
