/**
 * 전투 주체 — 기획서 6-3의 부품(히트박스·상태머신·스태미나·자세·가드)을 하나로 묶는다.
 *
 * 서버가 권위 있게 이 클래스를 굴리고, 클라이언트는 같은 코드를 예측 재생에만 쓴다.
 * 데미지 숫자는 서버 확정 후에만 표시한다(기획서 6-3-6).
 */
import { computeDamage, damageInput } from '../formulas/combat.js';
import type { DamageBreakdown, HitResult, HitTarget, SkillDef } from '../types/combat.js';
import { clamp, type Vec2 } from '../types/core.js';
import { ActionStateMachine, ComboTracker, comboMultiplier } from './actionState.js';
import { DEFAULT_GUARD, GuardController, type BlockResult } from './guard.js';
import { PVE_POISE, PoiseGauge, type PoiseConfig } from './poise.js';
import { DEFAULT_STAMINA, StaminaController, type StaminaConfig } from './stamina.js';

export interface CombatantOptions {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  maxMp: number;
  atk: number;
  def: number;
  critRate: number;
  critDmgBonus: number;
  /** 충돌 반지름(m) */
  radius: number;
  /** 이동속도(m/s) */
  moveSpeed: number;
  /** 직업별 패리 판정 창(ms) */
  parryWindowMs: number;
  poiseConfig?: PoiseConfig;
  staminaConfig?: StaminaConfig;
  faction: 'PLAYER' | 'ENEMY';
}

export interface IncomingHit {
  attackerId: string;
  attackerLevel: number;
  attackerAtk: number;
  skillCoef: number;
  comboIndex: number;
  poiseDamage: number;
  position: HitResult['position'];
  isCrit: boolean;
  critDmgBonus: number;
  elementMultiplier: number;
  contextCoef: number;
  /** 0..1 난수 — 서버 시드에서 나온다 */
  roll: number;
  /**
   * 이 히트가 성립한 **서버 시각**. 되감기 판정 결과가 들어온다.
   * 무적 프레임 판정은 오직 이 값으로만 이뤄진다(기획서 6-3-6).
   */
  hitTimeMs: number;
}

export type HitVerdict = 'DAMAGED' | 'IFRAME' | 'PARRIED' | 'BLOCKED' | 'GUARD_BROKEN' | 'DEAD';

export interface HitOutcome {
  verdict: HitVerdict;
  damage: number;
  breakdown: DamageBreakdown | null;
  block: BlockResult | null;
  /** 이번 타격으로 그로기에 들어갔는가 */
  groggyBroke: boolean;
  remainingHp: number;
}

export class Combatant {
  readonly id: string;
  readonly name: string;
  readonly faction: 'PLAYER' | 'ENEMY';
  readonly opts: CombatantOptions;

  pos: Vec2 = { x: 0, y: 0 };
  /** 커서를 향하는 조준 방향(라디안) */
  aim = 0;
  hp: number;
  mp: number;
  alive = true;

  readonly action = new ActionStateMachine();
  readonly combo = new ComboTracker(3);
  readonly stamina: StaminaController;
  readonly poise: PoiseGauge;
  readonly guard: GuardController;

  private readonly cooldowns = new Map<string, number>();
  private lastCombatAt = -Infinity;

  constructor(options: CombatantOptions) {
    this.opts = options;
    this.id = options.id;
    this.name = options.name;
    this.faction = options.faction;
    this.hp = options.maxHp;
    this.mp = options.maxMp;
    this.stamina = new StaminaController(options.staminaConfig ?? DEFAULT_STAMINA);
    this.poise = new PoiseGauge(options.poiseConfig ?? PVE_POISE);
    this.guard = new GuardController(options.parryWindowMs, DEFAULT_GUARD);
  }

  get maxHp(): number {
    return this.opts.maxHp;
  }
  get hpRatio(): number {
    return this.hp / this.opts.maxHp;
  }

  /** 히트 판정 대상으로서의 표현 — 무적 여부는 서버 시각 기준으로 답한다 */
  asTarget(nowMs: number): HitTarget {
    return {
      id: this.id,
      pos: this.pos,
      radius: this.opts.radius,
      facing: this.aim,
      invulnerable: !this.alive || this.stamina.wasInvulnerableAt(nowMs),
    };
  }

  inCombat(nowMs: number): boolean {
    return nowMs - this.lastCombatAt < 5000;
  }

  /* --------------------------- 입력 --------------------------- */

  /** 회피 구르기. 서버 수신 시각을 넣는다 */
  tryDodge(nowMs: number): boolean {
    if (!this.alive || this.guard.isStunned(nowMs)) return false;
    if (!this.action.canCancel('DODGE')) return false;
    const result = this.stamina.dodge(nowMs);
    if (!result.ok) return false;
    this.action.interrupt();
    this.guard.stopGuard(nowMs);
    // 회피는 조준 방향으로 굴러간다
    const d = this.stamina.config.dodgeDistance;
    this.pos = { x: this.pos.x + Math.cos(this.aim) * d, y: this.pos.y + Math.sin(this.aim) * d };
    return true;
  }

  cooldownRemaining(skillId: string, nowMs: number): number {
    return Math.max(0, (this.cooldowns.get(skillId) ?? 0) - nowMs);
  }

  canUse(skill: SkillDef, nowMs: number): boolean {
    if (!this.alive || this.guard.isStunned(nowMs)) return false;
    if (this.poise.isGroggy(nowMs)) return false;
    if (this.cooldownRemaining(skill.id, nowMs) > 0) return false;
    if (this.mp < skill.mpCost) return false;
    return this.action.canStart();
  }

  /**
   * 스킬 사용 시작. 성공하면 콤보 인덱스를 반환한다.
   * 실제 히트 판정은 상태머신이 ACTIVE에 들어가는 틱에서 이뤄진다.
   */
  useSkill(skill: SkillDef, nowMs: number): number | null {
    if (!this.canUse(skill, nowMs)) return null;
    const isBasic = skill.cooldownMs === 0 && skill.kind === 'ACTIVE';
    const comboIndex = isBasic ? this.combo.next(nowMs) : 0;
    const started = this.action.start({ id: skill.id, frames: skill.frames, comboIndex });
    if (!started) return null;
    this.mp -= skill.mpCost;
    if (skill.cooldownMs > 0) this.cooldowns.set(skill.id, nowMs + skill.cooldownMs);
    this.lastCombatAt = nowMs;
    return comboIndex;
  }

  startGuard(nowMs: number): boolean {
    if (!this.alive) return false;
    if (!this.action.canCancel('GUARD')) return false;
    return this.guard.startGuard(nowMs);
  }

  stopGuard(nowMs: number): void {
    this.guard.stopGuard(nowMs);
  }

  move(dir: Vec2, dtMs: number): void {
    if (!this.alive) return;
    // 선딜·판정 중에는 이동할 수 없다. 후딜에서는 캔슬 이동이 가능하다.
    const phase = this.action.currentPhase;
    if (phase === 'STARTUP' || phase === 'ACTIVE') return;
    const speed = this.guard.isGuarding ? this.opts.moveSpeed * 0.4 : this.opts.moveSpeed;
    const len = Math.hypot(dir.x, dir.y);
    if (len === 0) return;
    const step = (speed * dtMs) / 1000;
    this.pos = { x: this.pos.x + (dir.x / len) * step, y: this.pos.y + (dir.y / len) * step };
  }

  /* --------------------------- 피격 --------------------------- */

  /**
   * 피격 처리. 판정 순서가 중요하다.
   *  1. 무적 프레임 (서버 타임스탬프)
   *  2. 패리 / 가드
   *  3. 데미지 공식
   *  4. 자세 게이지
   */
  takeHit(hit: IncomingHit): HitOutcome {
    if (!this.alive) {
      return { verdict: 'DEAD', damage: 0, breakdown: null, block: null, groggyBroke: false, remainingHp: 0 };
    }

    // ① 무적 프레임 — 클라이언트 주장이 아니라 서버가 기록한 구간으로만 판정한다
    if (this.stamina.wasInvulnerableAt(hit.hitTimeMs)) {
      return {
        verdict: 'IFRAME',
        damage: 0,
        breakdown: null,
        block: null,
        groggyBroke: false,
        remainingHp: this.hp,
      };
    }

    this.lastCombatAt = hit.hitTimeMs;

    // ② 데미지 산출 (가드 배율을 곱하기 전 원 피해량이 필요하다)
    const breakdown = computeDamage(
      damageInput({
        atk: hit.attackerAtk,
        skillCoef: hit.skillCoef,
        comboMultiplier: comboMultiplier(hit.comboIndex),
        def: this.opts.def,
        attackerLevel: hit.attackerLevel,
        isCrit: hit.isCrit,
        critDmgBonus: hit.critDmgBonus,
        elementMultiplier: hit.elementMultiplier,
        position: hit.position,
        targetGroggy: this.poise.isGroggy(hit.hitTimeMs),
        contextCoef: hit.contextCoef,
        roll: hit.roll,
      }),
    );

    // ③ 패리 / 가드
    const block = this.guard.onIncomingHit(hit.hitTimeMs, breakdown.final, this.stamina, {
      position: hit.position,
    });

    let groggyBroke = false;
    if (block.outcome === 'PARRY') {
      // 패리 성공: 피해 0. 상대 자세를 깎는 것은 호출자가 공격자에게 적용한다.
      return {
        verdict: 'PARRIED',
        damage: 0,
        breakdown,
        block,
        groggyBroke: false,
        remainingHp: this.hp,
      };
    }

    const damage = Math.max(1, Math.round(breakdown.final * block.damageMultiplier));
    this.hp = clamp(this.hp - damage, 0, this.opts.maxHp);

    // ④ 자세 게이지 — 가드에 성공했으면 자세 피해가 줄어든다
    const poiseScale = block.outcome === 'BLOCK' ? 0.4 : 1;
    if (hit.poiseDamage > 0) {
      groggyBroke = this.poise.damage(hit.poiseDamage * poiseScale, hit.hitTimeMs).broke;
      if (groggyBroke) this.action.interrupt();
    }

    if (this.hp <= 0) {
      this.alive = false;
      return { verdict: 'DEAD', damage, breakdown, block, groggyBroke, remainingHp: 0 };
    }

    const verdict: HitVerdict =
      block.outcome === 'BLOCK'
        ? 'BLOCKED'
        : block.outcome === 'GUARD_BREAK'
          ? 'GUARD_BROKEN'
          : 'DAMAGED';

    return { verdict, damage, breakdown, block, groggyBroke, remainingHp: this.hp };
  }

  /** 패리당한 쪽에 적용 — 자세 게이지가 크게 깎인다(기획서 6-3-4) */
  sufferParry(nowMs: number): boolean {
    const result = this.poise.parryPunish(nowMs);
    if (result.broke) this.action.interrupt();
    return result.broke;
  }

  heal(amount: number): number {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = clamp(this.hp + amount, 0, this.opts.maxHp);
    return this.hp - before;
  }

  /* --------------------------- 틱 --------------------------- */

  update(dtMs: number, nowMs: number) {
    const snapshot = this.action.update(dtMs);
    this.stamina.update(dtMs, nowMs, this.inCombat(nowMs));
    this.poise.update(dtMs, nowMs);
    this.guard.update(dtMs, nowMs, this.stamina);
    // MP 자연 회복
    this.mp = clamp(this.mp + (this.opts.maxMp * 0.02 * dtMs) / 1000, 0, this.opts.maxMp);
    return snapshot;
  }

  reset(): void {
    this.hp = this.opts.maxHp;
    this.mp = this.opts.maxMp;
    this.alive = true;
    this.action.interrupt();
    this.combo.reset();
    this.stamina.refill();
    this.poise.reset();
    this.guard.reset();
    this.cooldowns.clear();
  }
}
