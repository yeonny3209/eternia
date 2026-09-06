/**
 * 기획서 6-4-6 — 강화 / 재련 / 각인 / 계승.
 *
 * 강화 +0 ~ +20
 *  - +1~+9   : 실패해도 유지
 *  - +10~+15 : 실패 시 수치 -1
 *  - +16~+20 : 실패 시 파괴 (보호권 사용 가능)
 *  - 확률은 **서버 시드**로만 계산한다. 클라이언트는 결과만 받는다.
 */
import type { ItemInstance } from '../types/item.js';
import type { Rng } from './affix.js';

export const MAX_ENHANCE = 20;

/** 강화 단계별 성공 확률 — index 0 = +0에서 +1 시도 */
export const ENHANCE_RATES: number[] = [
  0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, // +1 ~ +10
  0.45, 0.4, 0.35, 0.3, 0.27, 0.24, 0.2, 0.16, 0.12, 0.08, // +11 ~ +20
];

export type EnhanceRisk = 'SAFE' | 'DOWNGRADE' | 'DESTROY';

/** 단계별 실패 위험 */
export function enhanceRisk(current: number): EnhanceRisk {
  if (current < 9) return 'SAFE';
  if (current < 15) return 'DOWNGRADE';
  return 'DESTROY';
}

export function enhanceRate(current: number): number {
  return ENHANCE_RATES[current] ?? 0;
}

/** 강화 1회 비용(골드) — 골드 싱크(기획서 6-4-8) */
export function enhanceCost(current: number, itemLevel: number): number {
  return Math.floor(500 + Math.pow(current + 1, 2.4) * 120 + itemLevel * 45);
}

export type EnhanceOutcome = 'SUCCESS' | 'KEEP' | 'DOWNGRADE' | 'DESTROYED' | 'PROTECTED' | 'MAXED';

export interface EnhanceResult {
  outcome: EnhanceOutcome;
  item: ItemInstance | null;
  from: number;
  to: number;
  /** 보호권을 소모했는가 */
  protectionConsumed: boolean;
  rate: number;
}

/**
 * 강화 시도. rng는 서버 시드에서 나온 것이어야 한다.
 * @param useProtection 보호권 사용 여부(+16 이상 파괴 방지)
 */
export function tryEnhance(
  item: ItemInstance,
  rng: Rng,
  useProtection = false,
): EnhanceResult {
  const from = item.enhanceLevel;
  if (from >= MAX_ENHANCE) {
    return { outcome: 'MAXED', item, from, to: from, protectionConsumed: false, rate: 0 };
  }

  const rate = enhanceRate(from);
  const roll = rng();

  if (roll < rate) {
    return {
      outcome: 'SUCCESS',
      item: { ...item, enhanceLevel: from + 1 },
      from,
      to: from + 1,
      protectionConsumed: false,
      rate,
    };
  }

  const risk = enhanceRisk(from);
  if (risk === 'SAFE') {
    return { outcome: 'KEEP', item, from, to: from, protectionConsumed: false, rate };
  }
  if (risk === 'DOWNGRADE') {
    const to = Math.max(0, from - 1);
    return {
      outcome: 'DOWNGRADE',
      item: { ...item, enhanceLevel: to },
      from,
      to,
      protectionConsumed: false,
      rate,
    };
  }
  if (useProtection) {
    return { outcome: 'PROTECTED', item, from, to: from, protectionConsumed: true, rate };
  }
  return { outcome: 'DESTROYED', item: null, from, to: 0, protectionConsumed: false, rate };
}

/** 강화 수치에 따른 기본 스탯 배율 — +20이 약 2배가 되도록 */
export function enhanceMultiplier(level: number): number {
  return 1 + level * 0.05;
}

/**
 * 계승 — 상위 장비에 하위 장비의 강화 수치를 옮긴다(재료 손실 30%).
 * "지금까지 강화한 게 아깝다"는 이탈 요인을 제거하기 위한 장치다.
 */
export function inherit(source: ItemInstance, target: ItemInstance): ItemInstance {
  const transferred = Math.floor(source.enhanceLevel * 0.7);
  return { ...target, enhanceLevel: Math.max(target.enhanceLevel, transferred) };
}

/* ------------------------------------------------------------------ */
/* 각인(Engraving) — 신화 등급 전용. 캐릭터 단위 합산 상한이 선택을 강제한다 */
/* ------------------------------------------------------------------ */

export const MAX_ENGRAVINGS_PER_ITEM = 3;
/** 캐릭터 단위 총 각인 포인트 상한 */
export const ENGRAVING_POINT_CAP = 15;

export interface Engraving {
  id: string;
  name: string;
  /** 소모 포인트 */
  points: number;
  description: string;
}

export function engravingPointsUsed(engravings: Engraving[]): number {
  return engravings.reduce((sum, e) => sum + e.points, 0);
}

export function canAddEngraving(current: Engraving[], next: Engraving): boolean {
  if (current.length >= MAX_ENGRAVINGS_PER_ITEM) return false;
  return engravingPointsUsed(current) + next.points <= ENGRAVING_POINT_CAP;
}
