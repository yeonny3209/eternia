/** 기획서 6-4절 — 장비 시스템 타입 (16슬롯 / 6등급 / 접사 / 세트 / 각인) */

/** 기획서 6-4-1. 장비 슬롯 16칸 */
export const EQUIP_SLOTS = [
  'MAIN_HAND',
  'OFF_HAND',
  'HELM',
  'SHOULDER',
  'CHEST',
  'GLOVES',
  'BELT',
  'BOOTS',
  'CLOAK',
  'NECKLACE',
  'EARRING_1',
  'EARRING_2',
  'RING_1',
  'RING_2',
  'BRACELET',
  'EMBLEM',
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** 기획서 6-4-2. 등급 6단계 */
export const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityMeta {
  ko: string;
  color: string;
  /** 접사 줄 수 */
  affixLines: number;
  /** 고유 효과 수 */
  uniqueEffects: number;
  tradable: boolean;
  /** 전설은 거래 3회 제한, 신화는 획득 즉시 귀속 (기획서 6-4-8) */
  tradeLimit?: number;
}

export const RARITY_META: Record<Rarity, RarityMeta> = {
  COMMON: { ko: '일반', color: '#d8d8d8', affixLines: 0, uniqueEffects: 0, tradable: true },
  UNCOMMON: { ko: '고급', color: '#4ade80', affixLines: 2, uniqueEffects: 0, tradable: true },
  RARE: { ko: '희귀', color: '#60a5fa', affixLines: 4, uniqueEffects: 0, tradable: true },
  EPIC: { ko: '영웅', color: '#c084fc', affixLines: 4, uniqueEffects: 1, tradable: true },
  LEGENDARY: {
    ko: '전설',
    color: '#fb923c',
    affixLines: 5,
    uniqueEffects: 2,
    tradable: true,
    tradeLimit: 3,
  },
  MYTHIC: { ko: '신화', color: '#f87171', affixLines: 6, uniqueEffects: 3, tradable: false },
};

export type WeaponType =
  | 'SWORD'
  | 'GREATSWORD'
  | 'STAFF'
  | 'DAGGER'
  | 'BOW'
  | 'SPEAR'
  | 'FETISH'
  | 'INSTRUMENT'
  | 'RELIC'
  | 'FLASK';

/** 범위 롤 — 드롭 시 범위 내 무작위 (기획서 6-4-3 ①) */
export type StatRange = [min: number, max: number];

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot;
  weaponType?: WeaponType;
  rarity: Rarity;
  levelReq: number;
  baseStats: Record<string, StatRange>;
  affixSlots: number;
  affixPool: string;
  setId: string | null;
  uniqueEffects: string[];
  sockets: number;
  tradable: boolean;
  /** 손으로 설계한 고유 아이템인가(영웅 이상). false면 generate-items.ts 생성물 */
  handcrafted?: boolean;
}

/** 기획서 6-4-4. 접사 */
export type AffixKind = 'PREFIX' | 'SUFFIX' | 'LEGENDARY';

export type AffixFamily =
  // 접두사 8계열
  | 'ATTACK'
  | 'CRIT'
  | 'SPEED'
  | 'SURVIVAL'
  | 'RESOURCE'
  | 'ELEMENT'
  | 'PENETRATION'
  | 'UTILITY'
  // 접미사 6계열
  | 'CONDITIONAL'
  | 'ON_KILL'
  | 'ON_HIT_TAKEN'
  | 'ON_DODGE'
  | 'ON_PARRY'
  | 'ON_GROGGY';

/**
 * 접사의 실제 효과. balance-sim.ts가 이걸 읽고 DPS를 계산한다.
 * 기획서 6-4-4: 접미사는 반드시 액션 조작과 연동되게 설계한다.
 */
export interface AffixEffect {
  stat:
    | 'atk'
    | 'critRate'
    | 'critDmg'
    | 'atkSpeed'
    | 'cooldown'
    | 'hp'
    | 'def'
    | 'mp'
    | 'stamina'
    | 'elementDmg'
    | 'penetration'
    | 'moveSpeed'
    | 'gold'
    | 'itemFind'
    | 'dmgIncrease';
  /** flat = 절대값, pct = 비율(0.05 = 5%) */
  mode: 'flat' | 'pct';
  /** 발동 조건. 없으면 상시 */
  trigger?: 'LOW_HP' | 'ON_KILL' | 'ON_HIT_TAKEN' | 'ON_DODGE' | 'ON_PARRY' | 'VS_GROGGY';
  /** 조건부 효과의 기대 가동률(0..1). 시뮬레이터가 상시 환산에 사용 */
  uptime?: number;
}

export interface AffixDef {
  id: string;
  kind: AffixKind;
  family: AffixFamily;
  name: string;
  /** 1~6티어. 티어별 수치는 values[tier-1] */
  values: number[];
  /** 표기 템플릿. {v}가 수치로 치환된다 */
  template: string;
  /** 적용 대상 슬롯. 비면 전체 */
  slots?: EquipSlot[];
  effect: AffixEffect;
}

/** 실제 인스턴스 — 드롭된 개별 아이템 */
export interface ItemInstance {
  uid: string;
  itemId: string;
  rolledStats: Record<string, number>;
  /** 최대 롤(100%) 여부 — 표시로 구분(★) */
  perfect: boolean;
  affixes: RolledAffix[];
  enhanceLevel: number;
  sockets: (string | null)[];
  bound: boolean;
}

export interface RolledAffix {
  affixId: string;
  tier: number;
  value: number;
  /** 재련 시 1줄만 잠금 가능 (기획서 6-4-6) */
  locked?: boolean;
}

/** 기획서 6-4-5. 세트 효과 */
export interface SetDef {
  id: string;
  name: string;
  pieces: string[];
  bonuses: { count: 2 | 4 | 6; description: string; effect?: AffixEffect }[];
}
