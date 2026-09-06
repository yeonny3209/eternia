/**
 * 기획서 2-3 — 모든 기획 데이터(JSON)를 한 곳에서 읽는다.
 *
 * 클라이언트와 서버가 같은 레지스트리를 쓴다. 데이터가 하나뿐이어야
 * "클라에는 있는데 서버에는 없는 아이템" 같은 부류의 버그가 사라진다.
 *
 * 새 JSON을 추가하면 여기에 import를 걸고, tools/validate-data.ts가
 * 참조 무결성을 검사한다.
 */
import classesJson from './classes.json' with { type: 'json' };
import hiddenClassesJson from './hidden-classes.json' with { type: 'json' };
import mapsJson from './maps.json' with { type: 'json' };
import monstersJson from './monsters.json' with { type: 'json' };
import npcsJson from './npcs.json' with { type: 'json' };
import poisJson from './pois.json' with { type: 'json' };
import itemsJson from './items.json' with { type: 'json' };
import generatedItemsJson from './items.generated.json' with { type: 'json' };
import setsJson from './sets.json' with { type: 'json' };
import dungeonsJson from './dungeons.json' with { type: 'json' };
import raidsJson from './raids.json' with { type: 'json' };

import swordsmanSkills from './skills/swordsman.json' with { type: 'json' };
import mageSkills from './skills/mage.json' with { type: 'json' };
import assassinSkills from './skills/assassin.json' with { type: 'json' };
import rogueSkills from './skills/rogue.json' with { type: 'json' };
import lancerSkills from './skills/lancer.json' with { type: 'json' };
import hexerSkills from './skills/hexer.json' with { type: 'json' };
import cantorSkills from './skills/cantor.json' with { type: 'json' };
import priestSkills from './skills/priest.json' with { type: 'json' };
import archerSkills from './skills/archer.json' with { type: 'json' };
import alchemistSkills from './skills/alchemist.json' with { type: 'json' };
import hiddenSkills from './skills/hidden.json' with { type: 'json' };

import dawnhollowQuests from './quests/dawnhollow.json' with { type: 'json' };
import whisperingWoodsQuests from './quests/whispering_woods.json' with { type: 'json' };
import haranPlainsQuests from './quests/haran_plains.json' with { type: 'json' };
import globalQuests from './quests/global.json' with { type: 'json' };

import type { SkillDef } from '../types/combat.js';
import type { ItemDef, SetDef } from '../types/item.js';
import type { QuestDef } from '../types/quest.js';
import type {
  ClassDef,
  DungeonDef,
  HiddenClassDef,
  MapDef,
  MonsterDef,
  RaidDef,
} from '../types/world.js';

export interface NpcDef {
  id: string;
  name: string;
  map: string;
  role: string;
}
export interface PoiDef {
  id: string;
  name: string;
  map: string;
}

export const CLASSES = classesJson as unknown as ClassDef[];
export const HIDDEN_CLASSES = hiddenClassesJson as unknown as HiddenClassDef[];
export const MAPS = mapsJson as unknown as MapDef[];
export const MONSTERS = monstersJson as unknown as MonsterDef[];
export const NPCS = npcsJson as unknown as NpcDef[];
export const POIS = poisJson as unknown as PoiDef[];
/**
 * 손으로 설계한 아이템 + tools/generate-items.ts 생성물.
 * 기획서 6-4-9: 영웅 이상만 손으로 만들고 일반~희귀는 조합으로 찍어낸다.
 */
export const HANDCRAFTED_ITEMS = itemsJson as unknown as ItemDef[];
export const GENERATED_ITEMS = generatedItemsJson as unknown as ItemDef[];
export const ITEMS: ItemDef[] = [...HANDCRAFTED_ITEMS, ...GENERATED_ITEMS];
export const SETS = setsJson as unknown as SetDef[];
export const DUNGEONS = dungeonsJson as unknown as DungeonDef[];
export const RAIDS = raidsJson as unknown as RaidDef[];

export const SKILLS: SkillDef[] = [
  ...(swordsmanSkills as unknown as SkillDef[]),
  ...(mageSkills as unknown as SkillDef[]),
  ...(assassinSkills as unknown as SkillDef[]),
  ...(rogueSkills as unknown as SkillDef[]),
  ...(lancerSkills as unknown as SkillDef[]),
  ...(hexerSkills as unknown as SkillDef[]),
  ...(cantorSkills as unknown as SkillDef[]),
  ...(priestSkills as unknown as SkillDef[]),
  ...(archerSkills as unknown as SkillDef[]),
  ...(alchemistSkills as unknown as SkillDef[]),
  ...(hiddenSkills as unknown as SkillDef[]),
];

export const QUESTS: QuestDef[] = [
  ...(dawnhollowQuests as unknown as QuestDef[]),
  ...(whisperingWoodsQuests as unknown as QuestDef[]),
  ...(haranPlainsQuests as unknown as QuestDef[]),
  ...(globalQuests as unknown as QuestDef[]),
];

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((entry) => [entry.id, entry]));
}

export const CLASS_BY_ID = byId(CLASSES);
export const HIDDEN_CLASS_BY_ID = byId(HIDDEN_CLASSES);
export const MAP_BY_ID = byId(MAPS);
export const MONSTER_BY_ID = byId(MONSTERS);
export const NPC_BY_ID = byId(NPCS);
export const POI_BY_ID = byId(POIS);
export const ITEM_BY_ID = byId(ITEMS);
export const SET_BY_ID = byId(SETS);
export const SKILL_BY_ID = byId(SKILLS);
export const QUEST_BY_ID = byId(QUESTS);
export const DUNGEON_BY_ID = byId(DUNGEONS);
export const RAID_BY_ID = byId(RAIDS);

export const questsForMap = (mapId: string): QuestDef[] => QUESTS.filter((q) => q.map === mapId);
export const skillsForClass = (classId: string): SkillDef[] =>
  SKILLS.filter((s) => s.classId === classId);
export const monstersForMap = (mapId: string): MonsterDef[] =>
  MONSTERS.filter((m) => m.map === mapId);

/** 데이터 규모 요약 — 클라이언트 도감/헬스체크가 그대로 쓴다 */
export function dataSummary() {
  return {
    classes: CLASSES.length,
    hiddenClasses: HIDDEN_CLASSES.length,
    maps: MAPS.length,
    monsters: MONSTERS.length,
    npcs: NPCS.length,
    pois: POIS.length,
    items: ITEMS.length,
    sets: SETS.length,
    skills: SKILLS.length,
    quests: QUESTS.length,
    dungeons: DUNGEONS.length,
    raids: RAIDS.length,
  };
}
