/**
 * tools/generate-items.ts — 일반~희귀 등급 자동 생성.
 *
 * 기획서 6-4-9:
 *   "800개를 손으로 쓰지 않는다. 템플릿 x 레벨 구간 x 무기타입을 조합해
 *    일반~희귀 등급을 자동 생성하고, 영웅 이상 약 120종만 손으로 설계한다."
 *
 * 손으로 설계한 것은 items.json, 생성물은 items.generated.json 으로 나뉜다.
 * 두 파일 모두 레지스트리가 읽고, validate-data.ts가 함께 검사한다.
 *
 *   npm run gen:items
 *
 * 목표 구성 (기획서 6-4-9 표)
 *   무기 240 = 10 무기타입 x 24 (레벨 구간 8 x 등급 3)
 *   방어구 300 = 6 부위 x 50
 *   장신구 120 = 6 부위 x 20
 *   문장 40 / 보석 60
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { EquipSlot, ItemDef, Rarity, WeaponType } from '../packages/shared/src/types/item.js';
import { RARITY_META } from '../packages/shared/src/types/item.js';
import { referencePlayerAtk } from '../packages/shared/src/formulas/progression.js';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/shared/src/data/items.generated.json',
);

/** 레벨 구간 8개 — 1~50을 고르게 덮는다 */
const LEVEL_BANDS = [1, 8, 15, 22, 28, 34, 40, 46];

/** 자동 생성 대상 등급 3종. 영웅 이상은 손으로 만든다 */
const AUTO_RARITIES: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE'];

const RARITY_POWER: Record<Rarity, number> = {
  COMMON: 0.7,
  UNCOMMON: 0.85,
  RARE: 1.0,
  EPIC: 1.25,
  LEGENDARY: 1.5,
  MYTHIC: 1.8,
};

interface WeaponTemplate {
  type: WeaponType;
  ko: string;
  /** 공격력 배율 — 양손무기가 세고 대신 느리다 */
  atkScale: number;
  mainStat: 'str' | 'agi' | 'int' | 'wil' | 'luk';
  names: string[];
}

const WEAPONS: WeaponTemplate[] = [
  { type: 'SWORD', ko: '검', atkScale: 1.0, mainStat: 'str', names: ['철검', '기사검', '월광검'] },
  { type: 'GREATSWORD', ko: '대검', atkScale: 1.35, mainStat: 'str', names: ['대검', '참마도', '분쇄검'] },
  { type: 'SPEAR', ko: '창', atkScale: 1.15, mainStat: 'str', names: ['장창', '미늘창', '천공창'] },
  { type: 'DAGGER', ko: '단검', atkScale: 0.75, mainStat: 'agi', names: ['단검', '쌍단검', '그림자칼'] },
  { type: 'BOW', ko: '활', atkScale: 1.05, mainStat: 'agi', names: ['단궁', '장궁', '석궁'] },
  { type: 'STAFF', ko: '지팡이', atkScale: 1.1, mainStat: 'int', names: ['지팡이', '마도장', '성수장'] },
  { type: 'RELIC', ko: '성구', atkScale: 0.9, mainStat: 'wil', names: ['성표', '성서', '기도구'] },
  { type: 'FETISH', ko: '주술구', atkScale: 0.95, mainStat: 'int', names: ['저주인형', '사슬', '부적'] },
  { type: 'INSTRUMENT', ko: '악기', atkScale: 0.85, mainStat: 'wil', names: ['리라', '전투북', '나팔'] },
  { type: 'FLASK', ko: '플라스크', atkScale: 0.9, mainStat: 'luk', names: ['플라스크', '기계 팔', '촉매'] },
];

interface ArmorTemplate {
  slot: EquipSlot;
  ko: string;
  /** 방어력 배율 */
  defScale: number;
  stat: 'vit' | 'agi' | 'str' | 'wil';
}

const ARMORS: ArmorTemplate[] = [
  { slot: 'HELM', ko: '투구', defScale: 0.8, stat: 'vit' },
  { slot: 'SHOULDER', ko: '어깨', defScale: 0.75, stat: 'str' },
  { slot: 'CHEST', ko: '갑옷', defScale: 1.2, stat: 'vit' },
  { slot: 'GLOVES', ko: '장갑', defScale: 0.6, stat: 'agi' },
  { slot: 'BELT', ko: '벨트', defScale: 0.55, stat: 'vit' },
  { slot: 'BOOTS', ko: '신발', defScale: 0.65, stat: 'agi' },
];

/** 방어구 재질 계열 — 부위 6 x 재질에 따라 50종을 만든다 */
const ARMOR_MATERIALS = ['가죽', '사슬', '판금', '비단', '용린', '균열강'];

const ACCESSORIES: { slot: EquipSlot; ko: string; stat: 'int' | 'wil' | 'luk' | 'agi' }[] = [
  { slot: 'NECKLACE', ko: '목걸이', stat: 'int' },
  { slot: 'EARRING_1', ko: '귀걸이', stat: 'wil' },
  { slot: 'EARRING_2', ko: '귀걸이', stat: 'wil' },
  { slot: 'RING_1', ko: '반지', stat: 'luk' },
  { slot: 'RING_2', ko: '반지', stat: 'luk' },
  { slot: 'BRACELET', ko: '팔찌', stat: 'agi' },
];

const ACCESSORY_PREFIX = ['수정', '호박', '은세공', '흑요석', '별빛'];

const EMBLEM_SOURCES = [
  ['은빛 성좌회', 'constellation'],
  ['에테르 조합', 'guild'],
  ['무명의 아이들', 'nameless'],
  ['기사단', 'knights'],
] as const;

const GEM_KINDS = [
  ['홍옥', 'atk'],
  ['청옥', 'def'],
  ['황옥', 'critRate'],
  ['녹옥', 'hp'],
  ['자수정', 'mp'],
] as const;

const GEM_GRADES = ['조각난', '거친', '다듬은', '빛나는', '완전한', '신성한'];

/** 레벨 구간 표기 */
const bandLabel = (level: number): string => {
  if (level <= 8) return '견습';
  if (level <= 15) return '숙련';
  if (level <= 22) return '정예';
  if (level <= 28) return '역전';
  if (level <= 34) return '영광';
  if (level <= 40) return '심연';
  if (level <= 46) return '천공';
  return '균열';
};

const items: ItemDef[] = [];

function range(center: number, spread = 0.12): [number, number] {
  const min = Math.max(1, Math.round(center * (1 - spread)));
  const max = Math.max(min + 1, Math.round(center * (1 + spread)));
  return [min, max];
}

/** 그 레벨대 무기가 가져야 할 공격력 — 기준 플레이어 곡선에서 역산한다 */
function weaponAtkAt(level: number): number {
  // 기준 ATK의 약 60%가 무기에서, 나머지는 스탯·장신구에서 나온다
  return referencePlayerAtk(level) * 0.6;
}

function armorDefAt(level: number): number {
  return 6 + level * 4.2;
}

/* ------------------------------- 무기 240 ------------------------------- */
for (const weapon of WEAPONS) {
  for (const level of LEVEL_BANDS) {
    for (const rarity of AUTO_RARITIES) {
      const power = RARITY_POWER[rarity];
      const atk = weaponAtkAt(level) * weapon.atkScale * power;
      const nameIndex = LEVEL_BANDS.indexOf(level) % weapon.names.length;
      items.push({
        id: `item_gen_wpn_${weapon.type.toLowerCase()}_${level}_${rarity.toLowerCase()}`,
        name: `${bandLabel(level)} ${weapon.names[nameIndex]}`,
        slot: 'MAIN_HAND',
        weaponType: weapon.type,
        rarity,
        levelReq: level,
        baseStats: {
          atk: range(atk),
          [weapon.mainStat]: range(2 + level * 0.5 * power, 0.25),
        },
        affixSlots: RARITY_META[rarity].affixLines,
        affixPool: weapon.mainStat === 'int' || weapon.mainStat === 'wil'
          ? 'pool_weapon_magic'
          : 'pool_weapon_physical',
        setId: null,
        uniqueEffects: [],
        sockets: rarity === 'RARE' ? 2 : rarity === 'UNCOMMON' ? 1 : 0,
        tradable: true,
        handcrafted: false,
      });
    }
  }
}

/* ------------------------------ 방어구 300 ------------------------------ */
for (const armor of ARMORS) {
  let made = 0;
  for (const material of ARMOR_MATERIALS) {
    for (const level of LEVEL_BANDS) {
      for (const rarity of AUTO_RARITIES) {
        if (made >= 50) break;
        const power = RARITY_POWER[rarity];
        const def = armorDefAt(level) * armor.defScale * power;
        items.push({
          id: `item_gen_arm_${armor.slot.toLowerCase()}_${material}_${level}_${rarity.toLowerCase()}`,
          name: `${material} ${armor.ko}`,
          slot: armor.slot,
          rarity,
          levelReq: level,
          baseStats: {
            def: range(def),
            [armor.stat]: range(1 + level * 0.35 * power, 0.25),
          },
          affixSlots: RARITY_META[rarity].affixLines,
          affixPool: 'pool_armor',
          setId: null,
          uniqueEffects: [],
          sockets: rarity === 'RARE' ? 1 : 0,
          tradable: true,
          handcrafted: false,
        });
        made += 1;
      }
    }
  }
}

/* ------------------------------ 장신구 120 ------------------------------ */
for (const acc of ACCESSORIES) {
  let made = 0;
  for (const prefix of ACCESSORY_PREFIX) {
    for (const level of LEVEL_BANDS) {
      for (const rarity of AUTO_RARITIES) {
        if (made >= 20) break;
        const power = RARITY_POWER[rarity];
        items.push({
          id: `item_gen_acc_${acc.slot.toLowerCase()}_${prefix}_${level}_${rarity.toLowerCase()}`,
          name: `${prefix} ${acc.ko}`,
          slot: acc.slot,
          rarity,
          levelReq: level,
          baseStats: {
            [acc.stat]: range(2 + level * 0.6 * power, 0.2),
          },
          affixSlots: RARITY_META[rarity].affixLines,
          affixPool: 'pool_accessory',
          setId: null,
          uniqueEffects: [],
          sockets: 0,
          tradable: true,
          handcrafted: false,
        });
        made += 1;
      }
    }
  }
}

/* ------------------------------- 문장 40 -------------------------------- */
// 세력·업적으로만 획득. 거래 불가 (기획서 6-4-1 특수 슬롯)
for (const [factionKo, factionId] of EMBLEM_SOURCES) {
  for (const level of LEVEL_BANDS) {
    for (const rarity of ['UNCOMMON', 'RARE'] as Rarity[]) {
      if (items.filter((i) => i.slot === 'EMBLEM' && !i.handcrafted).length >= 40) break;
      const power = RARITY_POWER[rarity];
      items.push({
        id: `item_gen_emb_${factionId}_${level}_${rarity.toLowerCase()}`,
        name: `${factionKo} ${bandLabel(level)} 문장`,
        slot: 'EMBLEM',
        rarity,
        levelReq: level,
        baseStats: { wil: range(2 + level * 0.4 * power, 0.2) },
        affixSlots: 0,
        affixPool: 'pool_accessory',
        setId: null,
        uniqueEffects: [],
        sockets: 0,
        tradable: false,
        handcrafted: false,
      });
    }
  }
}

/* ------------------------------- 보석 60 -------------------------------- */
for (const [gemKo, gemStat] of GEM_KINDS) {
  for (const [gradeIndex, grade] of GEM_GRADES.entries()) {
    for (const rarity of ['COMMON', 'UNCOMMON'] as Rarity[]) {
      const level = LEVEL_BANDS[Math.min(gradeIndex, LEVEL_BANDS.length - 1)] as number;
      items.push({
        id: `item_gen_gem_${gemStat}_${gradeIndex}_${rarity.toLowerCase()}`,
        name: `${grade} ${gemKo}`,
        slot: 'MAIN_HAND',
        rarity,
        levelReq: level,
        baseStats: {},
        affixSlots: 0,
        affixPool: 'pool_gem',
        setId: null,
        uniqueEffects: [],
        sockets: 0,
        tradable: true,
        handcrafted: false,
      });
    }
  }
}

/* -------------------------------- 출력 --------------------------------- */
const seen = new Set<string>();
const unique = items.filter((item) => {
  if (seen.has(item.id)) return false;
  seen.add(item.id);
  return true;
});

writeFileSync(OUT, JSON.stringify(unique, null, 2) + '\n', 'utf8');

const countBySlot = (predicate: (item: ItemDef) => boolean) => unique.filter(predicate).length;
const weaponCount = countBySlot((i) => i.affixPool.startsWith('pool_weapon'));
const armorCount = countBySlot((i) => i.affixPool === 'pool_armor');
const accCount = countBySlot((i) => i.affixPool === 'pool_accessory' && i.slot !== 'EMBLEM');
const emblemCount = countBySlot((i) => i.slot === 'EMBLEM');
const gemCount = countBySlot((i) => i.affixPool === 'pool_gem');

console.log('items.generated.json 생성');
console.log(`  무기    ${String(weaponCount).padStart(4)}  (목표 240)`);
console.log(`  방어구  ${String(armorCount).padStart(4)}  (목표 300)`);
console.log(`  장신구  ${String(accCount).padStart(4)}  (목표 120)`);
console.log(`  문장    ${String(emblemCount).padStart(4)}  (목표  40)`);
console.log(`  보석    ${String(gemCount).padStart(4)}  (목표  60)`);
console.log(`  ────────────────`);
console.log(`  합계    ${String(unique.length).padStart(4)}  (+ 손으로 만든 아이템)`);
