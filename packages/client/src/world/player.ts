/**
 * 플레이어 상태와 파생 스탯.
 *
 * 저장은 localStorage에 한다. 서버가 없어도 지인에게 링크만 주면
 * 각자 진행이 남아야 하기 때문이다. 서버가 붙으면 이 모듈의
 * load/save만 API 호출로 바꾸면 된다.
 */
import {
  FREE_POINTS_PER_LEVEL,
  ITEM_BY_ID,
  rollItem,
  MAX_LEVEL,
  SKILL_POINTS_PER_LEVEL,
  awakenStatMultiplier,
  critRate as critRateOf,
  enhanceMultiplier,
  expForLevel,
  type BackgroundId,
  type EquipSlot,
  type ItemInstance,
  type QuestProgress,
  type Stats,
} from '@eternia/shared';

export interface PlayerState {
  version: 1;
  nickname: string;
  background: BackgroundId;
  /** 5레벨에 결정한다 (기획서 4-1) */
  classId: string | null;
  hiddenClassId: string | null;
  level: number;
  exp: number;
  awakenRank: number;
  awakenPoint: number;
  stats: Stats;
  freePoints: number;
  skillPoints: number;
  gold: number;
  mapId: string;
  hp: number;
  mp: number;
  inventory: ItemInstance[];
  /** 슬롯 → 인벤토리 uid */
  equipment: Partial<Record<EquipSlot, string>>;
  quests: QuestProgress[];
  completedQuests: string[];
  visitedMaps: string[];
  /** 처치 누적 — 도감/통계용 */
  kills: Record<string, number>;
  playtimeMs: number;
  createdAt: number;
}

export const BACKGROUNDS: Record<
  BackgroundId,
  { name: string; bonus: Partial<Stats>; gold: number; note: string }
> = {
  fallen_noble: { name: '몰락 귀족', bonus: { int: 2 }, gold: 900, note: 'INT+2 · 시작 골드 3배' },
  border_mercenary: { name: '국경 용병', bonus: { str: 2, vit: 1 }, gold: 300, note: 'STR+2 VIT+1' },
  rift_survivor: { name: '균열 생존자', bonus: { wil: 3 }, gold: 300, note: 'WIL+3 · 균열 단서 선공개' },
  guild_apprentice: { name: '조합 견습생', bonus: {}, gold: 300, note: '제작 숙련도 +10%' },
  nameless_orphan: { name: '이름 없는 고아', bonus: { luk: 3 }, gold: 300, note: 'LUK+3 · 히든 조건 완화' },
};

const BASE_STATS: Stats = { str: 5, agi: 5, int: 5, vit: 5, wil: 5, luk: 5 };

/** 기획서 T-02 / T-03이 튜토리얼에서 쥐여주는 것들 */
function startingInventory(): ItemInstance[] {
  const items: ItemInstance[] = [];
  const sword = ITEM_BY_ID.get('item_old_sword');
  if (sword) items.push(rollItem(sword, Math.random, 'start_sword'));
  const potion = ITEM_BY_ID.get('item_lesser_potion');
  if (potion) {
    for (let i = 0; i < 5; i += 1) {
      items.push(rollItem(potion, Math.random, `start_potion_${i}`));
    }
  }
  return items;
}

export function createPlayer(nickname: string, background: BackgroundId): PlayerState {
  const stats: Stats = { ...BASE_STATS };
  for (const [key, value] of Object.entries(BACKGROUNDS[background].bonus)) {
    stats[key as keyof Stats] += value as number;
  }
  const inventory = startingInventory();
  const sword = inventory.find((i) => i.itemId === 'item_old_sword');
  return {
    version: 1,
    nickname,
    background,
    classId: null,
    hiddenClassId: null,
    level: 1,
    exp: 0,
    awakenRank: 0,
    awakenPoint: 0,
    stats,
    freePoints: FREE_POINTS_PER_LEVEL,
    skillPoints: SKILL_POINTS_PER_LEVEL,
    gold: BACKGROUNDS[background].gold,
    mapId: 'dawnhollow',
    hp: 0,
    mp: 0,
    inventory,
    equipment: sword ? { MAIN_HAND: sword.uid } : {},
    quests: [],
    completedQuests: [],
    visitedMaps: ['dawnhollow'],
    kills: {},
    playtimeMs: 0,
    createdAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* 파생 스탯                                                            */
/* ------------------------------------------------------------------ */

export interface DerivedStats {
  maxHp: number;
  maxMp: number;
  atk: number;
  def: number;
  critRate: number;
  critDmg: number;
  moveSpeed: number;
  /** 장비에서 온 몫만 따로 — UI에 "+120" 식으로 보여준다 */
  gearAtk: number;
  gearDef: number;
  totalStats: Stats;
}

/** 장착 중인 장비가 주는 스탯 합 */
export function equippedStats(player: PlayerState): { stats: Partial<Stats>; atk: number; def: number } {
  const stats: Partial<Stats> = {};
  let atk = 0;
  let def = 0;

  for (const uid of Object.values(player.equipment)) {
    if (!uid) continue;
    const instance = player.inventory.find((i) => i.uid === uid);
    if (!instance) continue;
    const multiplier = enhanceMultiplier(instance.enhanceLevel);
    for (const [key, value] of Object.entries(instance.rolledStats)) {
      const scaled = value * multiplier;
      if (key === 'atk') atk += scaled;
      else if (key === 'def') def += scaled;
      else stats[key as keyof Stats] = (stats[key as keyof Stats] ?? 0) + scaled;
    }
  }
  return { stats, atk: Math.round(atk), def: Math.round(def) };
}

export function derivedStats(player: PlayerState): DerivedStats {
  const gear = equippedStats(player);
  const total: Stats = { ...player.stats };
  for (const [key, value] of Object.entries(gear.stats)) {
    total[key as keyof Stats] += value as number;
  }

  const awaken = awakenStatMultiplier(player.awakenRank);
  const maxHp = Math.round((260 + player.level * 52 + total.vit * 26) * awaken);
  const maxMp = Math.round((80 + player.level * 8 + total.int * 6) * awaken);
  // 무기가 없어도 맨손으로 싸울 수 있어야 한다
  const atk = Math.round((14 + player.level * 4 + total.str * 3.2 + total.int * 1.1 + gear.atk) * awaken);
  const def = Math.round((4 + player.level * 1.6 + total.vit * 1.4 + gear.def) * awaken);

  return {
    maxHp,
    maxMp,
    atk,
    def,
    critRate: critRateOf(total.luk, 0.05),
    critDmg: 0.15 + total.luk * 0.002,
    moveSpeed: 5.0 + total.agi * 0.012,
    gearAtk: gear.atk,
    gearDef: gear.def,
    totalStats: total,
  };
}

/* ------------------------------------------------------------------ */
/* 성장                                                                 */
/* ------------------------------------------------------------------ */

export interface LevelUpResult {
  levelsGained: number;
  newLevel: number;
  /** 5레벨에 도달해 직업을 골라야 하는가 */
  needsClassChoice: boolean;
}

export function gainExp(player: PlayerState, amount: number): LevelUpResult {
  let levelsGained = 0;
  const before = player.level;

  if (player.level >= MAX_LEVEL) {
    // 50레벨 이후 경험치는 각성 포인트로 전환된다 (기획서 6-1)
    player.awakenPoint += amount;
    return { levelsGained: 0, newLevel: player.level, needsClassChoice: false };
  }

  player.exp += amount;
  while (player.level < MAX_LEVEL && player.exp >= expForLevel(player.level)) {
    player.exp -= expForLevel(player.level);
    player.level += 1;
    player.freePoints += FREE_POINTS_PER_LEVEL;
    player.skillPoints += SKILL_POINTS_PER_LEVEL;
    levelsGained += 1;
  }

  return {
    levelsGained,
    newLevel: player.level,
    needsClassChoice: before < 5 && player.level >= 5 && player.classId === null,
  };
}

export function expProgress(player: PlayerState): { current: number; required: number; ratio: number } {
  if (player.level >= MAX_LEVEL) {
    return { current: player.awakenPoint, required: 0, ratio: 1 };
  }
  const required = expForLevel(player.level);
  return { current: player.exp, required, ratio: Math.min(1, player.exp / required) };
}

/* ------------------------------------------------------------------ */
/* 인벤토리                                                             */
/* ------------------------------------------------------------------ */

export const INVENTORY_CAPACITY = 60;

export function addItem(player: PlayerState, instance: ItemInstance): boolean {
  if (player.inventory.length >= INVENTORY_CAPACITY) return false;
  player.inventory.push(instance);
  return true;
}

export function equipItem(player: PlayerState, uid: string): boolean {
  const instance = player.inventory.find((i) => i.uid === uid);
  if (!instance) return false;
  const def = ITEM_BY_ID.get(instance.itemId);
  if (!def) return false;
  if (def.levelReq > player.level) return false;
  // 소모품·재료는 장착할 수 없다
  if (def.affixPool === 'pool_consumable' || def.affixPool === 'pool_material' || def.affixPool === 'pool_gem') {
    return false;
  }
  player.equipment[def.slot] = uid;
  return true;
}

export function unequipSlot(player: PlayerState, slot: EquipSlot): void {
  delete player.equipment[slot];
}

/** 소모품 — 기획서 6-3-1의 퀵슬롯 1~5 자리 */
export const POTION_ITEM_ID = 'item_lesser_potion';
export const POTION_HEAL = 150;

export function potionCount(player: PlayerState): number {
  return player.inventory.filter((i) => i.itemId === POTION_ITEM_ID).length;
}

/** 물약 하나를 소모한다. 없으면 false */
export function consumePotion(player: PlayerState): boolean {
  const index = player.inventory.findIndex((i) => i.itemId === POTION_ITEM_ID);
  if (index < 0) return false;
  player.inventory.splice(index, 1);
  return true;
}

export function isEquipped(player: PlayerState, uid: string): boolean {
  return Object.values(player.equipment).includes(uid);
}

export function dropItem(player: PlayerState, uid: string): void {
  const def = player.inventory.find((i) => i.uid === uid);
  if (def) {
    for (const [slot, equippedUid] of Object.entries(player.equipment)) {
      if (equippedUid === uid) delete player.equipment[slot as EquipSlot];
    }
  }
  player.inventory = player.inventory.filter((i) => i.uid !== uid);
}

/* ------------------------------------------------------------------ */
/* 저장                                                                 */
/* ------------------------------------------------------------------ */

const SAVE_KEY = 'eternia.save.v1';

export function save(player: PlayerState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(player));
  } catch {
    // 시크릿 모드 등에서 저장이 막힐 수 있다. 게임은 계속 돌아가야 한다.
  }
}

export function load(): PlayerState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerState;
    if (parsed.version !== 1) return null;
    // 오래된 저장본에 없던 필드를 채운다
    parsed.kills ??= {};
    parsed.visitedMaps ??= [parsed.mapId];
    parsed.completedQuests ??= [];
    parsed.quests ??= [];
    parsed.inventory ??= [];
    parsed.equipment ??= {};
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* 무시 */
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}
