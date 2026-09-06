/**
 * 기획서 6-2절(스탯 6종), 15부(DB 스키마) 기반 공용 타입.
 * 클라이언트·서버가 공유한다. 여기 없는 타입은 서버 전용으로 두지 않는다.
 */

/** 기획서 6-2. 스탯 6종 */
export interface Stats {
  /** 힘 — 물리 공격력, 소지 무게 */
  str: number;
  /** 민첩 — 공격 속도, 회피, 이동속도 */
  agi: number;
  /** 지능 — 마법 공격력, 최대 MP */
  int: number;
  /** 체력 — 최대 HP, 물리 방어 */
  vit: number;
  /** 정신 — 마법 방어, 상태이상 저항, MP 회복 */
  wil: number;
  /** 행운 — 치명타 확률, 드롭률, 히든 발견 확률 */
  luk: number;
}

export const STAT_KEYS = ['str', 'agi', 'int', 'vit', 'wil', 'luk'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const zeroStats = (): Stats => ({ str: 0, agi: 0, int: 0, vit: 0, wil: 0, luk: 0 });

export const addStats = (a: Stats, b: Partial<Stats>): Stats => ({
  str: a.str + (b.str ?? 0),
  agi: a.agi + (b.agi ?? 0),
  int: a.int + (b.int ?? 0),
  vit: a.vit + (b.vit ?? 0),
  wil: a.wil + (b.wil ?? 0),
  luk: a.luk + (b.luk ?? 0),
});

/** 기획서 7부. 역할 태그 — 파티 매칭에 사용 */
export type RoleTag = 'TANK' | 'HEAL' | 'DPS' | 'SUPPORT' | 'CONTROL';

/** 기획서 4-3. 시작 배경 5종 */
export type BackgroundId =
  | 'fallen_noble'
  | 'border_mercenary'
  | 'rift_survivor'
  | 'guild_apprentice'
  | 'nameless_orphan';

/** 기획서 3-2. 세 세력 */
export type FactionId = 'silver_constellation' | 'aether_guild' | 'nameless_children';

/** 기획서 9-4. 6막 최종 선택 → 엔딩 분기 */
export type EndingId = 'seal' | 'manage' | 'restart';

/** 속성 — 기획서 6-3-5 elementMultiplier */
export type Element = 'NONE' | 'FIRE' | 'ICE' | 'LIGHTNING' | 'LIGHT' | 'DARK';

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const vsub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vlen = (v: Vec2): number => Math.hypot(v.x, v.y);
export const vdist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vnorm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
};
/** 두 각도 사이의 부호 있는 최소 차이(라디안). -PI..PI */
export const angleDelta = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
