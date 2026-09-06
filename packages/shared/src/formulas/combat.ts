/**
 * 기획서 6-3-5 — 데미지 공식 (서버 권위).
 *
 *   finalDamage =
 *     (ATK * skillCoef * comboMultiplier + flatBonus)
 *     * (1 - defReduction)          // defReduction = DEF / (DEF + 50 + 10*attackerLv)
 *     * critMultiplier              // 1.0 또는 (1.5 + critDmgBonus)
 *     * elementMultiplier           // 0.75 / 1.0 / 1.3
 *     * positionMultiplier          // 정면 1.0 / 측면 1.1 / 배후 1.25
 *     * groggyMultiplier            // 그로기 상태 1.8
 *     * (1 + dmgIncrease) * (1 - dmgReduction)
 *     * randomRange(0.95, 1.05)
 *     * contextCoef                 // PvE 1.0, PvP는 스킬별 pvpCoef
 *
 * 난수는 인자로 주입한다(roll: 0..1). 서버가 시드를 소유하고,
 * 테스트는 결정적으로 돌아야 하기 때문이다.
 */
import type { DamageBreakdown, DamageInput } from '../types/combat.js';

/** 기획서 6-3-5 positionMultiplier */
export const POSITION_MULTIPLIER = { FRONT: 1.0, SIDE: 1.1, BACK: 1.25 } as const;

/** 속성 상성 배율 */
export const ELEMENT_MULTIPLIER = { WEAK: 0.75, NEUTRAL: 1.0, STRONG: 1.3 } as const;

export const BASE_CRIT_MULTIPLIER = 1.5;

/** 방어 감소율 — 레벨이 오를수록 같은 DEF의 효율이 떨어진다 */
export function defReduction(def: number, attackerLevel: number): number {
  const d = Math.max(0, def);
  return d / (d + 50 + 10 * attackerLevel);
}

/** 0.95 ~ 1.05 난수 구간 */
export function randomRange(roll: number): number {
  return 0.95 + Math.max(0, Math.min(1, roll)) * 0.1;
}

export function computeDamage(input: DamageInput): DamageBreakdown {
  const base = input.atk * input.skillCoef * input.comboMultiplier + input.flatBonus;
  const dr = defReduction(input.def, input.attackerLevel);
  const afterDef = base * (1 - dr);

  const critMultiplier = input.isCrit ? BASE_CRIT_MULTIPLIER + input.critDmgBonus : 1.0;
  const positionMultiplier = POSITION_MULTIPLIER[input.position];
  const groggyMultiplier = input.targetGroggy ? 1.8 : 1.0;

  const final =
    afterDef *
    critMultiplier *
    input.elementMultiplier *
    positionMultiplier *
    groggyMultiplier *
    (1 + input.dmgIncrease) *
    (1 - input.dmgReduction) *
    randomRange(input.roll) *
    input.contextCoef;

  return {
    base,
    afterDef,
    final: Math.max(1, Math.round(final)),
    defReduction: dr,
    critMultiplier,
    positionMultiplier,
    groggyMultiplier,
  };
}

/** 편의 기본값 — 테스트/시뮬레이터가 필요한 필드만 덮어쓴다 */
export function damageInput(partial: Partial<DamageInput>): DamageInput {
  return {
    atk: 100,
    skillCoef: 1,
    comboMultiplier: 1,
    flatBonus: 0,
    def: 0,
    attackerLevel: 1,
    isCrit: false,
    critDmgBonus: 0,
    elementMultiplier: 1,
    position: 'FRONT',
    targetGroggy: false,
    dmgIncrease: 0,
    dmgReduction: 0,
    contextCoef: 1,
    roll: 0.5,
    ...partial,
  };
}

/** 치명타 확률 — LUK 기반. 상한 75% */
export function critRate(luk: number, bonus = 0): number {
  return Math.min(0.75, luk * 0.0022 + bonus);
}

/**
 * 기획서 6-3-5 밸런스 기준선 검증용.
 *  - 동레벨 일반 몬스터: 평균 3~5타에 사망
 *  - 필드 보스: 60~120초
 *  - 레이드 보스: 5~12분
 */
export function hitsToKill(hp: number, damagePerHit: number): number {
  return Math.ceil(hp / Math.max(1, damagePerHit));
}
