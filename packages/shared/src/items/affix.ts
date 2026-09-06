/**
 * 기획서 6-4-3 / 6-4-4 — 아이템 롤 & 접사 엔진.
 *
 * 등급이 접사 줄 수를 정하고(6-4-2), 접사 티어는 아이템 레벨에 따라 분포가 달라진다.
 * 모든 난수는 주입된 rng를 쓴다 — 서버 시드로만 계산해야 하기 때문이다(6-4-6).
 */
import affixData from '../data/affixes.json' with { type: 'json' };
import type {
  AffixDef,
  ItemDef,
  ItemInstance,
  Rarity,
  RolledAffix,
  StatRange,
} from '../types/item.js';
import { RARITY_META } from '../types/item.js';

export type Rng = () => number;

const PREFIXES = affixData.prefixes as unknown as AffixDef[];
const SUFFIXES = affixData.suffixes as unknown as AffixDef[];

export const ALL_AFFIXES: AffixDef[] = [...PREFIXES, ...SUFFIXES];

export const AFFIX_BY_ID = new Map<string, AffixDef>(ALL_AFFIXES.map((a) => [a.id, a]));

export interface LegendaryAffix {
  id: string;
  name: string;
  template: string;
  effect: AffixDef['effect'];
  value: number;
}
export const LEGENDARY_AFFIXES = affixData.legendaries as unknown as LegendaryAffix[];

/** 접사 종수 — 기획서 6-4-4 (접두 48 / 접미 36 / 전설 20) */
export const AFFIX_COUNTS = {
  prefix: PREFIXES.length * 6,
  suffix: SUFFIXES.length * 6,
  legendary: LEGENDARY_AFFIXES.length,
};

export const MAX_TIER = 6;

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/**
 * 아이템 레벨에 따른 티어 상한.
 * 저레벨 아이템에서 6티어가 나오면 성장 곡선이 무너진다.
 */
export function maxTierForLevel(levelReq: number): number {
  if (levelReq >= 46) return 6;
  if (levelReq >= 38) return 5;
  if (levelReq >= 28) return 4;
  if (levelReq >= 18) return 3;
  if (levelReq >= 8) return 2;
  return 1;
}

/**
 * 티어 롤 — 상한에 가까울수록 희박하다.
 * 가중치를 지수적으로 두어 "최상위 티어가 흔한" 상황을 막는다.
 */
export function rollTier(levelReq: number, rng: Rng): number {
  const cap = maxTierForLevel(levelReq);
  const weights: number[] = [];
  for (let t = 1; t <= cap; t += 1) weights.push(Math.pow(0.55, t - 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i] as number;
    if (r <= 0) return i + 1;
  }
  return 1;
}

/** 범위 내 무작위 롤 + 최대 롤(perfect) 판정 — 기획서 6-4-3 ① */
export function rollStat(range: StatRange, rng: Rng): { value: number; perfect: boolean } {
  const [min, max] = range;
  if (max <= min) return { value: min, perfect: true };
  const t = rng();
  const raw = min + (max - min) * t;
  const value = Number.isInteger(min) && Number.isInteger(max) ? Math.round(raw) : Number(raw.toFixed(2));
  return { value, perfect: value >= max };
}

export function rollAffix(def: AffixDef, levelReq: number, rng: Rng): RolledAffix {
  const tier = rollTier(levelReq, rng);
  const value = def.values[Math.min(tier, def.values.length) - 1] as number;
  return { affixId: def.id, tier, value };
}

/** 접사 표기 문자열 — "공격력 +44" */
export function describeAffix(rolled: RolledAffix): string {
  const def = AFFIX_BY_ID.get(rolled.affixId);
  if (!def) return rolled.affixId;
  return def.template.replace('{v}', String(rolled.value));
}

/**
 * 드롭 시 아이템 인스턴스를 만든다.
 * 접사는 접두→접미 순으로 채우되, 같은 접사가 두 번 붙지 않게 한다.
 */
export function rollItem(def: ItemDef, rng: Rng, uid = `it_${Math.floor(rng() * 1e12)}`): ItemInstance {
  const rolledStats: Record<string, number> = {};
  let allPerfect = Object.keys(def.baseStats).length > 0;

  for (const [key, range] of Object.entries(def.baseStats)) {
    const { value, perfect } = rollStat(range, rng);
    rolledStats[key] = value;
    if (!perfect) allPerfect = false;
  }

  const lines = Math.min(def.affixSlots, RARITY_META[def.rarity].affixLines);
  const affixes: RolledAffix[] = [];
  const used = new Set<string>();
  const pools: AffixDef[][] = [PREFIXES, SUFFIXES];

  for (let i = 0; i < lines; i += 1) {
    const pool = pools[i % 2] as AffixDef[];
    const candidates = pool.filter(
      (a) => !used.has(a.id) && (!a.slots || a.slots.includes(def.slot)),
    );
    const fallback = ALL_AFFIXES.filter((a) => !used.has(a.id));
    const chosen = candidates.length > 0 ? pick(candidates, rng) : fallback.length > 0 ? pick(fallback, rng) : null;
    if (!chosen) break;
    used.add(chosen.id);
    affixes.push(rollAffix(chosen, def.levelReq, rng));
  }

  return {
    uid,
    itemId: def.id,
    rolledStats,
    perfect: allPerfect,
    affixes,
    enhanceLevel: 0,
    sockets: new Array<string | null>(def.sockets).fill(null),
    bound: def.rarity === 'MYTHIC',
  };
}

/**
 * 재련 — 영웅 이상 부옵션 리롤. 1줄만 잠금(lock) 가능(기획서 6-4-6).
 * 잠긴 줄은 유지되고 나머지가 다시 굴려진다.
 */
export function reforge(instance: ItemInstance, def: ItemDef, rng: Rng): ItemInstance {
  const lockedCount = instance.affixes.filter((a) => a.locked).length;
  if (lockedCount > 1) throw new Error('재련은 1줄만 잠글 수 있습니다');

  const kept = instance.affixes.filter((a) => a.locked);
  const used = new Set(kept.map((a) => a.affixId));
  const rerollCount = instance.affixes.length - kept.length;
  const next: RolledAffix[] = [...kept];

  for (let i = 0; i < rerollCount; i += 1) {
    const candidates = ALL_AFFIXES.filter((a) => !used.has(a.id));
    if (candidates.length === 0) break;
    const chosen = pick(candidates, rng);
    used.add(chosen.id);
    next.push(rollAffix(chosen, def.levelReq, rng));
  }

  return { ...instance, affixes: next };
}

/** 접사 효과를 상시 환산값으로 합산 — balance-sim.ts가 쓴다 */
export function aggregateAffixEffects(affixes: RolledAffix[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const rolled of affixes) {
    const def = AFFIX_BY_ID.get(rolled.affixId);
    if (!def) continue;
    const uptime = def.effect.uptime ?? 1;
    const key = `${def.effect.stat}:${def.effect.mode}`;
    const magnitude = def.effect.mode === 'pct' ? rolled.value / 100 : rolled.value;
    totals[key] = (totals[key] ?? 0) + magnitude * uptime;
  }
  return totals;
}

export function rarityAffixLines(rarity: Rarity): number {
  return RARITY_META[rarity].affixLines;
}
