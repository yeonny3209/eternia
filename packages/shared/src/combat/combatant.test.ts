/**
 * Combatant 통합 테스트 — 기획서 M1의 "손맛"을 코드로 고정한다.
 *
 * 여기서 검증하는 것은 셋이다.
 *  1. 제때 회피하면 정말로 안 맞는다 (서버 타임스탬프 기준)
 *  2. 제때 가드하면 패리가 되고, 늦으면 그냥 막는다
 *  3. 자세를 무너뜨리면 확실히 더 아프다
 */
import { describe, expect, it } from 'vitest';
import { Combatant, type IncomingHit } from './combatant.js';
import { SKILL_BY_ID } from '../data/registry.js';
import type { SkillDef } from '../types/combat.js';

const slash = SKILL_BY_ID.get('sk_sw_slash') as SkillDef;
const execution = SKILL_BY_ID.get('sk_sw_execution') as SkillDef;

function makePlayer(overrides: Partial<ConstructorParameters<typeof Combatant>[0]> = {}) {
  return new Combatant({
    id: 'p1',
    name: '검사',
    level: 20,
    maxHp: 2000,
    maxMp: 300,
    atk: 260,
    def: 80,
    critRate: 0.1,
    critDmgBonus: 0,
    radius: 0.5,
    moveSpeed: 5,
    parryWindowMs: 250,
    faction: 'PLAYER',
    ...overrides,
  });
}

function hit(overrides: Partial<IncomingHit> = {}): IncomingHit {
  return {
    attackerId: 'e1',
    attackerLevel: 20,
    attackerAtk: 300,
    skillCoef: 1.0,
    comboIndex: 0,
    poiseDamage: 0,
    position: 'FRONT',
    isCrit: false,
    critDmgBonus: 0,
    elementMultiplier: 1,
    contextCoef: 1,
    roll: 0.5,
    hitTimeMs: 1000,
    ...overrides,
  };
}

describe('회피 — 무적 프레임은 서버 타임스탬프로만 판정한다', () => {
  it('회피 직후 0.3초 안의 히트는 무효', () => {
    const p = makePlayer();
    p.tryDodge(1000);
    const outcome = p.takeHit(hit({ hitTimeMs: 1150 }));
    expect(outcome.verdict).toBe('IFRAME');
    expect(outcome.damage).toBe(0);
    expect(p.hp).toBe(2000);
  });

  it('무적이 끝난 뒤의 히트는 들어간다', () => {
    const p = makePlayer();
    p.tryDodge(1000);
    const outcome = p.takeHit(hit({ hitTimeMs: 1400 }));
    expect(outcome.verdict).toBe('DAMAGED');
    expect(p.hp).toBeLessThan(2000);
  });

  it('되감기 판정: 늦게 도착한 히트도 원래 시각으로 평가된다', () => {
    const p = makePlayer();
    p.tryDodge(1000);
    // 서버가 200ms 되감아 "이 히트는 사실 1100ms에 성립했다"고 판정한 경우
    expect(p.takeHit(hit({ hitTimeMs: 1100 })).verdict).toBe('IFRAME');
  });

  it('회피는 조준 방향으로 이동시킨다', () => {
    const p = makePlayer();
    p.aim = 0;
    const before = p.pos.x;
    p.tryDodge(1000);
    expect(p.pos.x).toBeGreaterThan(before);
  });

  it('스킬 선딜 중에는 회피할 수 없다', () => {
    const p = makePlayer();
    p.useSkill(execution, 1000); // cancelable: false, 선딜 520ms
    p.update(100, 1100);
    expect(p.tryDodge(1100)).toBe(false);
  });

  it('후딜 중에는 회피로 캔슬할 수 있다', () => {
    const p = makePlayer();
    p.useSkill(execution, 1000);
    p.update(800, 1800); // 선딜 520 + 판정 180 → 후딜
    expect(p.action.currentPhase).toBe('RECOVERY');
    expect(p.tryDodge(1800)).toBe(true);
  });
});

describe('가드 / 패리', () => {
  it('판정 창 안에 맞으면 패리 — 피해 0', () => {
    const p = makePlayer();
    p.startGuard(1000);
    const outcome = p.takeHit(hit({ hitTimeMs: 1200 }));
    expect(outcome.verdict).toBe('PARRIED');
    expect(p.hp).toBe(2000);
  });

  it('판정 창을 놓치면 가드 — 70% 감소', () => {
    const guarded = makePlayer();
    guarded.startGuard(1000);
    const blocked = guarded.takeHit(hit({ hitTimeMs: 1500 }));

    const bare = makePlayer();
    const raw = bare.takeHit(hit({ hitTimeMs: 1500 }));

    expect(blocked.verdict).toBe('BLOCKED');
    expect(blocked.damage / raw.damage).toBeCloseTo(0.3, 1);
  });

  it('패리당한 쪽은 자세가 크게 깎인다', () => {
    const attacker = makePlayer({ id: 'e1' });
    const before = attacker.poise.current;
    attacker.sufferParry(1200);
    expect(attacker.poise.current).toBeLessThan(before);
  });

  it('배후 공격은 가드로 막을 수 없다', () => {
    const p = makePlayer();
    p.startGuard(1000);
    expect(p.takeHit(hit({ hitTimeMs: 1100, position: 'BACK' })).verdict).toBe('DAMAGED');
  });
});

describe('자세 붕괴 — 그로기를 잡으면 확실히 더 아프다', () => {
  it('자세 게이지가 0이 되면 그로기, 이후 피해가 1.8배', () => {
    const p = makePlayer();
    const normal = p.takeHit(hit({ hitTimeMs: 1000 })).damage;

    // 자세를 무너뜨린다
    const broke = p.takeHit(hit({ hitTimeMs: 1100, poiseDamage: 100 }));
    expect(broke.groggyBroke).toBe(true);
    expect(p.poise.isGroggy(1100)).toBe(true);

    const groggyHit = p.takeHit(hit({ hitTimeMs: 1200 })).damage;
    expect(groggyHit / normal).toBeCloseTo(1.8, 1);
  });

  it('그로기에 들어가면 시전 중이던 행동이 끊긴다', () => {
    const p = makePlayer();
    p.useSkill(execution, 1000);
    p.update(100, 1100);
    expect(p.action.currentPhase).toBe('STARTUP');
    p.takeHit(hit({ hitTimeMs: 1100, poiseDamage: 100 }));
    expect(p.action.currentPhase).toBe('IDLE');
  });

  it('그로기 중에는 스킬을 쓸 수 없다', () => {
    const p = makePlayer();
    p.takeHit(hit({ hitTimeMs: 1000, poiseDamage: 100 }));
    expect(p.canUse(slash, 1100)).toBe(false);
  });

  it('가드에 성공하면 자세 피해가 줄어든다', () => {
    const guarded = makePlayer();
    guarded.startGuard(1000);
    guarded.takeHit(hit({ hitTimeMs: 1500, poiseDamage: 50 })); // BLOCK

    const bare = makePlayer();
    bare.takeHit(hit({ hitTimeMs: 1500, poiseDamage: 50 }));

    expect(guarded.poise.current).toBeGreaterThan(bare.poise.current);
  });
});

describe('스킬 사용과 쿨타임', () => {
  it('MP가 부족하면 쓸 수 없다', () => {
    const p = makePlayer({ maxMp: 10 });
    expect(p.canUse(execution, 1000)).toBe(false);
  });

  it('쿨타임 중에는 재사용할 수 없다', () => {
    const p = makePlayer();
    p.useSkill(execution, 1000);
    p.update(1400, 2400); // 행동 종료
    expect(p.canUse(execution, 2400)).toBe(false);
    expect(p.cooldownRemaining('sk_sw_execution', 2400)).toBeGreaterThan(0);
    expect(p.canUse(execution, 13100)).toBe(true);
  });

  it('기본 공격은 콤보 인덱스가 올라간다', () => {
    const p = makePlayer();
    expect(p.useSkill(slash, 1000)).toBe(0);
    p.update(500, 1500);
    expect(p.useSkill(slash, 1300)).toBe(1);
  });

  it('사망하면 더 이상 피해를 받지 않는다', () => {
    const p = makePlayer({ maxHp: 10 });
    expect(p.takeHit(hit({ hitTimeMs: 1000 })).verdict).toBe('DEAD');
    expect(p.alive).toBe(false);
    expect(p.takeHit(hit({ hitTimeMs: 1100 })).damage).toBe(0);
  });
});

describe('이동', () => {
  it('선딜·판정 중에는 이동할 수 없다', () => {
    const p = makePlayer();
    p.useSkill(execution, 1000);
    p.update(100, 1100);
    const before = { ...p.pos };
    p.move({ x: 1, y: 0 }, 100);
    expect(p.pos).toEqual(before);
  });

  it('가드 중에는 느리게 움직인다', () => {
    const normal = makePlayer();
    normal.move({ x: 1, y: 0 }, 1000);

    const guarding = makePlayer();
    guarding.startGuard(1000);
    guarding.move({ x: 1, y: 0 }, 1000);

    expect(guarding.pos.x).toBeLessThan(normal.pos.x);
  });
});
