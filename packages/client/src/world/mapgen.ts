/**
 * 맵 생성 — maps.json 19종을 실제로 걸어다닐 수 있는 필드로 만든다.
 *
 * 손으로 타일을 찍지 않는다. 맵 id를 시드로 삼아 결정적으로 생성하므로
 * 누가 언제 접속해도 같은 지형이 나온다. 지형의 성격(바이옴)만 손으로 정의한다.
 *
 * 기획서 10-0의 연결 그래프를 그대로 써서, 인접 맵으로 가는 포탈을
 * 맵 가장자리에 배치한다. 저렙이 고렙 맵에 갈 수 있다 — 죽을 뿐이다(기획서 1-2 ①).
 */
import { MAPS, MAP_BY_ID, NPC_BY_ID, POIS, type MapDef } from '@eternia/shared';

export interface Vec2 {
  x: number;
  y: number;
}

/** 충돌하는 지형지물 */
export interface Obstacle {
  pos: Vec2;
  radius: number;
  kind: 'TREE' | 'ROCK' | 'WATER' | 'RUIN' | 'CRYSTAL' | 'BUILDING';
  /** 렌더 크기 변주 */
  scale: number;
}

/** 장식 — 충돌하지 않는다 */
export interface Decoration {
  pos: Vec2;
  kind: 'GRASS' | 'FLOWER' | 'PEBBLE' | 'BONE' | 'EMBER';
  scale: number;
}

export interface Portal {
  pos: Vec2;
  /** 목적지 맵 id */
  to: string;
  toName: string;
  /** 도착 시 서게 되는 위치 */
  radius: number;
}

export interface NpcPlacement {
  id: string;
  name: string;
  pos: Vec2;
  role: string;
}

/** 퀘스트가 지목하는 장소 — 이게 없으면 REACH/USE 목표를 끝낼 수 없다 */
export interface PoiPlacement {
  id: string;
  name: string;
  pos: Vec2;
}

export interface SpawnPoint {
  monsterId: string;
  pos: Vec2;
  /** 필드 보스는 하나만, 위치 고정 */
  isBoss: boolean;
}

export interface Biome {
  /** 바닥색 */
  ground: string;
  /** 바닥 격자색 */
  grid: string;
  /** 지형지물 주 색 */
  prop: string;
  propDark: string;
  /** 장식색 */
  decor: string;
  /** 안개/분위기 오버레이 (rgba) */
  haze: string;
  obstacleKinds: Obstacle['kind'][];
  decorKind: Decoration['kind'];
  density: number;
}

export interface GeneratedMap {
  def: MapDef;
  width: number;
  height: number;
  biome: Biome;
  obstacles: Obstacle[];
  decorations: Decoration[];
  portals: Portal[];
  npcs: NpcPlacement[];
  pois: PoiPlacement[];
  spawns: SpawnPoint[];
  /** 모닥불(세이브 포인트) */
  campfires: Vec2[];
  /** 처음 입장할 때 서는 자리 */
  entry: Vec2;
}

/* ------------------------------------------------------------------ */
/* 결정적 난수                                                          */
/* ------------------------------------------------------------------ */

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 바이옴 — 맵마다 손으로 정한다. 절차 생성만으로는 분위기가 안 산다      */
/* ------------------------------------------------------------------ */

const BIOMES: Record<string, Biome> = {
  dawnhollow: {
    ground: '#1d2a1c', grid: 'rgba(140,190,120,0.06)',
    prop: '#3f6b35', propDark: '#25401f', decor: '#5d8f4a',
    haze: 'rgba(255,214,140,0.05)',
    obstacleKinds: ['BUILDING', 'TREE'], decorKind: 'FLOWER', density: 0.5,
  },
  whispering_woods: {
    ground: '#16241a', grid: 'rgba(120,200,140,0.05)',
    prop: '#2f5c33', propDark: '#1a3620', decor: '#4c8a52',
    haze: 'rgba(120,220,160,0.05)',
    obstacleKinds: ['TREE'], decorKind: 'GRASS', density: 1.5,
  },
  haran_plains: {
    ground: '#2a2c1a', grid: 'rgba(210,200,120,0.05)',
    prop: '#6b6034', propDark: '#3d3720', decor: '#8f8447',
    haze: 'rgba(255,236,160,0.04)',
    obstacleKinds: ['ROCK', 'TREE'], decorKind: 'GRASS', density: 0.6,
  },
  silverflow_basin: {
    ground: '#15242c', grid: 'rgba(140,200,220,0.06)',
    prop: '#2b5f72', propDark: '#173846', decor: '#4a94ab',
    haze: 'rgba(120,200,255,0.06)',
    obstacleKinds: ['WATER', 'ROCK'], decorKind: 'PEBBLE', density: 0.9,
  },
  kardein: {
    ground: '#221c18', grid: 'rgba(220,180,120,0.06)',
    prop: '#5a4632', propDark: '#33271c', decor: '#8a6c48',
    haze: 'rgba(255,180,90,0.05)',
    obstacleKinds: ['BUILDING'], decorKind: 'PEBBLE', density: 0.7,
  },
  crimson_ravine: {
    ground: '#2a1614', grid: 'rgba(230,130,110,0.06)',
    prop: '#7a3628', propDark: '#451c15', decor: '#a8543c',
    haze: 'rgba(255,120,80,0.05)',
    obstacleKinds: ['ROCK'], decorKind: 'PEBBLE', density: 1.2,
  },
  shadowmire: {
    ground: '#161d18', grid: 'rgba(120,180,130,0.04)',
    prop: '#2c4433', propDark: '#18271d', decor: '#3f6b4a',
    haze: 'rgba(90,140,110,0.14)',
    obstacleKinds: ['WATER', 'TREE'], decorKind: 'BONE', density: 1.1,
  },
  frostreach: {
    ground: '#1d2733', grid: 'rgba(190,220,255,0.07)',
    prop: '#3f5670', propDark: '#26364a', decor: '#7fa3c9',
    haze: 'rgba(200,230,255,0.09)',
    obstacleKinds: ['ROCK', 'TREE'], decorKind: 'PEBBLE', density: 0.9,
  },
  forgotten_aqueduct: {
    ground: '#191720', grid: 'rgba(160,150,200,0.05)',
    prop: '#3a3348', propDark: '#221e2c', decor: '#5c5175',
    haze: 'rgba(140,120,200,0.07)',
    obstacleKinds: ['RUIN', 'WATER'], decorKind: 'BONE', density: 1.3,
  },
  sehab_ruins: {
    ground: '#2e2618', grid: 'rgba(240,210,140,0.06)',
    prop: '#7a6236', propDark: '#453720', decor: '#b09054',
    haze: 'rgba(255,220,140,0.07)',
    obstacleKinds: ['RUIN', 'ROCK'], decorKind: 'PEBBLE', density: 0.8,
  },
  aeris_isles: {
    ground: '#182233', grid: 'rgba(160,200,255,0.07)',
    prop: '#37536f', propDark: '#203348', decor: '#6fa0cc',
    haze: 'rgba(150,200,255,0.08)',
    obstacleKinds: ['ROCK', 'CRYSTAL'], decorKind: 'GRASS', density: 0.7,
  },
  obsidian_caldera: {
    ground: '#21140f', grid: 'rgba(255,140,60,0.06)',
    prop: '#4a251a', propDark: '#2a140e', decor: '#c2551f',
    haze: 'rgba(255,110,40,0.08)',
    obstacleKinds: ['ROCK', 'CRYSTAL'], decorKind: 'EMBER', density: 1.1,
  },
  sunken_laisha: {
    ground: '#0f1e28', grid: 'rgba(110,190,220,0.06)',
    prop: '#1e4a5c', propDark: '#122c38', decor: '#3d8ba6',
    haze: 'rgba(60,150,200,0.16)',
    obstacleKinds: ['RUIN', 'WATER'], decorKind: 'PEBBLE', density: 1.2,
  },
  argent_capital: {
    ground: '#1c1f2b', grid: 'rgba(200,210,255,0.06)',
    prop: '#4a5170', propDark: '#2b3048', decor: '#8d97c4',
    haze: 'rgba(200,215,255,0.05)',
    obstacleKinds: ['BUILDING'], decorKind: 'PEBBLE', density: 0.8,
  },
  riftwastes: {
    ground: '#1a1424', grid: 'rgba(190,140,255,0.07)',
    prop: '#4a2a66', propDark: '#2a1740', decor: '#8b5cd6',
    haze: 'rgba(160,90,255,0.09)',
    obstacleKinds: ['CRYSTAL', 'ROCK'], decorKind: 'EMBER', density: 1.0,
  },
  skyspire: {
    ground: '#151a2e', grid: 'rgba(180,190,255,0.07)',
    prop: '#3a3f66', propDark: '#232742', decor: '#7b83c4',
    haze: 'rgba(180,190,255,0.07)',
    obstacleKinds: ['RUIN', 'CRYSTAL'], decorKind: 'PEBBLE', density: 0.9,
  },
  starlit_garden: {
    ground: '#141b2a', grid: 'rgba(190,230,255,0.08)',
    prop: '#2f5a55', propDark: '#1b3733', decor: '#7fd9c4',
    haze: 'rgba(160,255,230,0.07)',
    obstacleKinds: ['TREE', 'CRYSTAL'], decorKind: 'FLOWER', density: 0.9,
  },
  nameless_verge: {
    ground: '#12111a', grid: 'rgba(150,150,180,0.05)',
    prop: '#2e2b3d', propDark: '#1a1826', decor: '#514d6b',
    haze: 'rgba(80,70,120,0.12)',
    obstacleKinds: ['CRYSTAL', 'RUIN'], decorKind: 'BONE', density: 1.0,
  },
  warped_chamber: {
    ground: '#191426', grid: 'rgba(220,180,255,0.08)',
    prop: '#443364', propDark: '#271d3c', decor: '#9a72d6',
    haze: 'rgba(190,140,255,0.1)',
    obstacleKinds: ['CRYSTAL'], decorKind: 'EMBER', density: 1.4,
  },
};

const FALLBACK_BIOME: Biome = BIOMES.haran_plains as Biome;

/* ------------------------------------------------------------------ */
/* 생성                                                                 */
/* ------------------------------------------------------------------ */

/** 맵 크기 — 도시는 좁고 필드는 넓다 */
function mapSize(def: MapDef): { width: number; height: number } {
  if (def.kind === 'TOWN') return { width: 62, height: 44 };
  if (def.kind === 'HIDDEN') return { width: 54, height: 40 };
  if (def.kind === 'ENDGAME') return { width: 92, height: 64 };
  return { width: 82, height: 58 };
}

/** 연결된 맵이 어느 가장자리에 붙을지 — 쌍마다 항상 같게 나와야 한다 */
function portalSide(from: string, to: string): 0 | 1 | 2 | 3 {
  // 두 맵 이름을 정렬해 해시하면 A→B와 B→A가 같은 축을 쓴다
  const [a, b] = [from, to].sort();
  const axis = hashString(`${a}|${b}`) % 2; // 0 = 가로, 1 = 세로
  const forward = from < to;
  if (axis === 0) return forward ? 1 : 3; // 오른쪽 / 왼쪽
  return forward ? 2 : 0; // 아래 / 위
}

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

const cache = new Map<string, GeneratedMap>();

export function generateMap(mapId: string): GeneratedMap {
  const cached = cache.get(mapId);
  if (cached) return cached;

  const def = MAP_BY_ID.get(mapId) as MapDef;
  if (!def) throw new Error(`알 수 없는 맵: ${mapId}`);

  const rng = mulberry32(hashString(mapId));
  const biome = BIOMES[mapId] ?? FALLBACK_BIOME;
  const { width, height } = mapSize(def);
  const margin = 3;

  const obstacles: Obstacle[] = [];
  const decorations: Decoration[] = [];
  const portals: Portal[] = [];
  const npcs: NpcPlacement[] = [];
  const pois: PoiPlacement[] = [];
  const spawns: SpawnPoint[] = [];
  const campfires: Vec2[] = [];

  const center: Vec2 = { x: width / 2, y: height / 2 };
  // 중앙 광장은 비워 둔다 — 도착하자마자 나무에 끼면 최악이다
  const clearRadius = def.kind === 'TOWN' ? 9 : 6;

  /* 포탈 — 인접 맵마다 하나씩 가장자리에 */
  for (const to of def.connections) {
    const target = MAP_BY_ID.get(to);
    if (!target) continue;
    const side = portalSide(mapId, to);
    const jitter = 0.3 + rng() * 0.4;
    let pos: Vec2;
    switch (side) {
      case 0: pos = { x: width * jitter, y: margin }; break;
      case 1: pos = { x: width - margin, y: height * jitter }; break;
      case 2: pos = { x: width * jitter, y: height - margin }; break;
      default: pos = { x: margin, y: height * jitter };
    }
    portals.push({ pos, to, toName: target.name, radius: 2.2 });
  }

  const blockedBy = (pos: Vec2, radius: number): boolean => {
    if (distanceSq(pos, center) < (clearRadius + radius) ** 2) return true;
    for (const portal of portals) {
      if (distanceSq(pos, portal.pos) < (portal.radius + radius + 3) ** 2) return true;
    }
    for (const obstacle of obstacles) {
      if (distanceSq(pos, obstacle.pos) < (obstacle.radius + radius + 0.6) ** 2) return true;
    }
    return false;
  };

  const randomSpot = (radius: number, tries = 40): Vec2 | null => {
    for (let i = 0; i < tries; i += 1) {
      const pos = {
        x: margin + rng() * (width - margin * 2),
        y: margin + rng() * (height - margin * 2),
      };
      if (!blockedBy(pos, radius)) return pos;
    }
    return null;
  };

  /* 지형지물 */
  const area = width * height;
  const obstacleCount = Math.round((area / 90) * biome.density);
  for (let i = 0; i < obstacleCount; i += 1) {
    const kind = biome.obstacleKinds[
      Math.floor(rng() * biome.obstacleKinds.length)
    ] as Obstacle['kind'];
    const radius =
      kind === 'BUILDING' ? 2.2 + rng() * 1.6
      : kind === 'WATER' ? 2.4 + rng() * 2.4
      : kind === 'TREE' ? 0.8 + rng() * 0.6
      : 0.7 + rng() * 0.9;
    const pos = randomSpot(radius, 14);
    if (!pos) continue;
    obstacles.push({ pos, radius, kind, scale: 0.85 + rng() * 0.5 });
  }

  /* 장식 */
  const decorCount = Math.round(area / 12);
  for (let i = 0; i < decorCount; i += 1) {
    decorations.push({
      pos: { x: rng() * width, y: rng() * height },
      kind: biome.decorKind,
      scale: 0.6 + rng() * 0.9,
    });
  }

  /* 모닥불 — 기획서 10-0: 맵당 3~6개 */
  for (let i = 0; i < def.campfires; i += 1) {
    const pos = randomSpot(1.6) ?? { x: center.x + i * 2, y: center.y };
    campfires.push(pos);
    // 모닥불 주변은 안전지대처럼 비워 둔다
    obstacles.push({ pos: { x: pos.x, y: pos.y }, radius: 0.001, kind: 'ROCK', scale: 0 });
    obstacles.pop();
  }

  /* NPC — 중앙 광장 둘레에 세운다. 찾기 쉬워야 한다 */
  def.npcs.forEach((npcId, index) => {
    const angle = (index / Math.max(1, def.npcs.length)) * Math.PI * 2;
    const distance = clearRadius - 2.2;
    const npcDef = NPC_BY_ID.get(npcId);
    npcs.push({
      id: npcId,
      name: npcDef?.name ?? npcId,
      pos: { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance },
      role: npcDef?.role ?? '',
    });
  });

  /* 퀘스트 장소(POI) — 중앙에서 조금 떨어뜨려 '찾아가는' 맛을 준다 */
  for (const poi of POIS.filter((p) => p.map === mapId)) {
    const pos = randomSpot(2.0, 30) ?? {
      x: center.x + (rng() - 0.5) * 20,
      y: center.y + (rng() - 0.5) * 14,
    };
    pois.push({ id: poi.id, name: poi.name, pos });
  }

  /* 몬스터 스폰 지점 */
  if (def.monsters.length > 0) {
    // 넓은 맵에 20마리를 뿌리면 사냥터가 아니라 빈 들판이 된다
    const spawnCount =
      def.kind === 'ENDGAME' ? 40 : def.kind === 'HIDDEN' ? 26 : 32;
    for (let i = 0; i < spawnCount; i += 1) {
      const pos = randomSpot(1.0, 20);
      if (!pos) continue;
      const monsterId = def.monsters[Math.floor(rng() * def.monsters.length)] as string;
      spawns.push({ monsterId, pos, isBoss: false });
    }
  }
  if (def.fieldBoss) {
    // 보스는 중앙에서 먼 구석에 — 우연히 마주치지 않게
    const corner: Vec2 = { x: width - margin - 6, y: height - margin - 6 };
    spawns.push({ monsterId: def.fieldBoss, pos: corner, isBoss: true });
  }

  const generated: GeneratedMap = {
    def,
    width,
    height,
    biome,
    obstacles,
    decorations,
    portals,
    npcs,
    pois,
    spawns,
    campfires,
    entry: { ...center },
  };

  cache.set(mapId, generated);
  return generated;
}

/** 다른 맵에서 넘어왔을 때 서는 자리 — 온 쪽 포탈 바로 앞 */
export function arrivalPoint(target: GeneratedMap, fromMapId: string | null): Vec2 {
  if (!fromMapId) return { ...target.entry };
  const portal = target.portals.find((p) => p.to === fromMapId);
  if (!portal) return { ...target.entry };
  // 포탈에 겹쳐 서면 곧바로 되돌아가 버리므로 안쪽으로 밀어 넣는다
  const inward = {
    x: target.width / 2 - portal.pos.x,
    y: target.height / 2 - portal.pos.y,
  };
  const length = Math.hypot(inward.x, inward.y) || 1;
  return {
    x: portal.pos.x + (inward.x / length) * (portal.radius + 2.2),
    y: portal.pos.y + (inward.y / length) * (portal.radius + 2.2),
  };
}

/** 월드 지도용 — 맵 그래프를 2D 좌표로 편다 (기획서 10-0 구조를 대략 재현) */
export const WORLD_LAYOUT: Record<string, Vec2> = {
  dawnhollow: { x: 1, y: 9 },
  whispering_woods: { x: 1, y: 8 },
  warped_chamber: { x: 0, y: 8 },
  haran_plains: { x: 1, y: 7 },
  forgotten_aqueduct: { x: 1, y: 6 },
  kardein: { x: 1, y: 5 },
  shadowmire: { x: 2.4, y: 6 },
  sunken_laisha: { x: 3.6, y: 6 },
  silverflow_basin: { x: 3, y: 5 },
  crimson_ravine: { x: 3.6, y: 4 },
  frostreach: { x: 1, y: 4 },
  sehab_ruins: { x: 4.4, y: 3 },
  argent_capital: { x: 2.4, y: 3 },
  nameless_verge: { x: 1, y: 2.4 },
  obsidian_caldera: { x: 4.4, y: 2 },
  riftwastes: { x: 1.6, y: 1.6 },
  aeris_isles: { x: 3.6, y: 1.2 },
  skyspire: { x: 2.4, y: 1.2 },
  starlit_garden: { x: 3.6, y: 0.2 },
};

export function allMapsOrdered(): MapDef[] {
  return [...MAPS].sort((a, b) => a.index - b.index);
}
