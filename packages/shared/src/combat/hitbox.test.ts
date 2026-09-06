/** 기획서 6-3-2 ① 히트박스 6종 판정 테스트 */
import { describe, expect, it } from 'vitest';
import {
  Projectile,
  hitPosition,
  resolveCircle,
  resolveDash,
  resolveGround,
  resolveHitbox,
  resolveLine,
  resolveSector,
} from './hitbox.js';
import type { HitSource, HitTarget } from '../types/combat.js';

const src: HitSource = { pos: { x: 0, y: 0 }, aim: 0 }; // +x 방향을 본다

const target = (id: string, x: number, y: number, radius = 0.5, facing = Math.PI): HitTarget => ({
  id,
  pos: { x, y },
  radius,
  facing,
});

describe('SECTOR — 부채꼴', () => {
  it('사거리 안, 각도 안이면 명중', () => {
    const hits = resolveSector(src, { type: 'SECTOR', range: 3, angle: 90 }, [target('a', 2, 0)]);
    expect(hits.map((h) => h.targetId)).toEqual(['a']);
  });

  it('사거리 밖이면 빗나감', () => {
    const hits = resolveSector(src, { type: 'SECTOR', range: 3, angle: 90 }, [target('a', 6, 0)]);
    expect(hits).toHaveLength(0);
  });

  it('각도 밖(뒤쪽)이면 빗나감', () => {
    const hits = resolveSector(src, { type: 'SECTOR', range: 3, angle: 90 }, [target('a', -2, 0)]);
    expect(hits).toHaveLength(0);
  });

  it('360도 부채꼴은 전방위를 친다 (창술사 휩쓸기)', () => {
    const hits = resolveSector(src, { type: 'SECTOR', range: 4, angle: 360 }, [
      target('a', 2, 0),
      target('b', -2, 0),
      target('c', 0, 3),
    ]);
    expect(hits).toHaveLength(3);
  });

  it('대상 반지름만큼 가장자리를 관대하게 본다 — 스침도 명중', () => {
    // 각도 경계 바로 바깥이지만 반지름이 커서 부채꼴에 걸친다
    const wide = target('a', 2, 2.05, 0.9);
    const hits = resolveSector(src, { type: 'SECTOR', range: 4, angle: 90 }, [wide]);
    expect(hits).toHaveLength(1);
  });

  it('무적 대상은 판정에서 제외된다', () => {
    const t = { ...target('a', 2, 0), invulnerable: true };
    expect(resolveSector(src, { type: 'SECTOR', range: 3, angle: 90 }, [t])).toHaveLength(0);
  });
});

describe('LINE — 직선 관통', () => {
  it('선분 폭 안의 대상을 전부 맞춘다', () => {
    const hits = resolveLine(src, { type: 'LINE', length: 10, width: 1 }, [
      target('a', 2, 0),
      target('b', 5, 0.3),
      target('c', 8, 4),
    ]);
    expect(hits.map((h) => h.targetId).sort()).toEqual(['a', 'b']);
  });

  it('pierce 수만큼만, 가까운 순으로 남긴다', () => {
    const hits = resolveLine(src, { type: 'LINE', length: 12, width: 1, pierce: 2 }, [
      target('far', 9, 0),
      target('near', 2, 0),
      target('mid', 5, 0),
    ]);
    expect(hits.map((h) => h.targetId)).toEqual(['near', 'mid']);
  });
});

describe('CIRCLE — 원형 착탄', () => {
  it('offset만큼 전방에서 터진다', () => {
    const box = { type: 'CIRCLE', radius: 2, offset: 6 } as const;
    // 착탄점 (6,0) 기준
    expect(resolveCircle(src, box, [target('a', 6, 1)])).toHaveLength(1);
    // 시전자 발밑은 안 맞는다
    expect(resolveCircle(src, box, [target('b', 0, 0)])).toHaveLength(0);
  });
});

describe('DASH — 이동 판정', () => {
  it('돌진 경로에 걸친 대상을 전부 맞춘다', () => {
    const hits = resolveDash(src, { type: 'DASH', distance: 6, width: 2 }, [
      target('a', 1, 0.8),
      target('b', 5, 0),
      target('c', 5, 5),
    ]);
    expect(hits.map((h) => h.targetId).sort()).toEqual(['a', 'b']);
  });
});

describe('GROUND — 설치 장판', () => {
  it('원형과 같은 판정을 쓴다', () => {
    const hits = resolveGround(
      src,
      { type: 'GROUND', radius: 3, durationMs: 5000, tickMs: 500, offset: 4 },
      [target('a', 4, 1)],
    );
    expect(hits).toHaveLength(1);
  });
});

describe('PROJECTILE — 서버가 소유하는 투사체', () => {
  it('전진하며 명중하고, 관통이 없으면 소멸한다', () => {
    const p = new Projectile('p1', 'owner', { x: 0, y: 0 }, 0, {
      type: 'PROJECTILE',
      radius: 0.3,
      speed: 10,
      maxDistance: 20,
      pierce: 0,
    }, 1000);

    expect(p.step(100, [target('a', 5, 0)])).toHaveLength(0); // 1m 전진, 아직 못 닿음
    const hits = p.step(500, [target('a', 5, 0)]); // 6m 지점까지 이동 → 통과하며 명중
    expect(hits.map((h) => h.targetId)).toEqual(['a']);
    expect(p.dead).toBe(true);
  });

  it('한 틱에 지나쳐도 놓치지 않는다 (터널링 방지)', () => {
    const p = new Projectile('p2', 'owner', { x: 0, y: 0 }, 0, {
      type: 'PROJECTILE',
      radius: 0.2,
      speed: 200, // 매우 빠름
      maxDistance: 30,
      pierce: 0,
    }, 0);
    // 33ms(1틱)에 6.6m 이동 — 중간의 대상을 건너뛰면 안 된다
    const hits = p.step(33, [target('a', 3, 0)]);
    expect(hits.map((h) => h.targetId)).toEqual(['a']);
  });

  it('시전자 자신은 맞지 않는다', () => {
    const p = new Projectile('p3', 'owner', { x: 0, y: 0 }, 0, {
      type: 'PROJECTILE',
      radius: 0.5,
      speed: 10,
      maxDistance: 10,
    }, 0);
    expect(p.step(100, [target('owner', 0.5, 0)])).toHaveLength(0);
  });

  it('최대 사거리를 넘으면 소멸한다', () => {
    const p = new Projectile('p4', 'owner', { x: 0, y: 0 }, 0, {
      type: 'PROJECTILE',
      radius: 0.3,
      speed: 10,
      maxDistance: 2,
    }, 0);
    p.step(1000, []);
    expect(p.dead).toBe(true);
  });
});

describe('hitPosition — 정면/측면/배후 판정 (기획서 6-3-5)', () => {
  it('대상이 공격자를 마주보면 FRONT', () => {
    // 대상은 (5,0)에서 -x 방향(π)을 본다 → 원점의 공격자를 마주본다
    expect(hitPosition({ x: 0, y: 0 }, target('a', 5, 0, 0.5, Math.PI))).toBe('FRONT');
  });

  it('대상이 등을 보이면 BACK', () => {
    expect(hitPosition({ x: 0, y: 0 }, target('a', 5, 0, 0.5, 0))).toBe('BACK');
  });

  it('옆을 보고 있으면 SIDE', () => {
    expect(hitPosition({ x: 0, y: 0 }, target('a', 5, 0, 0.5, Math.PI / 2))).toBe('SIDE');
  });
});

describe('resolveHitbox — 종류별 분기', () => {
  it('PROJECTILE은 즉시 판정하지 않는다 (Projectile 인스턴스로 다뤄야 한다)', () => {
    const hits = resolveHitbox(
      src,
      { type: 'PROJECTILE', radius: 1, speed: 10, maxDistance: 10 },
      [target('a', 1, 0)],
    );
    expect(hits).toEqual([]);
  });

  it('hitbox가 없는 스킬(버프/패시브)은 빈 결과', () => {
    expect(resolveHitbox(src, null, [target('a', 1, 0)])).toEqual([]);
  });
});
