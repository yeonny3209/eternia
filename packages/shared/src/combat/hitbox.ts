/**
 * 기획서 6-3-2 ① — 히트박스 엔진.
 *
 * 자동 명중은 존재하지 않는다. 모든 공격은 여기서 판정된다.
 * 물리 엔진을 쓰지 않는다(기획서 2-1). 원/부채꼴/캡슐 판정만 자체 구현한다.
 *
 * 좌표계: 2D 탑다운. x 오른쪽, y 아래. 각도는 라디안, +x축 기준 시계방향.
 * 대상은 반지름을 가진 원으로 근사한다.
 */
import type {
  HitResult,
  HitSource,
  HitTarget,
  Hitbox,
  HitboxCircle,
  HitboxDash,
  HitboxGround,
  HitboxLine,
  HitboxProjectile,
  HitboxSector,
} from '../types/combat.js';
import { angleDelta, clamp, type Vec2 } from '../types/core.js';

/** 점 p 에서 선분 ab 까지의 최단거리 제곱 */
function distSqPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq === 0 ? 0 : clamp((apx * abx + apy * aby) / abLenSq, 0, 1);
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  return dx * dx + dy * dy;
}

/**
 * 피격 방향 판정 — 기획서 6-3-5 positionMultiplier.
 * 대상이 바라보는 방향(target.facing)과, 대상에서 공격자를 향하는 방향을 비교한다.
 * 정면 ±60도 = FRONT, 배후 ±60도 = BACK, 나머지 = SIDE.
 */
export function hitPosition(attackerPos: Vec2, target: HitTarget): HitResult['position'] {
  const toAttacker = Math.atan2(attackerPos.y - target.pos.y, attackerPos.x - target.pos.x);
  const diff = Math.abs(angleDelta(toAttacker, target.facing));
  if (diff <= Math.PI / 3) return 'FRONT';
  if (diff >= (Math.PI * 2) / 3) return 'BACK';
  return 'SIDE';
}

function makeResult(src: HitSource, t: HitTarget): HitResult {
  return {
    targetId: t.id,
    position: hitPosition(src.pos, t),
    distance: Math.hypot(t.pos.x - src.pos.x, t.pos.y - src.pos.y),
  };
}

/** 무적(회피 i-frame 등) 대상은 판정에서 제외된다 — 기획서 6-3-6 */
function selectable(t: HitTarget): boolean {
  return !t.invulnerable;
}

/** 가까운 순으로 정렬 후 최대 n개만 남긴다(관통 수 제한) */
function limitPierce(src: HitSource, hits: HitResult[], pierce: number | undefined): HitResult[] {
  if (!pierce || pierce <= 0) return hits;
  return [...hits].sort((a, b) => a.distance - b.distance).slice(0, pierce);
}

/** 부채꼴 — 검사 참격, 창술사 휩쓸기 */
export function resolveSector(src: HitSource, box: HitboxSector, targets: HitTarget[]): HitResult[] {
  const half = (box.angle * Math.PI) / 180 / 2;
  const out: HitResult[] = [];
  for (const t of targets) {
    if (!selectable(t)) continue;
    const dx = t.pos.x - src.pos.x;
    const dy = t.pos.y - src.pos.y;
    const dist = Math.hypot(dx, dy);
    // 대상 반지름만큼 사거리를 관대하게 본다(가장자리 스침도 명중)
    if (dist > box.range + t.radius) continue;
    if (dist <= t.radius) {
      // 겹쳐 있으면 각도와 무관하게 명중
      out.push(makeResult(src, t));
      continue;
    }
    const toTarget = Math.atan2(dy, dx);
    // 대상 반지름이 만드는 각도 여유
    const angularSlack = Math.asin(clamp(t.radius / dist, 0, 1));
    if (Math.abs(angleDelta(toTarget, src.aim)) <= half + angularSlack) {
      out.push(makeResult(src, t));
    }
  }
  return out;
}

/** 직선 관통 — 창술사 관통 찌르기, 궁수 조준 사격 */
export function resolveLine(src: HitSource, box: HitboxLine, targets: HitTarget[]): HitResult[] {
  const end: Vec2 = {
    x: src.pos.x + Math.cos(src.aim) * box.length,
    y: src.pos.y + Math.sin(src.aim) * box.length,
  };
  const halfWidth = box.width / 2;
  const hits: HitResult[] = [];
  for (const t of targets) {
    if (!selectable(t)) continue;
    const r = halfWidth + t.radius;
    if (distSqPointSegment(t.pos, src.pos, end) <= r * r) hits.push(makeResult(src, t));
  }
  return limitPierce(src, hits, box.pierce);
}

/** 원형 — 마법사 화염구 착탄, 유성 낙하. offset이 있으면 전방으로 밀어 판정한다 */
export function resolveCircle(src: HitSource, box: HitboxCircle, targets: HitTarget[]): HitResult[] {
  const offset = box.offset ?? 0;
  const center: Vec2 = {
    x: src.pos.x + Math.cos(src.aim) * offset,
    y: src.pos.y + Math.sin(src.aim) * offset,
  };
  const out: HitResult[] = [];
  for (const t of targets) {
    if (!selectable(t)) continue;
    const r = box.radius + t.radius;
    const dx = t.pos.x - center.x;
    const dy = t.pos.y - center.y;
    if (dx * dx + dy * dy <= r * r) out.push(makeResult(src, t));
  }
  return out;
}

/**
 * 돌진 판정 — 암살자 잔상, 용기병 도약.
 * 시작점에서 조준 방향으로 distance만큼의 경로(캡슐)에 닿은 대상 전부.
 */
export function resolveDash(src: HitSource, box: HitboxDash, targets: HitTarget[]): HitResult[] {
  const end: Vec2 = {
    x: src.pos.x + Math.cos(src.aim) * box.distance,
    y: src.pos.y + Math.sin(src.aim) * box.distance,
  };
  const halfWidth = box.width / 2;
  const out: HitResult[] = [];
  for (const t of targets) {
    if (!selectable(t)) continue;
    const r = halfWidth + t.radius;
    if (distSqPointSegment(t.pos, src.pos, end) <= r * r) out.push(makeResult(src, t));
  }
  return out;
}

/** 설치 장판 — 연금술사 조합물, 도적 함정. 판정 자체는 원형과 같다 */
export function resolveGround(src: HitSource, box: HitboxGround, targets: HitTarget[]): HitResult[] {
  return resolveCircle(
    src,
    { type: 'CIRCLE', radius: box.radius, offset: box.offset ?? 0 },
    targets,
  );
}

/**
 * 투사체 — 서버가 소유한다(기획서 6-3-6). 클라는 시각적 복제본만 그린다.
 * 생성 후 매 틱 step()으로 전진시키고, 명중/사거리 초과 시 dead가 된다.
 */
export class Projectile {
  readonly id: string;
  readonly ownerId: string;
  pos: Vec2;
  readonly dir: Vec2;
  readonly box: HitboxProjectile;
  /** 서버가 확정한 생성 시각(ms) */
  readonly spawnedAt: number;
  traveled = 0;
  velocityY = 0;
  dead = false;
  readonly hitIds = new Set<string>();

  constructor(
    id: string,
    ownerId: string,
    origin: Vec2,
    aim: number,
    box: HitboxProjectile,
    spawnedAt: number,
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.pos = { x: origin.x, y: origin.y };
    this.dir = { x: Math.cos(aim), y: Math.sin(aim) };
    this.box = box;
    this.spawnedAt = spawnedAt;
  }

  /**
   * dtMs만큼 전진시키고 이번 구간에서 명중한 대상을 반환한다.
   * 프레임 사이를 건너뛴 관통(터널링)을 막기 위해 이동 구간 전체를 선분으로 판정한다.
   */
  step(dtMs: number, targets: HitTarget[]): HitResult[] {
    if (this.dead) return [];
    const dt = dtMs / 1000;
    const prev: Vec2 = { x: this.pos.x, y: this.pos.y };
    const dist = this.box.speed * dt;

    this.pos = { x: this.pos.x + this.dir.x * dist, y: this.pos.y + this.dir.y * dist };
    if (this.box.gravity) {
      this.velocityY += this.box.gravity * dt;
      this.pos.y += this.velocityY * dt;
    }
    this.traveled += dist;

    const src: HitSource = { pos: prev, aim: Math.atan2(this.dir.y, this.dir.x) };
    const hits: HitResult[] = [];
    for (const t of targets) {
      if (t.id === this.ownerId || !selectable(t) || this.hitIds.has(t.id)) continue;
      const r = this.box.radius + t.radius;
      if (distSqPointSegment(t.pos, prev, this.pos) <= r * r) {
        this.hitIds.add(t.id);
        hits.push(makeResult(src, t));
      }
    }

    const pierce = this.box.pierce ?? 0;
    if (hits.length > 0 && (pierce === 0 || this.hitIds.size >= pierce)) this.dead = true;
    if (this.traveled >= this.box.maxDistance) this.dead = true;
    return hits;
  }
}

/**
 * 히트박스 종류에 따라 알맞은 판정 함수로 분기한다.
 * PROJECTILE은 즉시 판정이 아니라 Projectile 인스턴스로 다뤄야 하므로 빈 배열을 반환한다.
 */
export function resolveHitbox(
  src: HitSource,
  box: Hitbox | null,
  targets: HitTarget[],
): HitResult[] {
  if (!box) return [];
  switch (box.type) {
    case 'SECTOR':
      return resolveSector(src, box, targets);
    case 'LINE':
      return resolveLine(src, box, targets);
    case 'CIRCLE':
      return resolveCircle(src, box, targets);
    case 'DASH':
      return resolveDash(src, box, targets);
    case 'GROUND':
      return resolveGround(src, box, targets);
    case 'PROJECTILE':
      return [];
  }
}
