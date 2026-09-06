/** 기획서 6-4 — 접사 롤 / 재련 / 강화 / 각인 */
import { describe, expect, it } from 'vitest';
import {
  AFFIX_COUNTS,
  ALL_AFFIXES,
  LEGENDARY_AFFIXES,
  aggregateAffixEffects,
  describeAffix,
  maxTierForLevel,
  reforge,
  rollItem,
  rollTier,
} from './affix.js';
import {
  ENGRAVING_POINT_CAP,
  MAX_ENHANCE,
  canAddEngraving,
  enhanceRisk,
  inherit,
  tryEnhance,
} from './enhance.js';
import { ITEM_BY_ID, ITEMS } from '../data/registry.js';
import { RARITY_META } from '../types/item.js';
import type { ItemDef } from '../types/item.js';

/** 결정적 난수 — 서버 시드를 흉내낸다 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const rareSword = ITEM_BY_ID.get('item_ravine_greatsword') as ItemDef;

describe('접사 종수 — 기획서 6-4-4', () => {
  it('접두 48종 / 접미 36종 / 전설 20종', () => {
    expect(AFFIX_COUNTS.prefix).toBe(48);
    expect(AFFIX_COUNTS.suffix).toBe(36);
    expect(AFFIX_COUNTS.legendary).toBe(20);
  });

  it('접미사는 전부 액션 조작과 연동된 발동 조건을 가진다', () => {
    const suffixes = ALL_AFFIXES.filter((a) => a.kind === 'SUFFIX');
    expect(suffixes.length).toBeGreaterThan(0);
    for (const affix of suffixes) {
      expect(affix.effect.trigger, `${affix.id}에 발동 조건이 없다`).toBeDefined();
    }
  });

  it('회피·패리·그로기 연계 접미사가 실제로 존재한다', () => {
    const triggers = new Set(ALL_AFFIXES.map((a) => a.effect.trigger));
    expect(triggers.has('ON_DODGE')).toBe(true);
    expect(triggers.has('ON_PARRY')).toBe(true);
    expect(triggers.has('VS_GROGGY')).toBe(true);
  });

  it('전설 접사는 게임을 바꾸는 수준의 설명을 가진다', () => {
    expect(LEGENDARY_AFFIXES).toHaveLength(20);
    for (const affix of LEGENDARY_AFFIXES) {
      expect(affix.template.length).toBeGreaterThan(10);
    }
  });
});

describe('티어 롤 — 저레벨 아이템에서 최상위 티어가 나오면 안 된다', () => {
  it('레벨별 티어 상한', () => {
    expect(maxTierForLevel(1)).toBe(1);
    expect(maxTierForLevel(20)).toBe(3);
    expect(maxTierForLevel(50)).toBe(6);
  });

  it('롤 결과는 항상 상한 이하', () => {
    const rng = seeded(7);
    for (let i = 0; i < 500; i += 1) {
      expect(rollTier(20, rng)).toBeLessThanOrEqual(3);
    }
  });

  it('상위 티어일수록 희박하다', () => {
    const rng = seeded(11);
    const counts = new Map<number, number>();
    for (let i = 0; i < 5000; i += 1) {
      const t = rollTier(50, rng);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    expect(counts.get(1) as number).toBeGreaterThan(counts.get(6) as number);
    expect(counts.get(3) as number).toBeGreaterThan(counts.get(5) as number);
  });
});

describe('rollItem — 드롭 시 인스턴스 생성', () => {
  it('등급이 정한 만큼만 접사가 붙는다', () => {
    const rng = seeded(42);
    const instance = rollItem(rareSword, rng);
    expect(instance.affixes).toHaveLength(RARITY_META.RARE.affixLines);
  });

  it('같은 접사가 두 번 붙지 않는다', () => {
    const rng = seeded(99);
    for (let i = 0; i < 100; i += 1) {
      const instance = rollItem(rareSword, rng);
      const ids = instance.affixes.map((a) => a.affixId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('기본 스탯은 정의된 범위 안에서만 굴러온다', () => {
    const rng = seeded(5);
    for (let i = 0; i < 200; i += 1) {
      const instance = rollItem(rareSword, rng);
      const [min, max] = rareSword.baseStats.atk as [number, number];
      expect(instance.rolledStats.atk as number).toBeGreaterThanOrEqual(min);
      expect(instance.rolledStats.atk as number).toBeLessThanOrEqual(max);
    }
  });

  it('신화 등급은 획득 즉시 귀속된다 (기획서 6-4-8)', () => {
    const mythic = ITEM_BY_ID.get('item_pillar_breaker') as ItemDef;
    expect(rollItem(mythic, seeded(3)).bound).toBe(true);
  });

  it('소켓 수만큼 빈 소켓이 생긴다', () => {
    const instance = rollItem(rareSword, seeded(8));
    expect(instance.sockets).toHaveLength(rareSword.sockets);
    expect(instance.sockets.every((s) => s === null)).toBe(true);
  });

  it('접사 표기가 수치로 치환된다', () => {
    const instance = rollItem(rareSword, seeded(13));
    const text = describeAffix(instance.affixes[0] as never);
    expect(text).not.toContain('{v}');
  });
});

describe('reforge — 1줄만 잠글 수 있다', () => {
  it('잠긴 줄은 유지되고 나머지가 다시 굴러온다', () => {
    const rng = seeded(21);
    const instance = rollItem(rareSword, rng);
    instance.affixes[0]!.locked = true;
    const locked = instance.affixes[0]!.affixId;

    const result = reforge(instance, rareSword, rng);
    expect(result.affixes[0]!.affixId).toBe(locked);
    expect(result.affixes).toHaveLength(instance.affixes.length);
  });

  it('2줄 이상 잠그면 거부한다', () => {
    const instance = rollItem(rareSword, seeded(4));
    instance.affixes[0]!.locked = true;
    instance.affixes[1]!.locked = true;
    expect(() => reforge(instance, rareSword, seeded(4))).toThrow();
  });
});

describe('강화 — +0 ~ +20, 단계별 위험도', () => {
  it('+1~+9는 실패해도 유지, +10~+15는 하락, +16~+20은 파괴', () => {
    expect(enhanceRisk(0)).toBe('SAFE');
    expect(enhanceRisk(8)).toBe('SAFE');
    expect(enhanceRisk(9)).toBe('DOWNGRADE');
    expect(enhanceRisk(14)).toBe('DOWNGRADE');
    expect(enhanceRisk(15)).toBe('DESTROY');
    expect(enhanceRisk(19)).toBe('DESTROY');
  });

  it('성공하면 +1', () => {
    const item = rollItem(rareSword, seeded(1));
    const result = tryEnhance(item, () => 0); // 항상 성공
    expect(result.outcome).toBe('SUCCESS');
    expect(result.item?.enhanceLevel).toBe(1);
  });

  it('안전 구간에서 실패하면 수치가 유지된다', () => {
    const item = { ...rollItem(rareSword, seeded(1)), enhanceLevel: 5 };
    const result = tryEnhance(item, () => 0.99);
    expect(result.outcome).toBe('KEEP');
    expect(result.item?.enhanceLevel).toBe(5);
  });

  it('하락 구간에서 실패하면 -1', () => {
    const item = { ...rollItem(rareSword, seeded(1)), enhanceLevel: 12 };
    const result = tryEnhance(item, () => 0.99);
    expect(result.outcome).toBe('DOWNGRADE');
    expect(result.item?.enhanceLevel).toBe(11);
  });

  it('파괴 구간에서 실패하면 아이템이 사라진다', () => {
    const item = { ...rollItem(rareSword, seeded(1)), enhanceLevel: 17 };
    const result = tryEnhance(item, () => 0.99);
    expect(result.outcome).toBe('DESTROYED');
    expect(result.item).toBeNull();
  });

  it('보호권을 쓰면 파괴를 막는다', () => {
    const item = { ...rollItem(rareSword, seeded(1)), enhanceLevel: 17 };
    const result = tryEnhance(item, () => 0.99, true);
    expect(result.outcome).toBe('PROTECTED');
    expect(result.item?.enhanceLevel).toBe(17);
    expect(result.protectionConsumed).toBe(true);
  });

  it('+20을 넘길 수 없다', () => {
    const item = { ...rollItem(rareSword, seeded(1)), enhanceLevel: MAX_ENHANCE };
    expect(tryEnhance(item, () => 0).outcome).toBe('MAXED');
  });

  it('성공 확률은 단계가 오를수록 낮아진다', () => {
    const item = rollItem(rareSword, seeded(1));
    const low = tryEnhance({ ...item, enhanceLevel: 1 }, () => 0.5).rate;
    const high = tryEnhance({ ...item, enhanceLevel: 18 }, () => 0.5).rate;
    expect(high).toBeLessThan(low);
  });
});

describe('계승 — 강화 수치를 옮긴다 (재료 손실 30%)', () => {
  it('원본 강화 수치의 70%가 옮겨진다', () => {
    const source = { ...rollItem(rareSword, seeded(1)), enhanceLevel: 10 };
    const target = rollItem(rareSword, seeded(2));
    expect(inherit(source, target).enhanceLevel).toBe(7);
  });

  it('대상이 이미 더 높으면 낮추지 않는다', () => {
    const source = { ...rollItem(rareSword, seeded(1)), enhanceLevel: 5 };
    const target = { ...rollItem(rareSword, seeded(2)), enhanceLevel: 9 };
    expect(inherit(source, target).enhanceLevel).toBe(9);
  });
});

describe('각인 — 포인트 상한이 선택을 강제한다', () => {
  const big = { id: 'e1', name: '큰 각인', points: 12, description: '' };
  const small = { id: 'e2', name: '작은 각인', points: 5, description: '' };

  it('상한을 넘으면 추가할 수 없다', () => {
    expect(canAddEngraving([big], small)).toBe(false); // 12 + 5 > 15
    expect(ENGRAVING_POINT_CAP).toBe(15);
  });

  it('아이템당 3개까지', () => {
    const three = [small, small, small];
    expect(canAddEngraving(three, small)).toBe(false);
  });
});

describe('aggregateAffixEffects — 시뮬레이터용 상시 환산', () => {
  it('조건부 효과는 가동률만큼만 반영된다', () => {
    const rng = seeded(77);
    const instance = rollItem(rareSword, rng);
    const totals = aggregateAffixEffects(instance.affixes);
    expect(Object.keys(totals).length).toBeGreaterThan(0);
    for (const value of Object.values(totals)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('items.json 무결성', () => {
  it('등급별 접사 줄 수가 기획서 표와 맞는다', () => {
    for (const item of ITEMS) {
      const allowed = RARITY_META[item.rarity].affixLines;
      expect(item.affixSlots, `${item.name}`).toBeLessThanOrEqual(allowed);
    }
  });

  it('신화 등급은 거래 불가', () => {
    for (const item of ITEMS.filter((i) => i.rarity === 'MYTHIC')) {
      expect(item.tradable, `${item.name}`).toBe(false);
    }
  });

  it('장비 중 고유 효과를 가진 것은 영웅 이상뿐이다', () => {
    // 소모품·재료(pool_consumable / pool_material)는 uniqueEffects를 사용 설명으로 쓰므로 제외한다
    const equipment = ITEMS.filter(
      (i) => i.affixPool !== 'pool_consumable' && i.affixPool !== 'pool_material',
    );
    expect(equipment.length).toBeGreaterThan(5);
    for (const item of equipment) {
      if (item.uniqueEffects.length === 0) continue;
      expect(['EPIC', 'LEGENDARY', 'MYTHIC'], `${item.name}`).toContain(item.rarity);
    }
  });

  it('고유 효과 개수가 등급 상한을 넘지 않는다', () => {
    const equipment = ITEMS.filter(
      (i) => i.affixPool !== 'pool_consumable' && i.affixPool !== 'pool_material',
    );
    for (const item of equipment) {
      expect(item.uniqueEffects.length, `${item.name}`).toBeLessThanOrEqual(
        RARITY_META[item.rarity].uniqueEffects,
      );
    }
  });
});
