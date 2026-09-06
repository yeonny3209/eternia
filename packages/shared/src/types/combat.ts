/**
 * 기획서 6-3절 — 논타겟 액션 전투 타입.
 * 자동 명중은 존재하지 않는다. 모든 공격은 히트박스 판정이다.
 */
import type { Element, Vec2 } from './core.js';

/** 기획서 6-3-2 ①. 히트박스 형태 6종 */
export type HitboxKind = 'SECTOR' | 'LINE' | 'CIRCLE' | 'PROJECTILE' | 'DASH' | 'GROUND';

export interface HitboxSector {
  type: 'SECTOR';
  /** 사거리(m) */
  range: number;
  /** 부채꼴 전체 각도(도) */
  angle: number;
}
export interface HitboxLine {
  type: 'LINE';
  /** 관통 길이(m) */
  length: number;
  /** 폭(m) */
  width: number;
  /** 관통 최대 대상 수. 0 = 무제한 */
  pierce?: number;
}
export interface HitboxCircle {
  type: 'CIRCLE';
  radius: number;
  /** 시전자 기준 전방 오프셋(m). 착탄 지점 지정형 스킬에 사용 */
  offset?: number;
}
export interface HitboxProjectile {
  type: 'PROJECTILE';
  radius: number;
  /** m/s */
  speed: number;
  /** 최대 비행 거리(m) */
  maxDistance: number;
  /** 관통 대상 수. 0 = 관통 없음(첫 명중 시 소멸) */
  pierce?: number;
  /** 중력(m/s^2). 포물선 투사체용 */
  gravity?: number;
}
export interface HitboxDash {
  type: 'DASH';
  /** 돌진 거리(m) */
  distance: number;
  /** 경로 폭(m) */
  width: number;
}
export interface HitboxGround {
  type: 'GROUND';
  radius: number;
  /** 장판 유지 시간(ms) */
  durationMs: number;
  /** 재판정 주기(ms) */
  tickMs: number;
  offset?: number;
}

export type Hitbox =
  | HitboxSector
  | HitboxLine
  | HitboxCircle
  | HitboxProjectile
  | HitboxDash
  | HitboxGround;

/** 히트 판정 대상 — 원형 충돌체로 근사한다(기획서 2-1: 자체 구현 AABB + 원/부채꼴) */
export interface HitTarget {
  id: string;
  pos: Vec2;
  /** 충돌 반지름(m) */
  radius: number;
  /** 대상이 바라보는 방향(라디안) — 배후 판정에 사용 */
  facing: number;
  /** 무적(회피 i-frame, 무적기) */
  invulnerable?: boolean;
}

/** 히트 판정 시전자 정보 */
export interface HitSource {
  pos: Vec2;
  /** 조준 방향(라디안). 커서를 향한다 */
  aim: number;
}

export interface HitResult {
  targetId: string;
  /** 시전자 기준 피격 위치 관계 — positionMultiplier 산출용 */
  position: 'FRONT' | 'SIDE' | 'BACK';
  distance: number;
}

/** 기획서 6-3-2 ②. 스킬 페이즈 — 선딜 / 판정 / 후딜 */
export type ActionPhase = 'IDLE' | 'STARTUP' | 'ACTIVE' | 'RECOVERY';

/** 기획서 6-3-2 ②. 프레임 데이터는 전부 JSON으로 뺀다(M1 튜닝용) */
export interface FrameData {
  /** 선딜(ms) — 이 구간은 원칙적으로 캔슬 불가 */
  startupMs: number;
  /** 판정 지속(ms) */
  activeMs: number;
  /** 후딜(ms) — 회피·다른 스킬로 캔슬 가능 */
  recoveryMs: number;
  /** true면 선딜 중에도 회피로 캔슬 가능 */
  cancelable?: boolean;
}

export type CcKind =
  | 'NONE'
  | 'STUN'
  | 'ROOT'
  | 'SILENCE'
  | 'DISPLACE'
  | 'CHARM'
  | 'SLOW'
  | 'GROGGY';

export interface SkillCc {
  type: CcKind;
  durationMs?: number;
  /** 보스에게는 축소 적용(기획서 7-2 서리 감옥: 보스는 슬로우로 대체) */
  bossDurationMs?: number;
}

/**
 * 스킬 정의. JSON(packages/shared/src/data/skills/*.json)에서 로드된다.
 * coef는 PvE/PvP를 완전히 분리한다(기획서 6-3-5 contextCoef).
 */
export interface SkillDef {
  id: string;
  name: string;
  classId: string;
  kind: 'ACTIVE' | 'PASSIVE' | 'ULTIMATE';
  /** 계수. pvp는 별책 PvP 기획서에서 사용 */
  coef: { pve: number; pvp: number };
  frames: FrameData;
  hitbox: Hitbox | null;
  cc: SkillCc;
  cooldownMs: number;
  mpCost: number;
  element: Element;
  /** 자세 게이지 감소량(기획서 6-3-3) */
  poiseDamage: number;
  /** 시전 중 이동 가능 여부 */
  movable: boolean;
  description: string;
  /** PvP 전용 재정의(별책 PvP 기획서 2-1) */
  pvpOverride?: Partial<{
    cooldownMs: number;
    ccDurationMs: number;
    range: number;
    executeThreshold: number;
  }>;
}

/** 기획서 6-3-5 데미지 공식 입력 */
export interface DamageInput {
  atk: number;
  skillCoef: number;
  comboMultiplier: number;
  flatBonus: number;
  def: number;
  attackerLevel: number;
  isCrit: boolean;
  critDmgBonus: number;
  /** 0.75 / 1.0 / 1.3 */
  elementMultiplier: number;
  position: 'FRONT' | 'SIDE' | 'BACK';
  /** 대상이 그로기 상태인가 */
  targetGroggy: boolean;
  dmgIncrease: number;
  dmgReduction: number;
  /** PvE 1.0 / PvP는 스킬별 pvpCoef */
  contextCoef: number;
  /** 0..1 난수. 테스트 결정성을 위해 주입한다 */
  roll: number;
}

export interface DamageBreakdown {
  base: number;
  afterDef: number;
  final: number;
  defReduction: number;
  critMultiplier: number;
  positionMultiplier: number;
  groggyMultiplier: number;
}
