/**
 * 기획서 6-3-2 ③ — 회피는 자원이다.
 *
 *  - 회피 구르기: 무적 프레임 0.3초 (총 동작 0.6초)
 *  - 스태미나 100, 회피 1회당 25 소모, 초당 20 회복(전투 중 12)
 *  - 연속 4회 회피 후 잠깐 무방비 → 무한 회피 방지
 *
 * 기획서 6-3-6 / PvP 별책 6-3 ②:
 *  무적 프레임은 **서버 타임스탬프로만** 판정한다.
 *  클라이언트의 "나 지금 무적이었어"라는 주장은 절대 믿지 않는다.
 *  서버가 회피 입력 수신 시각에 [t, t+300] 구간을 기록하고,
 *  히트 판정 시각이 그 안에 들면 무효 처리한다.
 */

/** 프레임 수치는 전부 JSON으로 뺄 수 있게 상수 객체로 둔다(M1 튜닝용) */
export interface StaminaConfig {
  max: number;
  dodgeCost: number;
  /** 비전투 중 초당 회복 */
  regenPerSec: number;
  /** 전투 중 초당 회복 */
  regenInCombatPerSec: number;
  /** 회피 후 회복이 시작되기까지의 지연(ms) */
  regenDelayMs: number;
  /** 무적 지속(ms) */
  iframeMs: number;
  /** 회피 동작 전체(ms) */
  dodgeDurationMs: number;
  /** 이 횟수를 연속으로 쓰면 무방비에 빠진다 */
  chainLimit: number;
  /** 연속 회피 판정이 유지되는 간격(ms) */
  chainWindowMs: number;
  /** 무방비 지속(ms) */
  vulnerableMs: number;
  /** 회피 이동 거리(m) */
  dodgeDistance: number;
}

export const DEFAULT_STAMINA: StaminaConfig = {
  max: 100,
  dodgeCost: 25,
  regenPerSec: 20,
  regenInCombatPerSec: 12,
  regenDelayMs: 350,
  iframeMs: 300,
  dodgeDurationMs: 600,
  chainLimit: 4,
  chainWindowMs: 1200,
  vulnerableMs: 900,
  dodgeDistance: 3.2,
};

/** 서버가 보관하는 무적 구간 */
export interface IFrameWindow {
  startMs: number;
  endMs: number;
}

export type DodgeFailure = 'NOT_ENOUGH_STAMINA' | 'ALREADY_DODGING' | 'VULNERABLE';

export interface DodgeResult {
  ok: boolean;
  reason?: DodgeFailure;
  window?: IFrameWindow;
}

export class StaminaController {
  private stamina: number;
  private lastSpendAt = -Infinity;
  private dodgeEndsAt = -Infinity;
  private chainCount = 0;
  private lastDodgeAt = -Infinity;
  private vulnerableUntil = -Infinity;
  /** 되감기 판정을 위해 최근 무적 구간을 보관한다 */
  private readonly windows: IFrameWindow[] = [];

  constructor(private readonly cfg: StaminaConfig = DEFAULT_STAMINA) {
    this.stamina = cfg.max;
  }

  get value(): number {
    return this.stamina;
  }
  get max(): number {
    return this.cfg.max;
  }
  get config(): StaminaConfig {
    return this.cfg;
  }
  /** 연속 회피 소진으로 무방비 상태인가 */
  isVulnerable(nowMs: number): boolean {
    return nowMs < this.vulnerableUntil;
  }
  isDodging(nowMs: number): boolean {
    return nowMs < this.dodgeEndsAt;
  }

  canDodge(nowMs: number): DodgeResult {
    if (this.isDodging(nowMs)) return { ok: false, reason: 'ALREADY_DODGING' };
    if (this.isVulnerable(nowMs)) return { ok: false, reason: 'VULNERABLE' };
    if (this.stamina < this.cfg.dodgeCost) return { ok: false, reason: 'NOT_ENOUGH_STAMINA' };
    return { ok: true };
  }

  /**
   * 회피 실행. 서버가 **수신 시각**을 nowMs로 넣는다.
   * 성공 시 무적 구간 [now, now+iframeMs]를 기록해 반환한다.
   */
  dodge(nowMs: number): DodgeResult {
    const check = this.canDodge(nowMs);
    if (!check.ok) return check;

    this.stamina -= this.cfg.dodgeCost;
    this.lastSpendAt = nowMs;
    this.dodgeEndsAt = nowMs + this.cfg.dodgeDurationMs;

    // 연속 회피 카운트
    if (nowMs - this.lastDodgeAt <= this.cfg.chainWindowMs) this.chainCount += 1;
    else this.chainCount = 1;
    this.lastDodgeAt = nowMs;

    if (this.chainCount >= this.cfg.chainLimit) {
      this.vulnerableUntil = nowMs + this.cfg.dodgeDurationMs + this.cfg.vulnerableMs;
      this.chainCount = 0;
    }

    const window: IFrameWindow = { startMs: nowMs, endMs: nowMs + this.cfg.iframeMs };
    this.windows.push(window);
    // 되감기 상한(200ms)의 여유를 두고 오래된 구간은 버린다
    const cutoff = nowMs - 2000;
    while (this.windows.length > 0 && (this.windows[0] as IFrameWindow).endMs < cutoff) {
      this.windows.shift();
    }
    return { ok: true, window };
  }

  /**
   * 특정 시각에 무적이었는가 — 히트 판정이 이 함수를 호출한다.
   * 되감기 판정(lag compensation)에서 과거 시각을 그대로 넣어도 정확히 답한다.
   */
  wasInvulnerableAt(timeMs: number): boolean {
    return this.windows.some((w) => timeMs >= w.startMs && timeMs < w.endMs);
  }

  /** 무적기 등 외부 사유로 무적 구간을 직접 기록한다 */
  grantInvulnerability(startMs: number, durationMs: number): IFrameWindow {
    const w: IFrameWindow = { startMs, endMs: startMs + durationMs };
    this.windows.push(w);
    return w;
  }

  /** 스킬 등이 스태미나를 소모할 때 */
  spend(amount: number, nowMs: number): boolean {
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    this.lastSpendAt = nowMs;
    return true;
  }

  update(dtMs: number, nowMs: number, inCombat: boolean): void {
    if (nowMs - this.lastSpendAt < this.cfg.regenDelayMs) return;
    const rate = inCombat ? this.cfg.regenInCombatPerSec : this.cfg.regenPerSec;
    this.stamina = Math.min(this.cfg.max, this.stamina + (rate * dtMs) / 1000);
  }

  /** 라운드 리셋 등에 사용 */
  refill(): void {
    this.stamina = this.cfg.max;
    this.chainCount = 0;
    this.vulnerableUntil = -Infinity;
    this.dodgeEndsAt = -Infinity;
    this.windows.length = 0;
  }
}
