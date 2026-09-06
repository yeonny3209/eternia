/**
 * 기획서 6-1(레벨/경험치), 14-1(각성 무한 성장), 11-2(경험치 분배), 11-3(어그로).
 */

/** 최고 레벨 — 기획서 6-1 */
export const MAX_LEVEL = 50;

/** 레벨업당 자유 배분 포인트 */
export const FREE_POINTS_PER_LEVEL = 5;

/** 레벨업당 스킬 포인트 */
export const SKILL_POINTS_PER_LEVEL = 2;

/**
 * 기획서 6-1: EXP(n) = floor(100 * n^2.1 + 50 * n)
 * n레벨 → n+1레벨에 필요한 경험치.
 */
export function expForLevel(level: number): number {
  if (level < 1 || level >= MAX_LEVEL) return Infinity;
  return Math.floor(100 * Math.pow(level, 2.1) + 50 * level);
}

/** 1레벨부터 목표 레벨까지의 누적 경험치 */
export function cumulativeExp(level: number): number {
  let total = 0;
  for (let n = 1; n < Math.min(level, MAX_LEVEL); n += 1) total += expForLevel(n);
  return total;
}

/**
 * 기준 플레이어 공격력 곡선 — 밸런스의 기준점.
 *
 * 기획서 6-3-5의 밸런스 기준선("동레벨 일반 몬스터는 3~5타에 사망")은
 * 플레이어 공격력이 정해져야만 검증할 수 있다. 그래서 "그 레벨의 평범한 장비를
 * 낀 캐릭터"를 하나 정의해 두고, 몬스터 HP를 여기에 맞춘다.
 *
 * tools/generate-monsters 와 balance-sim 이 같은 함수를 참조하므로,
 * 이 값을 바꾸면 데이터와 검증이 함께 따라온다.
 */
export function referencePlayerAtk(level: number): number {
  return 40 + level * 11;
}

/** 그 레벨대 몬스터의 기준 방어력 */
export function referenceMonsterDef(level: number): number {
  return Math.round(4 + level * 2.8);
}

/**
 * 기획서 14-1: AP(n) = 10000 * n^1.35
 * 후반으로 갈수록 완만한 곡선 — '벽' 느낌을 방지한다.
 */
export function apForAwakenRank(rank: number): number {
  if (rank < 1) return 0;
  return Math.floor(10000 * Math.pow(rank, 1.35));
}

/** 각성 등급당 모든 능력치 +0.5% */
export function awakenStatMultiplier(rank: number): number {
  return 1 + rank * 0.005;
}

/** 10등급마다 각성 스킬 슬롯 1칸 */
export function awakenSkillSlots(rank: number): number {
  return Math.floor(rank / 10);
}

export const MAX_AWAKEN_RANK = 999;

/**
 * 기획서 11-2: 개인 경험치 = 몬스터EXP × (1 + 0.15 × (파티원수-1)) / 파티원수 × 레벨보정
 * 4인 파티가 솔로보다 효율이 약간 높다. 뭉치는 게 이득이어야 한다.
 */
export function partyExpShare(monsterExp: number, partySize: number, levelFactor = 1): number {
  const n = Math.max(1, partySize);
  return Math.floor((monsterExp * (1 + 0.15 * (n - 1))) / n) * levelFactor;
}

/**
 * 레벨 차이 보정 — 저렙이 고렙 맵에서 무한 파밍하는 것을 막는다.
 * 기획서 1-2 ①: 저렙이 고렙 맵에 갈 수는 있지만 죽는다(경험치 이득은 제한).
 */
export function levelFactor(playerLevel: number, monsterLevel: number): number {
  const diff = monsterLevel - playerLevel;
  if (diff >= 0) return Math.min(1.2, 1 + diff * 0.02);
  if (diff >= -5) return 1 + diff * 0.05;
  if (diff >= -10) return 0.75 + (diff + 5) * 0.1;
  return 0.1;
}

/**
 * 기획서 11-3: threat = 누적데미지 × 역할계수 + 힐량 × 0.5 + 도발보너스
 * 역할계수: TANK 3.0 / 그 외 1.0
 */
export const THREAT_ROLE_COEF = { TANK: 3.0, HEAL: 1.0, DPS: 1.0, SUPPORT: 1.0, CONTROL: 1.0 };

export function computeThreat(
  cumulativeDamage: number,
  roleCoef: number,
  healing: number,
  tauntBonus = 0,
): number {
  return cumulativeDamage * roleCoef + healing * 0.5 + tauntBonus;
}

/**
 * 어그로 1위가 2위보다 10% 미만으로 앞서면 보스가 타겟을 흔든다 → 탱커 긴장감.
 * @returns 타겟을 바꿔야 하면 true
 */
export function shouldSwapTarget(topThreat: number, secondThreat: number): boolean {
  if (secondThreat <= 0) return false;
  return topThreat < secondThreat * 1.1;
}

/** 도발: "현재 1위 threat + 20%"로 즉시 설정 */
export function tauntThreat(currentTopThreat: number): number {
  return currentTopThreat * 1.2;
}
