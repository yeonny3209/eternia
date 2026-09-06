/**
 * 기획서 6-3-3 — 자세 붕괴(그로기) 게이지.
 *
 * 몬스터·플레이어 모두 자세 게이지를 가진다. **보스도 예외 없다.**
 * 게이지가 0에 닿으면 그로기 → 이 동안 받는 피해가 크게 늘어난다.
 * 이래야 "회피만 잘하는 것"이 아니라 **공격 타이밍 설계**가 필요해진다.
 *
 * PvP에서는 별책 기획서 2-5절에 따라 약화 적용한다(지속 1.2초 / +35%).
 */

export interface PoiseConfig {
  max: number;
  /** 그로기 지속(ms) */
  groggyMs: number;
  /** 그로기 중 받는 피해 배율 */
  groggyDamageMultiplier: number;
  /** 초당 자연 회복량(최대치 대비 비율) */
  regenPerSec: number;
  /** 마지막 피격 후 회복 시작까지 지연(ms) */
  regenDelayMs: number;
}

/** PvE 기본값 — 기획서 6-3-3 */
export const PVE_POISE: PoiseConfig = {
  max: 100,
  groggyMs: 3000,
  groggyDamageMultiplier: 1.8,
  regenPerSec: 0.06,
  regenDelayMs: 2500,
};

/** PvP 값 — 별책 PvP 기획서 2-5. 한 번 잡혔다고 즉사하지는 않게 한다 */
export const PVP_POISE: PoiseConfig = {
  max: 100,
  groggyMs: 1200,
  groggyDamageMultiplier: 1.35,
  regenPerSec: 0.08,
  regenDelayMs: 1200,
};

export interface PoiseHitResult {
  /** 이번 타격으로 그로기에 들어갔는가 */
  broke: boolean;
  remaining: number;
}

export class PoiseGauge {
  private value: number;
  private groggyUntil = -Infinity;
  private lastHitAt = -Infinity;
  /** 그로기에서 막 회복된 직후 연속으로 다시 깨지는 것을 막는다 */
  private immuneUntil = -Infinity;

  constructor(private readonly cfg: PoiseConfig = PVE_POISE) {
    this.value = cfg.max;
  }

  get current(): number {
    return this.value;
  }
  get max(): number {
    return this.cfg.max;
  }
  get ratio(): number {
    return this.value / this.cfg.max;
  }
  get config(): PoiseConfig {
    return this.cfg;
  }

  isGroggy(nowMs: number): boolean {
    return nowMs < this.groggyUntil;
  }

  /** 그로기 남은 시간(ms) */
  groggyRemaining(nowMs: number): number {
    return Math.max(0, this.groggyUntil - nowMs);
  }

  /** 그로기 상태에서 받는 피해 배율. 평상시 1.0 */
  damageMultiplier(nowMs: number): number {
    return this.isGroggy(nowMs) ? this.cfg.groggyDamageMultiplier : 1.0;
  }

  /** 자세 게이지를 깎는다. 0에 닿으면 그로기 */
  damage(amount: number, nowMs: number): PoiseHitResult {
    this.lastHitAt = nowMs;
    if (this.isGroggy(nowMs) || nowMs < this.immuneUntil) {
      return { broke: false, remaining: this.value };
    }
    this.value = Math.max(0, this.value - amount);
    if (this.value <= 0) {
      this.groggyUntil = nowMs + this.cfg.groggyMs;
      // 그로기 종료와 동시에 게이지를 되돌려 준다
      this.value = this.cfg.max;
      this.immuneUntil = this.groggyUntil + 1500;
      return { broke: true, remaining: 0 };
    }
    return { broke: false, remaining: this.value };
  }

  /** 패리 성공 시 상대 자세 게이지를 크게 깎는다(기획서 6-3-4) */
  parryPunish(nowMs: number): PoiseHitResult {
    return this.damage(this.cfg.max * 0.35, nowMs);
  }

  update(dtMs: number, nowMs: number): void {
    if (this.isGroggy(nowMs)) return;
    if (nowMs - this.lastHitAt < this.cfg.regenDelayMs) return;
    this.value = Math.min(
      this.cfg.max,
      this.value + this.cfg.max * this.cfg.regenPerSec * (dtMs / 1000),
    );
  }

  reset(): void {
    this.value = this.cfg.max;
    this.groggyUntil = -Infinity;
    this.lastHitAt = -Infinity;
    this.immuneUntil = -Infinity;
  }

  /**
   * 그로기 중에만 사용 가능한 처형 — 무기별 고유 모션(기획서 6-3-3).
   * 남은 그로기 시간이 충분할 때만 허용한다.
   */
  canExecute(nowMs: number, executeWindupMs = 400): boolean {
    return this.groggyRemaining(nowMs) >= executeWindupMs;
  }
}
