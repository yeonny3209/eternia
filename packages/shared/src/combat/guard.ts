/**
 * 기획서 6-3-4 — 가드 / 패리 / 가드 브레이크.
 *
 * | 동작 | 조건 | 효과 |
 * | 가드 | 방패·양손무기 우클릭 유지 | 전방 피해 70% 감소, 스태미나 소모 |
 * | 패리 | 피격 직전 0.2초 내 가드 입력 | 피해 0, 상대 자세 게이지 대폭 감소, 반격 기회 |
 * | 가드 브레이크 | 가드 중 스태미나 소진 | 1.5초 경직, 큰 취약 |
 *
 * 패리 판정 창은 직업별로 다르다(검사 0.25초 / 마법사 0.12초) → classes.json의 parryWindowMs.
 */
import type { HitResult } from '../types/combat.js';
import type { StaminaController } from './stamina.js';

export interface GuardConfig {
  /** 전방 피해 감소율 */
  damageReduction: number;
  /** 가드 유지 시 초당 스태미나 소모 */
  drainPerSec: number;
  /** 막기 1회당 고정 소모 */
  blockCostBase: number;
  /**
   * 피해량 비례 소모 계수.
   * 스태미나 최대치가 100이므로 이 값이 크면 한 대에 무조건 가드가 깨진다.
   * "몇 대까지 막아낼 수 있는가"가 이 값으로 결정된다 — 현재 기준 강타 4~5회.
   */
  blockCostPerDamage: number;
  /** 막기 1회 소모 상한 — 초고배율 한 방에 무조건 깨지는 것을 막는다 */
  blockCostCap: number;
  /** 가드 브레이크 경직(ms) */
  breakStunMs: number;
  /** 패리 성공 시 반격 기회 창(ms) */
  riposteWindowMs: number;
  /** 패리 실패(늦은 가드) 후 재입력 잠금(ms) — 무한 패리 시도 방지 */
  parryCooldownMs: number;
}

export const DEFAULT_GUARD: GuardConfig = {
  damageReduction: 0.7,
  drainPerSec: 6,
  blockCostBase: 6,
  blockCostPerDamage: 0.06,
  blockCostCap: 45,
  breakStunMs: 1500,
  riposteWindowMs: 1200,
  parryCooldownMs: 400,
};

export type BlockOutcome = 'PARRY' | 'BLOCK' | 'GUARD_BREAK' | 'HIT';

export interface BlockResult {
  outcome: BlockOutcome;
  /** 실제로 받을 피해 배율 (패리 0, 가드 0.3, 피격 1.0) */
  damageMultiplier: number;
  /** 가드 브레이크로 경직이 걸린 시각까지 */
  stunUntilMs?: number;
  /** 패리 성공 시 반격 가능 마감 시각 */
  riposteUntilMs?: number;
}

export class GuardController {
  private guarding = false;
  private guardStartedAt = -Infinity;
  private stunUntil = -Infinity;
  private riposteUntil = -Infinity;
  private parryLockedUntil = -Infinity;

  constructor(
    /** 직업별 패리 판정 창(ms) */
    private readonly parryWindowMs: number,
    private readonly cfg: GuardConfig = DEFAULT_GUARD,
  ) {}

  get isGuarding(): boolean {
    return this.guarding;
  }
  get config(): GuardConfig {
    return this.cfg;
  }
  get window(): number {
    return this.parryWindowMs;
  }

  isStunned(nowMs: number): boolean {
    return nowMs < this.stunUntil;
  }
  canRiposte(nowMs: number): boolean {
    return nowMs < this.riposteUntil;
  }

  /** 우클릭 눌림 */
  startGuard(nowMs: number): boolean {
    if (this.isStunned(nowMs)) return false;
    if (nowMs < this.parryLockedUntil) return false;
    if (this.guarding) return true;
    this.guarding = true;
    this.guardStartedAt = nowMs;
    return true;
  }

  /** 우클릭 뗌 */
  stopGuard(nowMs: number): void {
    if (!this.guarding) return;
    this.guarding = false;
    // 가드를 뗀 직후 곧바로 다시 눌러 패리를 남발하는 것을 막는다
    this.parryLockedUntil = nowMs + this.cfg.parryCooldownMs;
  }

  /**
   * 피격 판정. 서버가 히트 확정 시각을 nowMs로 넣는다.
   *
   * 패리 = 가드 입력 후 parryWindowMs 안에 피격이 들어온 경우.
   * 그 창을 넘겨서 가드 중이면 일반 가드(70% 감소)로 처리한다.
   */
  onIncomingHit(
    nowMs: number,
    incomingDamage: number,
    stamina: StaminaController,
    hit: Pick<HitResult, 'position'>,
  ): BlockResult {
    if (!this.guarding || this.isStunned(nowMs)) {
      return { outcome: 'HIT', damageMultiplier: 1 };
    }
    // 가드는 전방 공격에만 유효하다
    if (hit.position !== 'FRONT') {
      return { outcome: 'HIT', damageMultiplier: 1 };
    }

    const sinceGuard = nowMs - this.guardStartedAt;
    if (sinceGuard <= this.parryWindowMs) {
      this.riposteUntil = nowMs + this.cfg.riposteWindowMs;
      return { outcome: 'PARRY', damageMultiplier: 0, riposteUntilMs: this.riposteUntil };
    }

    const cost = Math.min(
      this.cfg.blockCostCap,
      this.cfg.blockCostBase + incomingDamage * this.cfg.blockCostPerDamage,
    );
    if (!stamina.spend(cost, nowMs)) {
      // 스태미나 소진 → 가드 브레이크
      this.guarding = false;
      this.stunUntil = nowMs + this.cfg.breakStunMs;
      return { outcome: 'GUARD_BREAK', damageMultiplier: 1.25, stunUntilMs: this.stunUntil };
    }

    return { outcome: 'BLOCK', damageMultiplier: 1 - this.cfg.damageReduction };
  }

  update(dtMs: number, nowMs: number, stamina: StaminaController): void {
    if (!this.guarding) return;
    if (this.isStunned(nowMs)) {
      this.guarding = false;
      return;
    }
    const drain = (this.cfg.drainPerSec * dtMs) / 1000;
    if (!stamina.spend(drain, nowMs)) {
      this.guarding = false;
      this.stunUntil = nowMs + this.cfg.breakStunMs;
    }
  }

  reset(): void {
    this.guarding = false;
    this.guardStartedAt = -Infinity;
    this.stunUntil = -Infinity;
    this.riposteUntil = -Infinity;
    this.parryLockedUntil = -Infinity;
  }
}
