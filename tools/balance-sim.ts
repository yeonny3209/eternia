/**
 * tools/balance-sim.ts — 몬테카를로 밸런스 검사기.
 *
 * 기획서 6-4-9:
 *   "접사 조합이 수십만 가지가 되면 사람 눈으로는 밸런스 붕괴를 절대 못 찾는다.
 *    몬테카를로로 10만 조합을 돌려 상위 0.1% 조합의 DPS가 중앙값의 몇 배인지
 *    계속 확인해야 한다. **3배를 넘으면 그 접사는 너프 대상이다.**"
 *
 * 기획서 M7: 직업 17종 DPS 편차 ±7% 이내 목표.
 *
 *   npm run sim:balance            (기본 10만 회)
 *   npm run sim:balance -- 200000  (횟수 지정)
 *
 * 종료 코드는 항상 0이다. 이 도구는 "게이트"가 아니라 "관측기"다.
 * 튜닝 전 단계에서 편차가 큰 것은 정상이고, 무엇을 만져야 하는지 알려주는 게 목적이다.
 */
import {
  ALL_AFFIXES,
  AFFIX_BY_ID,
  LEGENDARY_AFFIXES,
  rollTier,
} from '../packages/shared/src/items/affix.js';
import { computeDamage, damageInput } from '../packages/shared/src/formulas/combat.js';
import { referencePlayerAtk } from '../packages/shared/src/formulas/progression.js';
import { CLASSES, HIDDEN_CLASSES, SKILLS } from '../packages/shared/src/data/registry.js';
import type { AffixDef, RolledAffix } from '../packages/shared/src/types/item.js';
import type { SkillDef } from '../packages/shared/src/types/combat.js';

const ITERATIONS = Number(process.argv[2] ?? 100_000);
const LEVEL = 50;
/** 장비 16슬롯 중 접사가 붙는 자리를 6줄로 근사한다 */
const AFFIX_LINES = 6;

/* ------------------------------------------------------------------ */
/* 결정적 난수 — 같은 시드면 같은 결과가 나와야 회귀를 비교할 수 있다     */
/* ------------------------------------------------------------------ */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xe7e2_c1a1);

/* ------------------------------------------------------------------ */
/* 접사 조합 → DPS                                                     */
/* ------------------------------------------------------------------ */
interface Loadout {
  affixes: RolledAffix[];
  legendaryId: string | null;
}

/**
 * 전설 접사의 페널티 배율.
 * 예: "스킬을 쓸 수 없게 되는 대신 기본 공격 3배"는 이득만 세면 과대평가된다.
 * 잃는 쪽을 모델에 넣지 않으면 시뮬레이터가 엉뚱한 접사를 너프 후보로 지목한다.
 */
function drawbackOf(legendaryId: string | null): number {
  if (!legendaryId) return 1;
  const legendary = LEGENDARY_AFFIXES.find((l) => l.id === legendaryId) as
    | { drawback?: number }
    | undefined;
  return legendary?.drawback ?? 1;
}

function rollLoadout(): Loadout {
  const affixes: RolledAffix[] = [];
  const used = new Set<string>();
  while (affixes.length < AFFIX_LINES) {
    const def = ALL_AFFIXES[Math.floor(rng() * ALL_AFFIXES.length)] as AffixDef;
    if (used.has(def.id)) continue;
    used.add(def.id);
    const tier = rollTier(LEVEL, rng);
    affixes.push({ affixId: def.id, tier, value: def.values[tier - 1] as number });
  }
  // 전설 접사는 전설 등급 장비에서만 나온다 — 대략 20% 확률로 하나 붙는다고 본다
  const legendary =
    rng() < 0.2 ? (LEGENDARY_AFFIXES[Math.floor(rng() * LEGENDARY_AFFIXES.length)] as { id: string }) : null;
  return { affixes, legendaryId: legendary?.id ?? null };
}

interface Aggregated {
  atkFlat: number;
  atkPct: number;
  critRate: number;
  critDmg: number;
  atkSpeed: number;
  cooldown: number;
  penetration: number;
  elementDmg: number;
  dmgIncrease: number;
}

function aggregate(loadout: Loadout): Aggregated {
  const totals: Aggregated = {
    atkFlat: 0,
    atkPct: 0,
    critRate: 0,
    critDmg: 0,
    atkSpeed: 0,
    cooldown: 0,
    penetration: 0,
    elementDmg: 0,
    dmgIncrease: 0,
  };

  const apply = (
    stat: AffixDef['effect']['stat'],
    mode: 'flat' | 'pct',
    magnitude: number,
    uptime: number,
  ): void => {
    const v = magnitude * uptime;
    switch (stat) {
      case 'atk':
        if (mode === 'flat') totals.atkFlat += v;
        else totals.atkPct += v;
        break;
      case 'critRate':
        totals.critRate += v;
        break;
      case 'critDmg':
        totals.critDmg += v;
        break;
      case 'atkSpeed':
        totals.atkSpeed += v;
        break;
      case 'cooldown':
        totals.cooldown += v;
        break;
      case 'penetration':
        totals.penetration += v;
        break;
      case 'elementDmg':
        totals.elementDmg += v;
        break;
      case 'dmgIncrease':
        totals.dmgIncrease += v;
        break;
      default:
        break; // hp/def/mp/stamina 등은 DPS에 직접 기여하지 않는다
    }
  };

  for (const rolled of loadout.affixes) {
    const def = AFFIX_BY_ID.get(rolled.affixId);
    if (!def) continue;
    const magnitude = def.effect.mode === 'pct' ? rolled.value / 100 : rolled.value;
    apply(def.effect.stat, def.effect.mode, magnitude, def.effect.uptime ?? 1);
  }

  if (loadout.legendaryId) {
    const legendary = LEGENDARY_AFFIXES.find((l) => l.id === loadout.legendaryId);
    if (legendary) {
      apply(
        legendary.effect.stat,
        legendary.effect.mode,
        legendary.effect.mode === 'pct' ? legendary.value : legendary.value,
        legendary.effect.uptime ?? 1,
      );
    }
  }

  return totals;
}

/** 기준 몬스터 — 50레벨 일반 */
const TARGET_DEF = 144;

function dpsOf(loadout: Loadout, skillCoef = 1.05, baseAtkSpeed = 1.6): number {
  const t = aggregate(loadout);
  const atk = (referencePlayerAtk(LEVEL) + t.atkFlat) * (1 + t.atkPct);
  const effectiveDef = TARGET_DEF * (1 - Math.min(0.7, t.penetration));
  const crit = Math.min(0.75, 0.15 + t.critRate);

  const normal = computeDamage(
    damageInput({
      atk,
      skillCoef,
      def: effectiveDef,
      attackerLevel: LEVEL,
      isCrit: false,
      elementMultiplier: 1 + t.elementDmg,
      dmgIncrease: t.dmgIncrease,
      contextCoef: 1,
      roll: 0.5,
    }),
  ).final;

  const critical = computeDamage(
    damageInput({
      atk,
      skillCoef,
      def: effectiveDef,
      attackerLevel: LEVEL,
      isCrit: true,
      critDmgBonus: t.critDmg,
      elementMultiplier: 1 + t.elementDmg,
      dmgIncrease: t.dmgIncrease,
      contextCoef: 1,
      roll: 0.5,
    }),
  ).final;

  const perHit = normal * (1 - crit) + critical * crit;
  const hitsPerSecond = baseAtkSpeed * (1 + t.atkSpeed) * (1 + t.cooldown * 0.5);
  return perHit * hitsPerSecond * drawbackOf(loadout.legendaryId);
}

/* ------------------------------------------------------------------ */
/* 1. 접사 조합 몬테카를로                                              */
/* ------------------------------------------------------------------ */
console.log('═'.repeat(72));
console.log('  에테르니아 — 밸런스 시뮬레이터');
console.log('═'.repeat(72));
console.log();
console.log(`접사 조합 몬테카를로 (${ITERATIONS.toLocaleString('ko-KR')}회, 50레벨 기준)`);

const samples: number[] = new Array(ITERATIONS);
/** 접사별 기여도 추적 — 상위 0.1%에 얼마나 자주 등장하는가 */
const appearances = new Map<string, number>();
const topAppearances = new Map<string, number>();
const loadouts: Loadout[] = new Array(ITERATIONS);

for (let i = 0; i < ITERATIONS; i += 1) {
  const loadout = rollLoadout();
  loadouts[i] = loadout;
  samples[i] = dpsOf(loadout);
  for (const affix of loadout.affixes) {
    appearances.set(affix.affixId, (appearances.get(affix.affixId) ?? 0) + 1);
  }
  if (loadout.legendaryId) {
    appearances.set(loadout.legendaryId, (appearances.get(loadout.legendaryId) ?? 0) + 1);
  }
}

const sortedIdx = samples
  .map((dps, index) => ({ dps, index }))
  .sort((a, b) => b.dps - a.dps);

const sorted = sortedIdx.map((s) => s.dps);
const median = sorted[Math.floor(sorted.length / 2)] as number;
const p999 = sorted[Math.floor(sorted.length * 0.001)] as number;
const max = sorted[0] as number;
const min = sorted[sorted.length - 1] as number;
const ratio = p999 / median;

const topCount = Math.max(1, Math.floor(ITERATIONS * 0.001));
for (let i = 0; i < topCount; i += 1) {
  const loadout = loadouts[(sortedIdx[i] as { index: number }).index] as Loadout;
  for (const affix of loadout.affixes) {
    topAppearances.set(affix.affixId, (topAppearances.get(affix.affixId) ?? 0) + 1);
  }
  if (loadout.legendaryId) {
    topAppearances.set(loadout.legendaryId, (topAppearances.get(loadout.legendaryId) ?? 0) + 1);
  }
}

console.log(`  최저    ${min.toFixed(0).padStart(9)}`);
console.log(`  중앙값  ${median.toFixed(0).padStart(9)}`);
console.log(`  상위0.1% ${p999.toFixed(0).padStart(8)}`);
console.log(`  최고    ${max.toFixed(0).padStart(9)}`);
console.log();
console.log(`  상위 0.1% / 중앙값 = ${ratio.toFixed(2)}배  (기획서 기준: 3.00배 초과 시 너프 대상)`);
console.log(
  ratio > 3
    ? '  ✗ 기준 초과 — 아래 과대표 접사를 너프 후보로 본다'
    : '  ✓ 기준 이내',
);
console.log();

// 상위 0.1%에서 과대표된 접사 = 밸런스 붕괴의 범인
const overrepresented = [...topAppearances.entries()]
  .map(([id, topCountForAffix]) => {
    const overall = appearances.get(id) ?? 1;
    const baseRate = overall / ITERATIONS;
    const topRate = topCountForAffix / topCount;
    return { id, lift: topRate / Math.max(baseRate, 1e-9), topRate };
  })
  .filter((entry) => entry.topRate > 0.15)
  .sort((a, b) => b.lift - a.lift)
  .slice(0, 8);

if (overrepresented.length > 0) {
  console.log('  상위 0.1% 조합에 과대표된 접사 (등장 배율 순)');
  for (const entry of overrepresented) {
    const def = AFFIX_BY_ID.get(entry.id) ?? LEGENDARY_AFFIXES.find((l) => l.id === entry.id);
    const label = def && 'name' in def ? def.name : entry.id;
    console.log(
      `    ${String(label).padEnd(14)} 상위권 등장률 ${(entry.topRate * 100).toFixed(0).padStart(3)}%  (전체 대비 ${entry.lift.toFixed(2)}배)`,
    );
  }
  console.log();
}

/* ------------------------------------------------------------------ */
/* 2. 직업 17종 DPS 편차 (기획서 M7: ±7% 이내 목표)                     */
/* ------------------------------------------------------------------ */
console.log('직업 17종 DPS 편차 (동일 장비 기준)');

/** 그 직업의 대표 로테이션 DPS — 쿨타임을 고려해 스킬 사용 빈도를 가중한다 */
function classDps(classId: string): number {
  // 기획서 8부 공통 규칙 3: 히든 직업은 원 직업의 스킬을 전부 유지한 채
  // 히든 전용 라인이 "추가"된다. 히든 스킬만으로 재면 실제보다 훨씬 약하게 나온다.
  const hidden = HIDDEN_CLASSES.find((h) => h.id === classId);
  const sourceIds = hidden ? [classId, hidden.baseClasses[0] as string] : [classId];

  const skills = SKILLS.filter(
    (s) => sourceIds.includes(s.classId) && s.kind !== 'PASSIVE' && s.coef.pve > 0,
  );
  if (skills.length === 0) return 0;

  const basics = skills.filter((s) => s.cooldownMs === 0);
  const cooldowns = skills.filter((s) => s.cooldownMs > 0);

  // 사이클이 짧으면 쿨타임 90초 이상인 궁극기가 0회로 계산돼
  // 궁극기가 짧은 직업만 과대평가된다. 가장 긴 쿨타임을 덮는 길이로 잡는다.
  const longestCooldown = Math.max(0, ...cooldowns.map((s) => s.cooldownMs));
  const cycleMs = Math.max(300_000, longestCooldown * 2);
  let damage = 0;
  let busyMs = 0;

  const skillDamage = (skill: SkillDef): number =>
    computeDamage(
      damageInput({
        atk: referencePlayerAtk(LEVEL),
        skillCoef: skill.coef.pve,
        def: TARGET_DEF,
        attackerLevel: LEVEL,
        roll: 0.5,
      }),
    ).final;

  const totalFrames = (skill: SkillDef): number =>
    skill.frames.startupMs + skill.frames.activeMs + skill.frames.recoveryMs;

  for (const skill of cooldowns) {
    const uses = Math.floor(cycleMs / skill.cooldownMs);
    if (uses <= 0) continue;
    damage += skillDamage(skill) * uses;
    busyMs += totalFrames(skill) * uses;
  }

  // 남는 시간은 기본 공격으로 채운다
  const basic = basics[0];
  if (basic) {
    const perBasic = totalFrames(basic);
    const remaining = Math.max(0, cycleMs - busyMs);
    const count = Math.floor(remaining / perBasic);
    damage += skillDamage(basic) * count;
  }

  return damage / (cycleMs / 1000);
}

/**
 * 딜 역할군만 ±7% 기준으로 본다.
 * 힐러·버퍼·디버퍼의 가치는 DPS가 아니라 파티 기여도로 재야 한다.
 * 이들을 같은 표에 넣고 편차를 재면 숫자가 의미를 잃는다.
 */
const DPS_ROLE_CLASSES = new Set(
  CLASSES.filter((c) => c.roles.includes('DPS')).map((c) => c.id),
);
// 히든 직업은 원 직업이 딜러면 딜러로 본다
for (const hidden of HIDDEN_CLASSES) {
  if (hidden.baseClasses.some((base) => DPS_ROLE_CLASSES.has(base))) {
    DPS_ROLE_CLASSES.add(hidden.id);
  }
}

const allRows = [
  ...CLASSES.map((c) => ({ id: c.id, name: c.name, hidden: false })),
  ...HIDDEN_CLASSES.map((c) => ({ id: c.id, name: c.name, hidden: true })),
].map((c) => ({ ...c, dps: classDps(c.id), isDps: DPS_ROLE_CLASSES.has(c.id) }));

const supportRows = allRows.filter((c) => !c.isDps).sort((a, b) => b.dps - a.dps);
const classRows = allRows
  .filter((c) => c.isDps && c.dps > 0)
  .sort((a, b) => b.dps - a.dps);

const dpsValues = classRows.map((c) => c.dps);
const mean = dpsValues.reduce((a, b) => a + b, 0) / dpsValues.length;

for (const row of classRows) {
  const deviation = ((row.dps - mean) / mean) * 100;
  const flag = Math.abs(deviation) > 7 ? '⚠' : ' ';
  const tag = row.hidden ? '히든' : '기본';
  console.log(
    `  ${flag} ${tag} ${row.name.padEnd(6)} ${row.dps.toFixed(0).padStart(8)}  ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}%`,
  );
}

const worst = Math.max(...dpsValues.map((d) => Math.abs(((d - mean) / mean) * 100)));
console.log();
if (supportRows.length > 0) {
  console.log('  [참고] 지원 역할군 — DPS로 재지 않는다 (파티 기여도로 평가)');
  for (const row of supportRows) {
    console.log(`         ${row.name.padEnd(8)} ${row.dps.toFixed(0).padStart(8)}`);
  }
  console.log();
}
console.log(`  최대 편차 ${worst.toFixed(1)}%  (기획서 M7 목표: ±7% 이내)`);
console.log(worst <= 7 ? '  ✓ 목표 달성' : '  ⚠ 튜닝 필요 — 위 ⚠ 표시 직업의 계수를 조정할 것');
console.log();

/* ------------------------------------------------------------------ */
/* 3. 히든 직업 성능 상한 (기획서 8부: 약 105%)                          */
/* ------------------------------------------------------------------ */
const baseMean =
  classRows.filter((c) => !c.hidden).reduce((a, b) => a + b.dps, 0) /
  classRows.filter((c) => !c.hidden).length;

console.log('히든 직업 성능 상한 (기본 직업 평균 대비 105% 이내)');
let capViolations = 0;
for (const row of classRows.filter((c) => c.hidden)) {
  const pct = (row.dps / baseMean) * 100;
  const ok = pct <= 105;
  if (!ok) capViolations += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${row.name.padEnd(8)} ${pct.toFixed(1)}%`);
}
console.log();
console.log(
  capViolations === 0
    ? '  ✓ 히든 직업이 기존 직업보다 강하지 않다'
    : `  ✗ ${capViolations}개 직업이 105% 상한을 넘는다`,
);
console.log();
console.log('※ 이 도구는 게이트가 아니라 관측기다. 수치는 플레이테스트로 확정한다.');
