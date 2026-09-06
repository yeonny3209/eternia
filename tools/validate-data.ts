/**
 * tools/validate-data.ts — 기획 데이터 참조 무결성 검사기.
 *
 * 기획서 2-3:
 *   "퀘스트가 100개를 넘어가면 '존재하지 않는 NPC id 참조',
 *    '보상 아이템 id 오타' 같은 버그가 반드시 생긴다.
 *    데이터 추가할 때마다 이 스크립트를 돌린다."
 *
 *   npm run validate:data
 *
 * 오류(ERROR)가 하나라도 있으면 종료 코드 1로 죽는다. CI가 이걸 막는다.
 * 경고(WARN)는 통과시키되 화면에 남긴다.
 */
import {
  CLASSES,
  CLASS_BY_ID,
  DUNGEONS,
  HIDDEN_CLASSES,
  ITEMS,
  ITEM_BY_ID,
  MAPS,
  MAP_BY_ID,
  MONSTERS,
  MONSTER_BY_ID,
  NPCS,
  NPC_BY_ID,
  POI_BY_ID,
  QUESTS,
  QUEST_BY_ID,
  RAIDS,
  SETS,
  SKILLS,
  SKILL_BY_ID,
  dataSummary,
} from '../packages/shared/src/data/registry.js';
import { OBJECTIVE_TYPES } from '../packages/shared/src/types/quest.js';
import { EQUIP_SLOTS, RARITIES, RARITY_META } from '../packages/shared/src/types/item.js';

interface Issue {
  level: 'ERROR' | 'WARN';
  where: string;
  message: string;
}

const issues: Issue[] = [];
const error = (where: string, message: string) => issues.push({ level: 'ERROR', where, message });
const warn = (where: string, message: string) => issues.push({ level: 'WARN', where, message });

/* ------------------------------------------------------------------ */
/* 1. id 중복                                                          */
/* ------------------------------------------------------------------ */
function checkDuplicates<T extends { id: string }>(name: string, list: T[]): void {
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry.id)) error(name, `id 중복: ${entry.id}`);
    seen.add(entry.id);
  }
}

checkDuplicates('maps', MAPS);
checkDuplicates('classes', CLASSES);
checkDuplicates('hidden-classes', HIDDEN_CLASSES);
checkDuplicates('monsters', MONSTERS);
checkDuplicates('npcs', NPCS);
checkDuplicates('items', ITEMS);
checkDuplicates('skills', SKILLS);
checkDuplicates('quests', QUESTS);
checkDuplicates('dungeons', DUNGEONS);
checkDuplicates('raids', RAIDS);

/* ------------------------------------------------------------------ */
/* 2. 맵 — 연결 관계는 양방향이어야 한다                                 */
/* ------------------------------------------------------------------ */
for (const map of MAPS) {
  for (const next of map.connections) {
    const other = MAP_BY_ID.get(next);
    if (!other) {
      error(`maps/${map.id}`, `존재하지 않는 맵으로 연결: ${next}`);
      continue;
    }
    if (!other.connections.includes(map.id)) {
      warn(`maps/${map.id}`, `${next}로는 갈 수 있는데 돌아올 수 없다 (단방향 연결)`);
    }
  }
  for (const npc of map.npcs) {
    if (!NPC_BY_ID.has(npc)) error(`maps/${map.id}`, `존재하지 않는 NPC: ${npc}`);
  }
  for (const mob of map.monsters) {
    if (!MONSTER_BY_ID.has(mob)) error(`maps/${map.id}`, `존재하지 않는 몬스터: ${mob}`);
  }
  if (map.fieldBoss && !MONSTER_BY_ID.has(map.fieldBoss)) {
    error(`maps/${map.id}`, `존재하지 않는 필드 보스: ${map.fieldBoss}`);
  }
  if (map.campfires < 1) warn(`maps/${map.id}`, '모닥불 세이브 포인트가 없다');
}

// 시작 마을에서 모든 비히든 맵에 도달할 수 있는가
{
  const reachable = new Set<string>(['dawnhollow']);
  const queue = ['dawnhollow'];
  while (queue.length > 0) {
    const current = MAP_BY_ID.get(queue.shift() as string);
    if (!current) continue;
    for (const next of current.connections) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  for (const map of MAPS) {
    if (!reachable.has(map.id)) {
      error('maps', `여명 마을에서 도달할 수 없는 맵: ${map.id} (${map.name})`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. 직업 — 스킬 참조와 분기 트리                                       */
/* ------------------------------------------------------------------ */
for (const klass of CLASSES) {
  for (const skillId of klass.skills) {
    const skill = SKILL_BY_ID.get(skillId);
    if (!skill) {
      error(`classes/${klass.id}`, `존재하지 않는 스킬: ${skillId}`);
      continue;
    }
    if (skill.classId !== klass.id) {
      error(`classes/${klass.id}`, `${skillId}의 classId가 ${skill.classId}로 되어 있다`);
    }
  }

  const branchIds = new Set(klass.branches.map((b) => b.id));
  for (const branch of klass.branches) {
    if (branch.level === 40 && branch.parent === null) {
      error(`classes/${klass.id}`, `40레벨 분기 ${branch.id}에 부모 분기가 없다`);
    }
    if (branch.parent && !branchIds.has(branch.parent)) {
      error(`classes/${klass.id}`, `분기 ${branch.id}의 부모 ${branch.parent}가 없다`);
    }
  }

  // 기획서 7부: 각 직업은 20/40레벨에 특화 분기 2개씩
  const lv20 = klass.branches.filter((b) => b.level === 20);
  const lv40 = klass.branches.filter((b) => b.level === 40);
  if (lv20.length !== 2) warn(`classes/${klass.id}`, `20레벨 분기가 ${lv20.length}개 (2개여야 함)`);
  if (lv40.length !== 4) warn(`classes/${klass.id}`, `40레벨 분기가 ${lv40.length}개 (4개여야 함)`);
  if (klass.parryWindowMs <= 0) error(`classes/${klass.id}`, '패리 판정 창이 설정되지 않았다');
}

for (const hidden of HIDDEN_CLASSES) {
  for (const base of hidden.baseClasses) {
    if (!CLASS_BY_ID.has(base)) error(`hidden/${hidden.id}`, `존재하지 않는 원 직업: ${base}`);
  }
  for (const skillId of hidden.skills) {
    if (!SKILL_BY_ID.has(skillId)) error(`hidden/${hidden.id}`, `존재하지 않는 스킬: ${skillId}`);
  }
  // 기획서 8부 공통 규칙 4: 성능 약 105% 상한
  if (hidden.powerCap > 1.05) {
    error(`hidden/${hidden.id}`, `성능 상한 ${hidden.powerCap} — 105%를 넘으면 안 된다`);
  }
  if (hidden.unlockSteps.length < 3) {
    warn(`hidden/${hidden.id}`, '해금 조건이 3단계 미만이면 "진짜 히든"이라 하기 어렵다');
  }
}

/* ------------------------------------------------------------------ */
/* 4. 스킬 — 프레임 데이터 정합성                                        */
/* ------------------------------------------------------------------ */
for (const skill of SKILLS) {
  const isPassive = skill.kind === 'PASSIVE';
  const { startupMs, activeMs, recoveryMs } = skill.frames;

  if (!isPassive) {
    if (activeMs <= 0) error(`skills/${skill.id}`, '판정 시간(activeMs)이 0이다');
    if (startupMs < 0 || recoveryMs < 0) error(`skills/${skill.id}`, '음수 프레임');
    // 기획서 6-3-2 ②: 강한 스킬일수록 선딜이 길다
    if (skill.kind === 'ULTIMATE' && startupMs < 300) {
      warn(`skills/${skill.id}`, `궁극기 선딜이 ${startupMs}ms로 너무 짧다`);
    }
  }

  // PvP 계수는 PvE보다 커서는 안 된다 (PvP는 즉사 방지를 위해 낮춘다)
  if (skill.coef.pvp > skill.coef.pve) {
    error(`skills/${skill.id}`, `PvP 계수(${skill.coef.pvp})가 PvE(${skill.coef.pve})보다 크다`);
  }

  if (skill.hitbox) {
    const box = skill.hitbox;
    if (box.type === 'SECTOR' && (box.angle <= 0 || box.angle > 360)) {
      error(`skills/${skill.id}`, `부채꼴 각도가 이상하다: ${box.angle}`);
    }
    if (box.type === 'PROJECTILE' && box.speed <= 0) {
      error(`skills/${skill.id}`, '투사체 속도가 0 이하');
    }
    if (box.type === 'GROUND' && box.tickMs <= 0) {
      error(`skills/${skill.id}`, '장판 재판정 주기가 0 이하');
    }
  }

  if (!CLASS_BY_ID.has(skill.classId) && !HIDDEN_CLASSES.some((h) => h.id === skill.classId)) {
    error(`skills/${skill.id}`, `존재하지 않는 직업: ${skill.classId}`);
  }
}

/* ------------------------------------------------------------------ */
/* 5. 아이템 / 세트                                                     */
/* ------------------------------------------------------------------ */
for (const item of ITEMS) {
  if (!EQUIP_SLOTS.includes(item.slot)) error(`items/${item.id}`, `알 수 없는 슬롯: ${item.slot}`);
  if (!RARITIES.includes(item.rarity)) error(`items/${item.id}`, `알 수 없는 등급: ${item.rarity}`);

  const meta = RARITY_META[item.rarity];
  if (item.affixSlots > meta.affixLines) {
    error(`items/${item.id}`, `${item.rarity} 등급의 접사 줄 수 상한은 ${meta.affixLines}`);
  }
  if (item.sockets < 0 || item.sockets > 3) {
    error(`items/${item.id}`, `소켓 수가 범위(0~3)를 벗어난다: ${item.sockets}`);
  }
  if (item.rarity === 'MYTHIC' && item.tradable) {
    error(`items/${item.id}`, '신화 등급은 획득 즉시 귀속이어야 한다 (기획서 6-4-8)');
  }
  for (const [stat, range] of Object.entries(item.baseStats)) {
    if (!Array.isArray(range) || range.length !== 2) {
      error(`items/${item.id}`, `${stat}의 범위 표기가 잘못됐다`);
      continue;
    }
    if ((range[0] as number) > (range[1] as number)) {
      error(`items/${item.id}`, `${stat}의 최소값이 최대값보다 크다`);
    }
  }
  if (item.setId && !SETS.some((s) => s.id === item.setId)) {
    error(`items/${item.id}`, `존재하지 않는 세트: ${item.setId}`);
  }
}

for (const set of SETS) {
  for (const piece of set.pieces) {
    const item = ITEM_BY_ID.get(piece);
    if (!item) {
      error(`sets/${set.id}`, `존재하지 않는 구성품: ${piece}`);
      continue;
    }
    if (item.setId !== set.id) {
      error(`sets/${set.id}`, `${piece}의 setId가 ${item.setId}로 되어 있다`);
    }
  }
  for (const bonus of set.bonuses) {
    if (bonus.count > set.pieces.length) {
      warn(`sets/${set.id}`, `${bonus.count}세트 효과가 있는데 구성품은 ${set.pieces.length}개뿐이다`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 6. 퀘스트 — 여기가 가장 자주 깨진다                                   */
/* ------------------------------------------------------------------ */
for (const quest of QUESTS) {
  if (!MAP_BY_ID.has(quest.map)) error(`quests/${quest.id}`, `존재하지 않는 맵: ${quest.map}`);

  if (quest.giver && !NPC_BY_ID.has(quest.giver)) {
    error(`quests/${quest.id}`, `존재하지 않는 퀘스트 제공 NPC: ${quest.giver}`);
  }

  for (const prereq of quest.prerequisites) {
    if (!QUEST_BY_ID.has(prereq)) {
      error(`quests/${quest.id}`, `존재하지 않는 선행 퀘스트: ${prereq}`);
    }
  }

  if (quest.objectives.length === 0) error(`quests/${quest.id}`, '목표가 하나도 없다');

  quest.objectives.forEach((objective, index) => {
    if (!OBJECTIVE_TYPES.includes(objective.type)) {
      error(`quests/${quest.id}`, `objective[${index}]: 알 수 없는 타입 ${objective.type}`);
      return;
    }
    const target = objective.target;
    if (!target) {
      if (objective.type !== 'SURVIVE') {
        warn(`quests/${quest.id}`, `objective[${index}] (${objective.type})에 대상이 없다`);
      }
      return;
    }
    if (target.startsWith('mob_') || target.startsWith('boss_')) {
      if (!MONSTER_BY_ID.has(target)) {
        error(`quests/${quest.id}`, `objective[${index}]: 존재하지 않는 몬스터 ${target}`);
      }
    } else if (target.startsWith('item_')) {
      if (!ITEM_BY_ID.has(target)) {
        error(`quests/${quest.id}`, `objective[${index}]: 존재하지 않는 아이템 ${target}`);
      }
    } else if (target.startsWith('npc_')) {
      if (!NPC_BY_ID.has(target)) {
        error(`quests/${quest.id}`, `objective[${index}]: 존재하지 않는 NPC ${target}`);
      }
    } else if (target.startsWith('poi_')) {
      if (!POI_BY_ID.has(target)) {
        error(`quests/${quest.id}`, `objective[${index}]: 존재하지 않는 지점 ${target}`);
      }
    } else if (target.startsWith('choice_')) {
      if (objective.type !== 'CHOICE') {
        error(`quests/${quest.id}`, `objective[${index}]: choice_ 대상은 CHOICE 타입이어야 한다`);
      }
      if (!objective.choices || objective.choices.length < 2) {
        error(`quests/${quest.id}`, `objective[${index}]: 선택지가 2개 미만이다`);
      }
    } else {
      warn(`quests/${quest.id}`, `objective[${index}]: 접두사를 알 수 없는 대상 ${target}`);
    }

    if (objective.type === 'SURVIVE' && !objective.durationMs) {
      error(`quests/${quest.id}`, `objective[${index}]: SURVIVE에 durationMs가 없다`);
    }
  });

  for (const [itemId, count] of quest.rewards.items ?? []) {
    if (!ITEM_BY_ID.has(itemId)) {
      error(`quests/${quest.id}`, `보상 아이템 id 오타: ${itemId}`);
    }
    if (count <= 0) error(`quests/${quest.id}`, `보상 아이템 개수가 0 이하: ${itemId}`);
  }

  if (quest.rewards.exp < 0 || quest.rewards.gold < 0) {
    error(`quests/${quest.id}`, '음수 보상');
  }

  // 기획서 9-3: 히든 퀘스트는 로그에 등록되지 않는다
  if (quest.type === 'HIDDEN') {
    if (quest.flags.autoTrack) {
      error(`quests/${quest.id}`, '히든 퀘스트가 autoTrack: true — 로그에 노출된다');
    }
    if (!quest.hiddenTrigger) {
      error(`quests/${quest.id}`, '히든 퀘스트에 트리거가 없다');
    }
  }

  if (quest.type === 'DAILY' && !quest.flags.repeatable) {
    error(`quests/${quest.id}`, '일일/주간 퀘스트가 반복 불가로 설정됐다');
  }

  if (quest.unlocksHiddenClass && !HIDDEN_CLASSES.some((h) => h.id === quest.unlocksHiddenClass)) {
    error(`quests/${quest.id}`, `존재하지 않는 히든 직업 해금: ${quest.unlocksHiddenClass}`);
  }
}

// 선행 퀘스트 순환 참조
{
  const state = new Map<string, 'VISITING' | 'DONE'>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 'DONE') return;
    if (state.get(id) === 'VISITING') {
      error('quests', `선행 퀘스트 순환 참조: ${[...path, id].join(' → ')}`);
      return;
    }
    state.set(id, 'VISITING');
    for (const prereq of QUEST_BY_ID.get(id)?.prerequisites ?? []) {
      if (QUEST_BY_ID.has(prereq)) visit(prereq, [...path, id]);
    }
    state.set(id, 'DONE');
  };
  for (const quest of QUESTS) visit(quest.id, []);
}

/* ------------------------------------------------------------------ */
/* 7. 몬스터 / 던전 / 레이드                                            */
/* ------------------------------------------------------------------ */
for (const monster of MONSTERS) {
  if (!MAP_BY_ID.has(monster.map)) error(`monsters/${monster.id}`, `존재하지 않는 맵: ${monster.map}`);
  if (monster.hp <= 0 || monster.atk < 0) error(`monsters/${monster.id}`, '스탯이 이상하다');
  if (monster.poise <= 0) error(`monsters/${monster.id}`, '자세 게이지가 없다 — 보스도 예외 없다');
  const map = MAP_BY_ID.get(monster.map);
  if (map && monster.level < map.levelRange[0] - 2) {
    warn(`monsters/${monster.id}`, `맵 권장 레벨(${map.levelRange.join('-')})보다 크게 낮다`);
  }
}

for (const dungeon of DUNGEONS) {
  if (!MAP_BY_ID.has(dungeon.map)) error(`dungeons/${dungeon.id}`, `존재하지 않는 맵: ${dungeon.map}`);
  if (dungeon.players !== 4) error(`dungeons/${dungeon.id}`, '던전은 4인 규격이다');
  if (dungeon.levelRange[0] === 50 && !dungeon.difficulties.includes('HELL')) {
    warn(`dungeons/${dungeon.id}`, '50레벨 전용 던전인데 지옥 난이도가 없다');
  }
}

for (const raid of RAIDS) {
  if (raid.players !== 8 && raid.players !== 16) {
    error(`raids/${raid.id}`, '레이드는 8인 또는 16인이다');
  }
  if (raid.phases < 2) warn(`raids/${raid.id}`, '페이즈가 2개 미만');
  if (raid.levelRange[0] === 50 && raid.players !== 16) {
    warn(`raids/${raid.id}`, '50레벨 전용 레이드는 16인 규격이다');
  }
}

/* ------------------------------------------------------------------ */
/* 8. 기획서 목표치 대비 진행률                                          */
/* ------------------------------------------------------------------ */
const TARGETS = {
  maps: 19,
  classes: 10,
  hiddenClasses: 7,
  dungeons: 30,
  raids: 25,
  quests: 211,
  items: 800,
} as const;

const summary = dataSummary();

/* ------------------------------------------------------------------ */
/* 출력                                                                */
/* ------------------------------------------------------------------ */
const errors = issues.filter((i) => i.level === 'ERROR');
const warnings = issues.filter((i) => i.level === 'WARN');

console.log('═'.repeat(72));
console.log('  에테르니아 — 기획 데이터 무결성 검사');
console.log('═'.repeat(72));
console.log();

console.log('데이터 규모');
const rows: [string, number, number | null][] = [
  ['맵', summary.maps, TARGETS.maps],
  ['기본 직업', summary.classes, TARGETS.classes],
  ['히든 직업', summary.hiddenClasses, TARGETS.hiddenClasses],
  ['스킬', summary.skills, null],
  ['몬스터', summary.monsters, null],
  ['NPC', summary.npcs, null],
  ['지점(POI)', summary.pois, null],
  ['아이템', summary.items, TARGETS.items],
  ['세트', summary.sets, 40],
  ['퀘스트', summary.quests, TARGETS.quests],
  ['던전', summary.dungeons, TARGETS.dungeons],
  ['레이드', summary.raids, TARGETS.raids],
];
for (const [label, count, target] of rows) {
  const progress = target ? `  (기획서 목표 ${target} · ${Math.round((count / target) * 100)}%)` : '';
  console.log(`  ${label.padEnd(12)} ${String(count).padStart(5)}${progress}`);
}
console.log();

if (warnings.length > 0) {
  console.log(`경고 ${warnings.length}건`);
  for (const issue of warnings) console.log(`  ⚠ [${issue.where}] ${issue.message}`);
  console.log();
}

if (errors.length > 0) {
  console.log(`오류 ${errors.length}건`);
  for (const issue of errors) console.log(`  ✗ [${issue.where}] ${issue.message}`);
  console.log();
  console.log('데이터 검증 실패.');
  process.exit(1);
}

console.log(`✓ 참조 무결성 검사 통과 (경고 ${warnings.length}건)`);
