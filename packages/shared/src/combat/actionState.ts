/**
 * 기획서 6-3-2 ② — 애니메이션 상태 머신 (선딜 / 판정 / 후딜).
 *
 *   스킬 사용 = [선딜 startup] → [판정 active] → [후딜 recovery]
 *
 * 규칙:
 *  - 선딜 중에는 회피로 캔슬 불가. 단 `cancelable: true` 스킬만 예외.
 *  - 후딜은 회피·다른 스킬로 캔슬 가능 → 이것이 콤보 설계의 핵심이다.
 *  - 강한 스킬일수록 선딜이 길다. 이것이 유일한 밸런스 축이다.
 *
 * 이 머신은 시간을 스스로 세지 않는다. 서버 틱(30/s)이 dtMs를 주입한다.
 * 클라이언트는 같은 코드로 예측 재생만 하고, 판정은 서버 결과를 따른다.
 */
import type { ActionPhase, FrameData } from '../types/combat.js';

export type CancelKind = 'DODGE' | 'SKILL' | 'GUARD';

export interface ActionRequest {
  id: string;
  frames: FrameData;
  /** 기본 공격 콤보의 몇 번째 타인가. 콤보가 아니면 undefined */
  comboIndex?: number;
}

export interface ActionSnapshot {
  phase: ActionPhase;
  actionId: string | null;
  /** 현재 페이즈에서 경과한 시간(ms) */
  phaseElapsedMs: number;
  /** 행동 전체에서 경과한 시간(ms) */
  totalElapsedMs: number;
  comboIndex: number;
  /** 이번 update에서 판정(active)이 시작되었는가 — 히트박스를 굴릴 프레임 */
  activeStarted: boolean;
  /** 이번 update에서 행동이 끝났는가 */
  finished: boolean;
}

/** 후딜에 들어간 뒤 이 시간 안에 다음 타를 입력하면 콤보가 이어진다 */
export const COMBO_WINDOW_MS = 450;

export class ActionStateMachine {
  private phase: ActionPhase = 'IDLE';
  private action: ActionRequest | null = null;
  private phaseElapsed = 0;
  private totalElapsed = 0;
  private comboIndex = 0;
  /** 후딜 진입 후 경과 시간 — 콤보 창 판정용 */
  private sinceRecovery = 0;
  private activeStartedThisTick = false;
  private finishedThisTick = false;

  get currentPhase(): ActionPhase {
    return this.phase;
  }
  get currentActionId(): string | null {
    return this.action?.id ?? null;
  }
  get combo(): number {
    return this.comboIndex;
  }
  get isIdle(): boolean {
    return this.phase === 'IDLE';
  }

  /**
   * 지금 이 행동을 시작할 수 있는가.
   * IDLE이거나, 캔슬 가능한 시점이면 새 행동을 받는다.
   */
  canStart(): boolean {
    if (this.phase === 'IDLE') return true;
    return this.canCancel('SKILL');
  }

  /**
   * 캔슬 가능 여부.
   *  - RECOVERY: 회피·스킬·가드 전부 캔슬 가능
   *  - STARTUP: `cancelable` 스킬에 한해 회피만 가능
   *  - ACTIVE: 캔슬 불가 (판정 중에 빠져나가는 것을 허용하면 액션이 무너진다)
   */
  canCancel(kind: CancelKind): boolean {
    if (this.phase === 'IDLE') return true;
    if (this.phase === 'RECOVERY') return true;
    if (this.phase === 'STARTUP' && kind === 'DODGE') return this.action?.frames.cancelable === true;
    return false;
  }

  /** 콤보가 이어지는 창 안에 있는가 */
  inComboWindow(): boolean {
    return this.phase === 'RECOVERY' && this.sinceRecovery <= COMBO_WINDOW_MS;
  }

  /**
   * 행동 시작. 성공하면 true.
   * comboIndex가 주어지면 콤보 카운터를 그 값으로 맞춘다.
   */
  start(req: ActionRequest): boolean {
    if (!this.canStart()) return false;
    this.action = req;
    this.phase = req.frames.startupMs > 0 ? 'STARTUP' : 'ACTIVE';
    this.phaseElapsed = 0;
    this.totalElapsed = 0;
    this.sinceRecovery = 0;
    this.activeStartedThisTick = this.phase === 'ACTIVE';
    this.finishedThisTick = false;
    this.comboIndex = req.comboIndex ?? 0;
    return true;
  }

  /** 회피/피격 등으로 강제 중단 */
  cancel(kind: CancelKind): boolean {
    if (!this.canCancel(kind)) return false;
    this.reset();
    return true;
  }

  /** 스턴·그로기 등으로 무조건 끊는다 */
  interrupt(): void {
    this.reset();
  }

  private reset(): void {
    this.phase = 'IDLE';
    this.action = null;
    this.phaseElapsed = 0;
    this.totalElapsed = 0;
    this.sinceRecovery = 0;
    this.comboIndex = 0;
  }

  /** 콤보 카운터만 초기화 (행동은 유지) */
  resetCombo(): void {
    this.comboIndex = 0;
  }

  update(dtMs: number): ActionSnapshot {
    this.activeStartedThisTick = false;
    this.finishedThisTick = false;

    if (this.phase !== 'IDLE' && this.action) {
      this.phaseElapsed += dtMs;
      this.totalElapsed += dtMs;
      if (this.phase === 'RECOVERY') this.sinceRecovery += dtMs;

      const f = this.action.frames;
      // while로 도는 이유: 프레임이 매우 짧은 스킬이 한 틱(33ms) 안에
      // 여러 페이즈를 통과할 수 있다. 판정을 건너뛰면 안 된다.
      let guard = 0;
      while (this.phase !== 'IDLE' && guard++ < 8) {
        if (this.phase === 'STARTUP' && this.phaseElapsed >= f.startupMs) {
          this.phaseElapsed -= f.startupMs;
          this.phase = 'ACTIVE';
          this.activeStartedThisTick = true;
          continue;
        }
        if (this.phase === 'ACTIVE' && this.phaseElapsed >= f.activeMs) {
          this.phaseElapsed -= f.activeMs;
          this.phase = 'RECOVERY';
          this.sinceRecovery = this.phaseElapsed;
          continue;
        }
        if (this.phase === 'RECOVERY' && this.phaseElapsed >= f.recoveryMs) {
          this.phase = 'IDLE';
          this.action = null;
          this.phaseElapsed = 0;
          this.finishedThisTick = true;
          continue;
        }
        break;
      }
    }

    return this.snapshot();
  }

  snapshot(): ActionSnapshot {
    return {
      phase: this.phase,
      actionId: this.action?.id ?? null,
      phaseElapsedMs: this.phaseElapsed,
      totalElapsedMs: this.totalElapsed,
      comboIndex: this.comboIndex,
      activeStarted: this.activeStartedThisTick,
      finished: this.finishedThisTick,
    };
  }
}

/**
 * 기본 공격 콤보 도우미 — 좌클릭 1~3타(기획서 6-3-1).
 * 콤보 창 안에서 다시 누르면 다음 타로, 창을 놓치면 1타로 돌아간다.
 */
export class ComboTracker {
  private index = 0;
  private lastInputAt = -Infinity;

  constructor(
    private readonly maxCombo: number = 3,
    private readonly windowMs: number = COMBO_WINDOW_MS,
  ) {}

  /** 다음에 나갈 콤보 인덱스(0-based)를 계산한다 */
  next(nowMs: number): number {
    if (nowMs - this.lastInputAt > this.windowMs) this.index = 0;
    else this.index = (this.index + 1) % this.maxCombo;
    this.lastInputAt = nowMs;
    return this.index;
  }

  reset(): void {
    this.index = 0;
    this.lastInputAt = -Infinity;
  }

  get current(): number {
    return this.index;
  }
}

/** 콤보 배율 — 기획서 6-3-5 comboMultiplier. 3타째가 가장 세다 */
export const COMBO_MULTIPLIERS = [1.0, 1.15, 1.45];

export function comboMultiplier(index: number): number {
  return COMBO_MULTIPLIERS[index] ?? 1.0;
}
