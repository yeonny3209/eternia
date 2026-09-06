/**
 * 기획서 6-3-2 ②③ / 6-3-3 / 6-3-4 —
 * 선딜·판정·후딜 상태 머신, 회피 무적 프레임, 자세 붕괴, 가드/패리.
 */
import { describe, expect, it } from 'vitest';
import { ActionStateMachine, ComboTracker, comboMultiplier } from './actionState.js';
import { DEFAULT_STAMINA, StaminaController } from './stamina.js';
import { PVE_POISE, PVP_POISE, PoiseGauge } from './poise.js';
import { GuardController } from './guard.js';

const frames = { startupMs: 200, activeMs: 100, recoveryMs: 300 };

describe('ActionStateMachine — 선딜 / 판정 / 후딜', () => {
  it('선딜 → 판정 → 후딜 → IDLE 순으로 진행한다', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'sk', frames });
    expect(m.currentPhase).toBe('STARTUP');

    m.update(150);
    expect(m.currentPhase).toBe('STARTUP');

    const active = m.update(100); // 총 250ms → 판정 진입
    expect(m.currentPhase).toBe('ACTIVE');
    expect(active.activeStarted).toBe(true);

    m.update(150); // 총 400ms → 후딜
    expect(m.currentPhase).toBe('RECOVERY');

    const done = m.update(300); // 총 700ms → 종료
    expect(m.currentPhase).toBe('IDLE');
    expect(done.finished).toBe(true);
  });

  it('한 틱(33ms)보다 짧은 프레임도 판정을 건너뛰지 않는다', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'fast', frames: { startupMs: 5, activeMs: 5, recoveryMs: 5 } });
    const snap = m.update(33);
    expect(snap.activeStarted).toBe(true);
    expect(snap.finished).toBe(true);
    expect(m.currentPhase).toBe('IDLE');
  });

  it('선딜 중에는 회피로 캔슬할 수 없다', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'sk', frames });
    m.update(50);
    expect(m.canCancel('DODGE')).toBe(false);
    expect(m.cancel('DODGE')).toBe(false);
  });

  it('cancelable: true 스킬은 선딜 중 회피 캔슬이 가능하다', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'sk', frames: { ...frames, cancelable: true } });
    m.update(50);
    expect(m.canCancel('DODGE')).toBe(true);
    expect(m.cancel('DODGE')).toBe(true);
    expect(m.currentPhase).toBe('IDLE');
  });

  it('판정(ACTIVE) 중에는 어떤 캔슬도 불가능하다', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'sk', frames: { ...frames, cancelable: true } });
    m.update(250);
    expect(m.currentPhase).toBe('ACTIVE');
    expect(m.canCancel('DODGE')).toBe(false);
    expect(m.canCancel('SKILL')).toBe(false);
  });

  it('후딜은 회피·스킬·가드로 캔슬 가능하다 — 콤보 설계의 핵심', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'sk', frames });
    m.update(350); // 후딜 진입
    expect(m.currentPhase).toBe('RECOVERY');
    expect(m.canCancel('DODGE')).toBe(true);
    expect(m.canCancel('SKILL')).toBe(true);
    expect(m.canCancel('GUARD')).toBe(true);
  });

  it('행동 중에는 새 행동을 시작할 수 없다 (후딜 제외)', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'a', frames });
    m.update(50);
    expect(m.start({ id: 'b', frames })).toBe(false);
    m.update(400); // 후딜
    expect(m.start({ id: 'b', frames })).toBe(true);
    expect(m.currentActionId).toBe('b');
  });

  it('그로기·스턴은 interrupt로 무조건 끊는다', () => {
    const m = new ActionStateMachine();
    m.start({ id: 'sk', frames });
    m.update(250); // ACTIVE — 캔슬 불가 구간
    m.interrupt();
    expect(m.currentPhase).toBe('IDLE');
  });
});

describe('ComboTracker — 기본 공격 1~3타', () => {
  it('콤보 창 안에서 누르면 다음 타로 이어진다', () => {
    const c = new ComboTracker(3, 450);
    expect(c.next(0)).toBe(0);
    expect(c.next(300)).toBe(1);
    expect(c.next(600)).toBe(2);
    expect(c.next(900)).toBe(0); // 3타 후 1타로 순환
  });

  it('콤보 창을 놓치면 1타로 돌아간다', () => {
    const c = new ComboTracker(3, 450);
    c.next(0);
    c.next(300);
    expect(c.next(1500)).toBe(0);
  });

  it('3타째가 가장 세다', () => {
    expect(comboMultiplier(2)).toBeGreaterThan(comboMultiplier(1));
    expect(comboMultiplier(1)).toBeGreaterThan(comboMultiplier(0));
  });
});

describe('StaminaController — 회피는 자원이다', () => {
  it('회피 1회당 25 소모', () => {
    const s = new StaminaController();
    s.dodge(1000);
    expect(s.value).toBe(75);
  });

  it('스태미나가 부족하면 회피할 수 없다', () => {
    const s = new StaminaController();
    for (let i = 0; i < 4; i += 1) s.dodge(1000 + i * 700);
    expect(s.value).toBe(0);
    expect(s.canDodge(5000).reason).toBe('NOT_ENOUGH_STAMINA');
  });

  it('무적 구간은 [t, t+300ms] — 서버 타임스탬프로만 판정한다', () => {
    const s = new StaminaController();
    const result = s.dodge(1000);
    expect(result.window).toEqual({ startMs: 1000, endMs: 1300 });
    expect(s.wasInvulnerableAt(1000)).toBe(true);
    expect(s.wasInvulnerableAt(1299)).toBe(true);
    expect(s.wasInvulnerableAt(1300)).toBe(false);
    expect(s.wasInvulnerableAt(999)).toBe(false);
  });

  it('되감기 판정 — 과거 시각을 물어봐도 정확히 답한다', () => {
    const s = new StaminaController();
    s.dodge(1000);
    s.dodge(2000);
    // 현재 시각이 2500이어도 1100 시점의 무적 여부를 답할 수 있어야 한다
    expect(s.wasInvulnerableAt(1100)).toBe(true);
    expect(s.wasInvulnerableAt(1500)).toBe(false);
    expect(s.wasInvulnerableAt(2100)).toBe(true);
  });

  it('연속 4회 회피 후에는 잠깐 무방비가 된다 — 무한 회피 방지', () => {
    const s = new StaminaController({ ...DEFAULT_STAMINA, max: 200 });
    let t = 1000;
    for (let i = 0; i < 4; i += 1) {
      expect(s.dodge(t).ok).toBe(true);
      t += 700; // chainWindowMs(1200) 안이므로 연속으로 센다
    }
    expect(s.isVulnerable(t)).toBe(true);
    expect(s.canDodge(t).reason).toBe('VULNERABLE');
  });

  it('회복은 지연 후에 시작되고, 전투 중에는 더 느리다', () => {
    const s = new StaminaController();
    s.dodge(0);
    s.update(300, 300, false); // regenDelayMs(350) 이전 → 회복 없음
    expect(s.value).toBe(75);

    s.update(1000, 1400, false); // 비전투 20/s
    const outOfCombat = s.value;
    expect(outOfCombat).toBeGreaterThan(75);

    const s2 = new StaminaController();
    s2.dodge(0);
    s2.update(1000, 1400, true); // 전투 중 12/s
    expect(s2.value).toBeLessThan(outOfCombat);
  });
});

describe('PoiseGauge — 자세 붕괴(그로기)', () => {
  it('게이지가 0이 되면 그로기, 받는 피해가 1.8배', () => {
    const p = new PoiseGauge();
    expect(p.damage(60, 1000).broke).toBe(false);
    const result = p.damage(60, 1200);
    expect(result.broke).toBe(true);
    expect(p.isGroggy(1200)).toBe(true);
    expect(p.damageMultiplier(1200)).toBe(1.8);
  });

  it('그로기는 3초 후 풀린다 (PvE)', () => {
    const p = new PoiseGauge();
    p.damage(100, 1000);
    expect(p.isGroggy(3999)).toBe(true);
    expect(p.isGroggy(4001)).toBe(false);
    expect(p.damageMultiplier(4001)).toBe(1.0);
  });

  it('PvP에서는 1.2초 / 1.35배로 약화된다 (별책 2-5)', () => {
    const p = new PoiseGauge(PVP_POISE);
    p.damage(100, 1000);
    expect(p.isGroggy(2100)).toBe(true);
    expect(p.isGroggy(2300)).toBe(false);
    expect(p.damageMultiplier(1500)).toBe(1.35);
  });

  it('그로기 직후 연속으로 다시 깨지지 않는다', () => {
    const p = new PoiseGauge();
    p.damage(100, 1000); // 그로기
    // 그로기 종료(4000) 직후에는 면역
    expect(p.damage(100, 4100).broke).toBe(false);
  });

  it('패리는 상대 자세를 크게 깎는다', () => {
    const p = new PoiseGauge();
    p.parryPunish(1000);
    expect(p.current).toBeCloseTo(PVE_POISE.max * 0.65);
  });

  it('처형은 그로기 시간이 충분할 때만 가능하다', () => {
    const p = new PoiseGauge();
    p.damage(100, 1000);
    expect(p.canExecute(1000)).toBe(true);
    expect(p.canExecute(3900)).toBe(false); // 남은 100ms로는 처형 모션이 안 나온다
  });
});

describe('GuardController — 가드 / 패리 / 가드 브레이크', () => {
  const front = { position: 'FRONT' } as const;

  it('가드 입력 후 판정 창(검사 0.25초) 안에 맞으면 패리', () => {
    const g = new GuardController(250);
    const s = new StaminaController();
    g.startGuard(1000);
    const result = g.onIncomingHit(1200, 300, s, front);
    expect(result.outcome).toBe('PARRY');
    expect(result.damageMultiplier).toBe(0);
    expect(g.canRiposte(1300)).toBe(true);
  });

  it('판정 창을 넘기면 일반 가드 — 70% 감소', () => {
    const g = new GuardController(250);
    const s = new StaminaController();
    g.startGuard(1000);
    const result = g.onIncomingHit(1400, 300, s, front);
    expect(result.outcome).toBe('BLOCK');
    expect(result.damageMultiplier).toBeCloseTo(0.3);
  });

  it('패리 판정 창은 직업별로 다르다 — 마법사 0.12초', () => {
    const mage = new GuardController(120);
    const s = new StaminaController();
    mage.startGuard(1000);
    expect(mage.onIncomingHit(1200, 300, s, front).outcome).toBe('BLOCK'); // 검사였다면 패리
  });

  it('가드는 전방 공격에만 유효하다', () => {
    const g = new GuardController(250);
    const s = new StaminaController();
    g.startGuard(1000);
    expect(g.onIncomingHit(1100, 300, s, { position: 'BACK' }).outcome).toBe('HIT');
  });

  it('스태미나가 소진되면 가드 브레이크 — 1.5초 경직', () => {
    const g = new GuardController(250);
    const s = new StaminaController();
    s.spend(95, 0); // 스태미나 5만 남김
    g.startGuard(1000);
    const result = g.onIncomingHit(1400, 300, s, front); // 비용 105 > 5
    expect(result.outcome).toBe('GUARD_BREAK');
    expect(g.isStunned(2000)).toBe(true);
    expect(g.isStunned(3000)).toBe(false);
  });

  it('가드는 한 대에 깨지지 않는다 — 강타를 여러 번 받아낼 수 있어야 한다', () => {
    const g = new GuardController(250);
    const s = new StaminaController();
    g.startGuard(1000);
    // 300 피해를 연속으로 막는다. 스태미나 100으로 최소 3회는 버텨야 가드가 의미를 갖는다
    for (let i = 0; i < 3; i += 1) {
      expect(g.onIncomingHit(1400 + i * 100, 300, s, front).outcome).toBe('BLOCK');
    }
    expect(s.value).toBeGreaterThan(0);
  });

  it('가드를 떼고 곧바로 다시 눌러 패리를 남발할 수 없다', () => {
    const g = new GuardController(250);
    g.startGuard(1000);
    g.stopGuard(1100);
    expect(g.startGuard(1200)).toBe(false); // parryCooldownMs 400 이내
    expect(g.startGuard(1600)).toBe(true);
  });
});
