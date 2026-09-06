/** 기획서 6-3-5 데미지 공식 / 6-1 성장 곡선 / 11-2 분배 / 11-3 어그로 */
import { describe, expect, it } from 'vitest';
import { MONSTERS } from '../data/registry.js';
import { computeDamage, critRate, damageInput, defReduction, hitsToKill } from './combat.js';
import {
  MAX_LEVEL,
  apForAwakenRank,
  awakenSkillSlots,
  awakenStatMultiplier,
  computeThreat,
  cumulativeExp,
  expForLevel,
  levelFactor,
  partyExpShare,
  referencePlayerAtk,
  shouldSwapTarget,
  tauntThreat,
} from './progression.js';

describe('defReduction — DEF / (DEF + 50 + 10*attackerLv)', () => {
  it('DEF 0이면 감소 없음', () => {
    expect(defReduction(0, 10)).toBe(0);
  });

  it('레벨이 높을수록 같은 DEF의 효율이 떨어진다', () => {
    expect(defReduction(150, 1)).toBeGreaterThan(defReduction(150, 50));
  });

  it('감소율은 1을 넘지 않는다', () => {
    expect(defReduction(1_000_000, 1)).toBeLessThan(1);
  });
});

describe('computeDamage — 곱연산 체인', () => {
  it('기본형: ATK 100, 계수 1.0, DEF 0 → 약 100', () => {
    const d = computeDamage(damageInput({ roll: 0.5 }));
    expect(d.final).toBe(100);
  });

  it('배후 공격은 1.25배', () => {
    const front = computeDamage(damageInput({ position: 'FRONT' })).final;
    const back = computeDamage(damageInput({ position: 'BACK' })).final;
    expect(back / front).toBeCloseTo(1.25, 2);
  });

  it('측면 공격은 1.1배', () => {
    const front = computeDamage(damageInput({ position: 'FRONT' })).final;
    const side = computeDamage(damageInput({ position: 'SIDE' })).final;
    expect(side / front).toBeCloseTo(1.1, 2);
  });

  it('그로기 상태에서는 1.8배', () => {
    const normal = computeDamage(damageInput({})).final;
    const groggy = computeDamage(damageInput({ targetGroggy: true })).final;
    expect(groggy / normal).toBeCloseTo(1.8, 2);
  });

  it('치명타는 1.5배 + 치명타 피해 보너스', () => {
    const crit = computeDamage(damageInput({ isCrit: true, critDmgBonus: 0.5 }));
    expect(crit.critMultiplier).toBe(2.0);
    expect(crit.final).toBe(200);
  });

  it('난수는 0.95~1.05 사이로만 흔든다', () => {
    const lo = computeDamage(damageInput({ roll: 0 })).final;
    const hi = computeDamage(damageInput({ roll: 1 })).final;
    expect(lo).toBe(95);
    expect(hi).toBe(105);
  });

  it('contextCoef로 PvE와 PvP를 완전히 분리한다', () => {
    const pve = computeDamage(damageInput({ contextCoef: 1.0 })).final;
    const pvp = computeDamage(damageInput({ contextCoef: 0.48 })).final;
    expect(pvp).toBeLessThan(pve);
    expect(pvp / pve).toBeCloseTo(0.48, 2);
  });

  it('최소 피해는 1 — 0이 뜨지 않는다', () => {
    const d = computeDamage(damageInput({ atk: 1, def: 100000, attackerLevel: 50 }));
    expect(d.final).toBeGreaterThanOrEqual(1);
  });

  it('밸런스 기준선: 실제 데이터의 동레벨 일반 몬스터가 3~5타에 죽는다', () => {
    // monsters.json 전체를 실제로 검사한다. 데이터가 기준선을 벗어나면 여기서 깨진다.
    const normals = MONSTERS.filter((m) => m.kind === 'NORMAL');
    expect(normals.length).toBeGreaterThan(20);

    for (const monster of normals) {
      const perHit = computeDamage(
        damageInput({
          atk: referencePlayerAtk(monster.level),
          skillCoef: 1.05,
          def: monster.def,
          attackerLevel: monster.level,
        }),
      ).final;
      const hits = hitsToKill(monster.hp, perHit);
      expect(hits, `${monster.name}(Lv${monster.level})이 ${hits}타`).toBeGreaterThanOrEqual(3);
      expect(hits, `${monster.name}(Lv${monster.level})이 ${hits}타`).toBeLessThanOrEqual(5);
    }
  });

  it('밸런스 기준선: 필드 보스는 60~120초 (초당 2타 기준)', () => {
    const bosses = MONSTERS.filter((m) => m.kind === 'FIELD_BOSS');
    for (const boss of bosses) {
      const perHit = computeDamage(
        damageInput({
          atk: referencePlayerAtk(boss.level),
          skillCoef: 1.05,
          def: boss.def,
          attackerLevel: boss.level,
        }),
      ).final;
      const seconds = boss.hp / (perHit * 2);
      expect(seconds, `${boss.name}이 ${seconds.toFixed(0)}초`).toBeGreaterThan(55);
      expect(seconds, `${boss.name}이 ${seconds.toFixed(0)}초`).toBeLessThan(130);
    }
  });
});

describe('critRate — LUK 기반', () => {
  it('LUK이 오르면 치명타 확률이 오른다', () => {
    expect(critRate(100)).toBeGreaterThan(critRate(10));
  });
  it('상한 75%', () => {
    expect(critRate(100000)).toBe(0.75);
  });
});

describe('성장 곡선 (기획서 6-1 / 14-1)', () => {
  it('EXP(n) = floor(100 * n^2.1 + 50 * n)', () => {
    expect(expForLevel(1)).toBe(150);
    expect(expForLevel(10)).toBe(Math.floor(100 * Math.pow(10, 2.1) + 500));
  });

  it('최고 레벨은 50이고, 50 이상은 더 오르지 않는다', () => {
    expect(MAX_LEVEL).toBe(50);
    expect(expForLevel(50)).toBe(Infinity);
  });

  it('누적 경험치는 단조 증가한다', () => {
    expect(cumulativeExp(30)).toBeGreaterThan(cumulativeExp(29));
  });

  it('각성 AP(n) = 10000 * n^1.35 — 후반이 완만하다', () => {
    expect(apForAwakenRank(1)).toBe(10000);
    // 등급이 10배 늘 때 필요 AP는 10^1.35배(약 22배)로, 지수 2 곡선보다 완만하다
    const ratio = apForAwakenRank(100) / apForAwakenRank(10);
    expect(ratio).toBeLessThan(30);
  });

  it('각성 등급당 모든 능력치 +0.5%, 10등급마다 슬롯 1칸', () => {
    expect(awakenStatMultiplier(100)).toBeCloseTo(1.5);
    expect(awakenSkillSlots(35)).toBe(3);
  });
});

describe('경험치 분배 (기획서 11-2) — 뭉치는 게 이득이어야 한다', () => {
  it('파티 총 경험치가 솔로보다 많다 — 4인이면 1.45배', () => {
    const solo = partyExpShare(1000, 1);
    const perMember = partyExpShare(1000, 4);
    expect(solo).toBe(1000);
    // 1인당은 나눠 갖지만, 파티 전체가 받는 총량은 솔로 1명보다 많다
    expect(perMember * 4).toBeCloseTo(1450, -1);
    expect(perMember * 4).toBeGreaterThan(solo);
  });

  it('파티원이 늘수록 1인당 경험치는 줄지만 총량은 는다', () => {
    const totals = [1, 2, 3, 4].map((n) => partyExpShare(1000, n) * n);
    for (let i = 1; i < totals.length; i += 1) {
      expect(totals[i]).toBeGreaterThan(totals[i - 1] as number);
    }
  });

  it('레벨 차가 크면 경험치가 급감한다', () => {
    expect(levelFactor(20, 20)).toBe(1);
    expect(levelFactor(30, 20)).toBeLessThan(0.6);
    expect(levelFactor(45, 20)).toBeCloseTo(0.1);
  });

  it('고렙 몬스터를 잡으면 소폭 이득 (상한 1.2)', () => {
    expect(levelFactor(20, 30)).toBe(1.2);
  });
});

describe('어그로 (기획서 11-3)', () => {
  it('탱커의 역할 계수는 3.0', () => {
    expect(computeThreat(1000, 3.0, 0)).toBe(3000);
    expect(computeThreat(1000, 1.0, 0)).toBe(1000);
  });

  it('힐량은 0.5 계수로 위협에 반영된다', () => {
    expect(computeThreat(0, 1, 1000)).toBe(500);
  });

  it('1위가 2위보다 10% 미만으로 앞서면 보스가 타겟을 흔든다', () => {
    expect(shouldSwapTarget(1050, 1000)).toBe(true);
    expect(shouldSwapTarget(1200, 1000)).toBe(false);
  });

  it('도발은 현재 1위 + 20%로 즉시 설정한다', () => {
    expect(tauntThreat(1000)).toBe(1200);
  });
});
