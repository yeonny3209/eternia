/**
 * 3인칭 3D 렌더러 (Three.js).
 *
 * 게임 로직은 2D 평면(x, y)에서 돈다 — 히트박스도, 이동도, 퀘스트도.
 * 여기서는 그 좌표를 3D의 (x, z)로 옮겨 그리기만 한다.
 * 그래서 렌더러를 3D로 바꿔도 @eternia/shared의 판정 코드는 한 줄도 안 바뀌었다.
 *
 * 좌표 규칙
 *   2D (x, y)        → 3D (x, 0, y)      y축은 높이로만 쓴다
 *   조준 각도 aim     → 방향 (cos aim, 0, sin aim)
 *   메시는 +X가 정면  → rotation.y = -aim
 */
import * as THREE from 'three';
import type { GeneratedMap, Obstacle, Vec2 } from './mapgen.js';

/** 렌더러가 매 프레임 받는 월드 스냅샷 — 서버에서 내려오는 것과 같은 모양 */
export interface RenderSnapshot {
  nowMs: number;
  player: {
    pos: Vec2;
    aim: number;
    radius: number;
    alive: boolean;
    guarding: boolean;
    invulnerable: boolean;
    moving: boolean;
    nickname: string;
    level: number;
    hpRatio: number;
  };
  monsters: {
    id: string;
    pos: Vec2;
    aim: number;
    radius: number;
    hpRatio: number;
    name: string;
    level: number;
    kind: 'NORMAL' | 'ELITE' | 'FIELD_BOSS' | 'DUNGEON_BOSS' | 'RAID_BOSS';
    isBoss: boolean;
    groggy: boolean;
    /** 공격 예고 진행도 0..1. null이면 예고 중 아님 */
    telegraph: number | null;
    attackRange: number;
    attackAngle: number;
  }[];
  slashes: {
    origin: Vec2;
    aim: number;
    range: number;
    angle: number;
    age: number;
    life: number;
    hostile: boolean;
  }[];
  floaters: { text: string; pos: Vec2; age: number; life: number; color: string; size: number }[];
  /** 상호작용 안내 */
  prompt: string | null;
}

/** 바이옴별 하늘·안개·조명 — 2D 팔레트만으로는 3D에서 분위기가 안 산다 */
interface SkyPreset {
  sky: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  ambient: string;
  sunIntensity: number;
}

const SKY: Record<string, SkyPreset> = {
  dawnhollow: { sky: '#3a4a63', fog: '#3a4a63', fogNear: 26, fogFar: 95, sun: '#ffd9a0', ambient: '#4a5a72', sunIntensity: 1.5 },
  whispering_woods: { sky: '#223a2c', fog: '#223a2c', fogNear: 16, fogFar: 62, sun: '#bfe7a8', ambient: '#38513f', sunIntensity: 1.2 },
  haran_plains: { sky: '#5a5a3c', fog: '#5a5a3c', fogNear: 32, fogFar: 120, sun: '#ffeaa0', ambient: '#61604a', sunIntensity: 1.7 },
  silverflow_basin: { sky: '#2c4a5a', fog: '#2c4a5a', fogNear: 24, fogFar: 90, sun: '#bfe4ff', ambient: '#3b5c6e', sunIntensity: 1.4 },
  kardein: { sky: '#4a3a2c', fog: '#4a3a2c', fogNear: 22, fogFar: 80, sun: '#ffc987', ambient: '#5a4636', sunIntensity: 1.4 },
  crimson_ravine: { sky: '#4a2620', fog: '#4a2620', fogNear: 20, fogFar: 75, sun: '#ff9f7a', ambient: '#5c3128', sunIntensity: 1.3 },
  shadowmire: { sky: '#22302a', fog: '#1e2a24', fogNear: 10, fogFar: 42, sun: '#9dbfa5', ambient: '#2e4038', sunIntensity: 0.9 },
  frostreach: { sky: '#42556e', fog: '#42556e', fogNear: 18, fogFar: 70, sun: '#e6f2ff', ambient: '#526a86', sunIntensity: 1.5 },
  forgotten_aqueduct: { sky: '#221f2e', fog: '#1c1a26', fogNear: 12, fogFar: 46, sun: '#a99fd0', ambient: '#2e2a3e', sunIntensity: 0.9 },
  sehab_ruins: { sky: '#5e4c2e', fog: '#5e4c2e', fogNear: 28, fogFar: 105, sun: '#ffe6a8', ambient: '#6b5836', sunIntensity: 1.8 },
  aeris_isles: { sky: '#3a5578', fog: '#3a5578', fogNear: 26, fogFar: 100, sun: '#d6ecff', ambient: '#48628a', sunIntensity: 1.6 },
  obsidian_caldera: { sky: '#3a1c12', fog: '#3a1c12', fogNear: 16, fogFar: 62, sun: '#ff8a4a', ambient: '#4e2718', sunIntensity: 1.3 },
  sunken_laisha: { sky: '#15303e', fog: '#123040', fogNear: 8, fogFar: 38, sun: '#7fd0e8', ambient: '#1e4356', sunIntensity: 0.9 },
  argent_capital: { sky: '#3c4159', fog: '#3c4159', fogNear: 26, fogFar: 95, sun: '#e2e8ff', ambient: '#4b5170', sunIntensity: 1.5 },
  riftwastes: { sky: '#2e1f42', fog: '#2e1f42', fogNear: 18, fogFar: 72, sun: '#c79bff', ambient: '#3d2a56', sunIntensity: 1.2 },
  skyspire: { sky: '#2a3054', fog: '#2a3054', fogNear: 24, fogFar: 92, sun: '#c9d0ff', ambient: '#38406b', sunIntensity: 1.4 },
  starlit_garden: { sky: '#1f3448', fog: '#1f3448', fogNear: 22, fogFar: 85, sun: '#a8ffe6', ambient: '#2b4b5e', sunIntensity: 1.3 },
  nameless_verge: { sky: '#1a1826', fog: '#161422', fogNear: 12, fogFar: 50, sun: '#8f88b8', ambient: '#26233a', sunIntensity: 0.9 },
  warped_chamber: { sky: '#281d3e', fog: '#281d3e', fogNear: 14, fogFar: 55, sun: '#cfa4ff', ambient: '#372a52', sunIntensity: 1.1 },
};

const DEFAULT_SKY: SkyPreset = SKY.haran_plains as SkyPreset;

/** 3D 벡터로 */
const v3 = (p: Vec2, y = 0): THREE.Vector3 => new THREE.Vector3(p.x, y, p.y);

export interface CameraConfig {
  distance: number;
  height: number;
  pitch: number;
}

export class Renderer3D {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly overlay: HTMLDivElement;

  /** 맵이 바뀌면 통째로 갈아끼우는 정적 지형 */
  private staticGroup = new THREE.Group();
  private currentMapId: string | null = null;
  private mapRef: GeneratedMap | null = null;

  private sun!: THREE.DirectionalLight;
  private ambient!: THREE.HemisphereLight;

  /** 동적 엔티티 */
  private playerRig: THREE.Group | null = null;
  private playerParts: {
    body: THREE.Mesh;
    head: THREE.Mesh;
    weapon: THREE.Mesh;
    guard: THREE.Mesh;
    ring: THREE.Mesh;
  } | null = null;
  private readonly monsterRigs = new Map<string, THREE.Group>();
  private readonly slashMeshes: { mesh: THREE.Mesh; born: number; life: number }[] = [];
  private readonly telegraphMeshes = new Map<string, THREE.Mesh>();

  /** 카메라 */
  camDistance = 8.0;
  camPitch = 0.42;
  private readonly camTarget = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.cursor = 'crosshair';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 400);
    this.scene.add(this.camera);

    this.overlay = document.createElement('div');
    this.overlay.className = 'world3d-overlay';
    container.appendChild(this.overlay);

    this.setupLights();
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private setupLights(): void {
    this.ambient = new THREE.HemisphereLight(0x94a3c4, 0x2b2b20, 1.55);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.position.set(24, 40, 16);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  resize(): void {
    const width = Math.max(320, this.container.clientWidth);
    const height = Math.max(300, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------ */
  /* 정적 지형                                                           */
  /* ------------------------------------------------------------------ */

  setMap(map: GeneratedMap): void {
    if (this.currentMapId === map.def.id) return;
    this.currentMapId = map.def.id;
    this.mapRef = map;

    this.disposeGroup(this.staticGroup);
    this.scene.remove(this.staticGroup);
    this.staticGroup = new THREE.Group();
    this.scene.add(this.staticGroup);

    const preset = SKY[map.def.id] ?? DEFAULT_SKY;
    this.scene.background = new THREE.Color(preset.sky);
    this.scene.fog = new THREE.Fog(preset.fog, preset.fogNear, preset.fogFar);
    this.sun.color = new THREE.Color(preset.sun);
    this.sun.intensity = preset.sunIntensity * 1.35;
    this.ambient.color = new THREE.Color(preset.ambient);
    this.ambient.intensity = 1.55;
    this.ambient.groundColor = new THREE.Color(map.biome.ground);

    this.buildGround(map);
    this.buildObstacles(map);
    this.buildDecorations(map);
    this.buildPortals(map);
    this.buildCampfires(map);
    this.buildPois(map);
    this.buildNpcs(map);

    // 맵이 바뀌면 몬스터 리그도 전부 버린다
    for (const rig of this.monsterRigs.values()) this.disposeGroup(rig);
    this.monsterRigs.clear();
    for (const mesh of this.telegraphMeshes.values()) this.disposeObject(mesh);
    this.telegraphMeshes.clear();
  }

  private buildGround(map: GeneratedMap): void {
    const geometry = new THREE.PlaneGeometry(map.width, map.height, 48, 34);
    geometry.rotateX(-Math.PI / 2);

    // 완전히 평평하면 3D로 만든 티가 안 난다. 살짝 굴곡을 준다.
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const h =
        Math.sin(x * 0.12) * 0.35 +
        Math.cos(z * 0.15) * 0.3 +
        Math.sin((x + z) * 0.07) * 0.25;
      position.setY(i, h);
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(map.biome.ground).multiplyScalar(2.3),
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.position.set(map.width / 2, -0.05, map.height / 2);
    this.staticGroup.add(ground);

    // 맵 경계 — 보이지 않는 벽 대신 눈에 보이는 테두리
    const edgeGeometry = new THREE.RingGeometry(0, 1, 4);
    edgeGeometry.dispose();
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(map.width + 1.2, 1.6, map.height + 1.2),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(map.biome.propDark),
        side: THREE.BackSide,
        roughness: 1,
      }),
    );
    border.position.set(map.width / 2, 0.7, map.height / 2);
    this.staticGroup.add(border);
  }

  /** 지형지물은 종류별 InstancedMesh로 한 번에 그린다 */
  private buildObstacles(map: GeneratedMap): void {
    const byKind = new Map<Obstacle['kind'], Obstacle[]>();
    for (const obstacle of map.obstacles) {
      if (obstacle.radius < 0.05) continue;
      const list = byKind.get(obstacle.kind) ?? [];
      list.push(obstacle);
      byKind.set(obstacle.kind, list);
    }

    const prop = new THREE.Color(map.biome.prop).multiplyScalar(1.35);
    const propDark = new THREE.Color(map.biome.propDark).multiplyScalar(1.4);
    const decor = new THREE.Color(map.biome.decor).multiplyScalar(1.2);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    for (const [kind, list] of byKind) {
      if (kind === 'TREE') {
        const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
        const trunkMat = new THREE.MeshStandardMaterial({ color: propDark, roughness: 1, flatShading: true });
        const leafGeo = new THREE.IcosahedronGeometry(1, 0);
        const leafMat = new THREE.MeshStandardMaterial({ color: prop, roughness: 0.9, flatShading: true });
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
        const leaves = new THREE.InstancedMesh(leafGeo, leafMat, list.length);

        list.forEach((obstacle, index) => {
          const height = 2.4 + obstacle.scale * 2.2;
          position.set(obstacle.pos.x, height / 2, obstacle.pos.y);
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), obstacle.pos.x * 3.1);
          scale.set(obstacle.radius * 1.5, height, obstacle.radius * 1.5);
          trunks.setMatrixAt(index, matrix.compose(position, quaternion, scale));

          position.set(obstacle.pos.x, height + obstacle.radius * 0.5, obstacle.pos.y);
          scale.setScalar(obstacle.radius * (1.5 + obstacle.scale * 0.5));
          leaves.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        });
        trunks.instanceMatrix.needsUpdate = true;
        leaves.instanceMatrix.needsUpdate = true;
        this.staticGroup.add(trunks, leaves);
        continue;
      }

      if (kind === 'WATER') {
        const geo = new THREE.CircleGeometry(1, 16);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#3a86ad'),
          transparent: true,
          opacity: 0.72,
          roughness: 0.15,
          metalness: 0.4,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((obstacle, index) => {
          position.set(obstacle.pos.x, 0.06, obstacle.pos.y);
          quaternion.identity();
          scale.set(obstacle.radius, 1, obstacle.radius);
          mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.staticGroup.add(mesh);
        continue;
      }

      if (kind === 'BUILDING') {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: prop, roughness: 0.85, flatShading: true });
        const roofGeo = new THREE.ConeGeometry(1, 1, 4);
        const roofMat = new THREE.MeshStandardMaterial({ color: propDark, roughness: 0.9, flatShading: true });
        const walls = new THREE.InstancedMesh(geo, mat, list.length);
        const roofs = new THREE.InstancedMesh(roofGeo, roofMat, list.length);

        list.forEach((obstacle, index) => {
          const height = 3 + obstacle.scale * 1.6;
          const side = obstacle.radius * 1.7;
          position.set(obstacle.pos.x, height / 2, obstacle.pos.y);
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(obstacle.pos.y) * 0.4);
          scale.set(side, height, side);
          walls.setMatrixAt(index, matrix.compose(position, quaternion, scale));

          position.set(obstacle.pos.x, height + obstacle.radius * 0.55, obstacle.pos.y);
          scale.set(obstacle.radius * 1.5, obstacle.radius * 1.2, obstacle.radius * 1.5);
          roofs.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        });
        walls.instanceMatrix.needsUpdate = true;
        roofs.instanceMatrix.needsUpdate = true;
        this.staticGroup.add(walls, roofs);
        continue;
      }

      if (kind === 'CRYSTAL') {
        const geo = new THREE.OctahedronGeometry(1, 0);
        const mat = new THREE.MeshStandardMaterial({
          color: decor,
          roughness: 0.25,
          metalness: 0.35,
          emissive: new THREE.Color(decor).multiplyScalar(0.35),
          flatShading: true,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((obstacle, index) => {
          const height = obstacle.radius * (2.2 + obstacle.scale);
          position.set(obstacle.pos.x, height * 0.55, obstacle.pos.y);
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), obstacle.pos.x);
          scale.set(obstacle.radius, height, obstacle.radius);
          mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.staticGroup.add(mesh);
        continue;
      }

      // ROCK / RUIN — 바위는 다면체, 유적은 무너진 기둥
      const isRuin = kind === 'RUIN';
      const geo = isRuin ? new THREE.BoxGeometry(1, 1, 1) : new THREE.DodecahedronGeometry(1, 0);
      const mat = new THREE.MeshStandardMaterial({ color: prop, roughness: 1, flatShading: true });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((obstacle, index) => {
        const height = isRuin ? obstacle.radius * (2.4 + obstacle.scale) : obstacle.radius * 1.4;
        position.set(obstacle.pos.x, height * 0.42, obstacle.pos.y);
        quaternion.setFromEuler(
          new THREE.Euler(isRuin ? 0 : obstacle.scale * 0.3, obstacle.pos.x * 1.7, isRuin ? obstacle.scale * 0.12 : obstacle.scale * 0.2),
        );
        scale.set(obstacle.radius * (isRuin ? 0.9 : 1.25), height, obstacle.radius * (isRuin ? 0.9 : 1.25));
        mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.staticGroup.add(mesh);
    }
  }

  private buildDecorations(map: GeneratedMap): void {
    if (map.decorations.length === 0) return;
    const kind = map.biome.decorKind;
    const geo =
      kind === 'GRASS'
        ? new THREE.ConeGeometry(0.09, 0.55, 4)
        : kind === 'FLOWER'
          ? new THREE.SphereGeometry(0.1, 5, 4)
          : new THREE.TetrahedronGeometry(0.14, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(map.biome.decor),
      roughness: 1,
      flatShading: true,
    });

    // 너무 많으면 무겁다. 화면에 깔릴 만큼만 남긴다.
    const list = map.decorations.slice(0, 900);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    list.forEach((decoration, index) => {
      position.set(decoration.pos.x, 0.2, decoration.pos.y);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), decoration.pos.x * 2.7);
      scale.setScalar(0.7 + decoration.scale * 0.9);
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.staticGroup.add(mesh);
  }

  private buildPortals(map: GeneratedMap): void {
    for (const portal of map.portals) {
      const group = new THREE.Group();
      group.position.copy(v3(portal.pos));
      group.userData.spin = true;

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(portal.radius * 0.9, 0.16, 10, 32),
        new THREE.MeshStandardMaterial({
          color: 0xa78bfa,
          emissive: 0x7c3aed,
          emissiveIntensity: 1.4,
          roughness: 0.3,
        }),
      );
      ring.position.y = portal.radius * 0.95;
      group.add(ring);

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(portal.radius * 0.85, 24),
        new THREE.MeshBasicMaterial({
          color: 0x8b5cf6,
          transparent: true,
          opacity: 0.34,
          side: THREE.DoubleSide,
        }),
      );
      disc.position.y = portal.radius * 0.95;
      group.add(disc);

      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(portal.radius * 1.4, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.18 }),
      );
      glow.position.y = 0.05;
      group.add(glow);

      group.add(this.makeLabel(portal.toName, '#ddd6fe', portal.radius * 2.1));
      this.staticGroup.add(group);
    }
  }

  private buildCampfires(map: GeneratedMap): void {
    for (const campfire of map.campfires) {
      const group = new THREE.Group();
      group.position.copy(v3(campfire));

      const logs = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.6, 0.3, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 1, flatShading: true }),
      );
      logs.position.y = 0.15;
      group.add(logs);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 1.1, 6),
        new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9 }),
      );
      flame.position.y = 0.82;
      flame.userData.flicker = true;
      group.add(flame);

      const light = new THREE.PointLight(0xff9a3c, 12, 14, 2);
      light.position.y = 1.2;
      group.add(light);

      group.add(this.makeLabel('모닥불', '#fdba74', 2.2));
      this.staticGroup.add(group);
    }
  }

  private buildPois(map: GeneratedMap): void {
    for (const poi of map.pois) {
      const group = new THREE.Group();
      group.position.copy(v3(poi.pos));

      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0xf59e0b,
          emissiveIntensity: 1.1,
          roughness: 0.3,
        }),
      );
      marker.position.y = 1.5;
      marker.userData.bob = true;
      group.add(marker);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 1.75, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
      );
      ring.position.y = 0.06;
      group.add(ring);

      group.add(this.makeLabel(poi.name, '#fde68a', 2.4));
      this.staticGroup.add(group);
    }
  }

  private buildNpcs(map: GeneratedMap): void {
    for (const npc of map.npcs) {
      const group = new THREE.Group();
      group.position.copy(v3(npc.pos));
      // NPC는 광장 중앙을 바라본다
      group.rotation.y = -Math.atan2(map.height / 2 - npc.pos.y, map.width / 2 - npc.pos.x);

      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.34, 0.72, 4, 10),
        new THREE.MeshStandardMaterial({ color: 0xdbe3ef, roughness: 0.85 }),
      );
      body.position.y = 0.85;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xf1d3b8, roughness: 0.9 }),
      );
      head.position.y = 1.55;
      group.add(head);

      group.add(this.shadowDisc(0.55));
      group.add(this.makeLabel(npc.name, '#fde68a', 2.2));

      // 말을 걸 수 있다는 표시
      const mark = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
      );
      mark.position.y = 2.0;
      mark.userData.bob = true;
      group.add(mark);

      this.staticGroup.add(group);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 라벨 (빌보드 스프라이트)                                             */
  /* ------------------------------------------------------------------ */

  private makeLabel(text: string, color: string, height: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const scale = 2;
    const font = `600 ${20 * scale}px "Pretendard", system-ui, sans-serif`;
    const measureCtx = canvas.getContext('2d') as CanvasRenderingContext2D;
    measureCtx.font = font;
    const width = Math.ceil(measureCtx.measureText(text).width) + 20 * scale;
    canvas.width = width;
    canvas.height = 32 * scale;

    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(6,10,20,0.72)';
    ctx.roundRect?.(0, 0, canvas.width, canvas.height, 8 * scale);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
    );
    // 라벨이 크면 3D 공간을 가린다. 읽히는 최소 크기로.
    const labelHeight = 0.26;
    sprite.scale.set((canvas.width / canvas.height) * labelHeight, labelHeight, 1);
    sprite.position.y = height;
    sprite.renderOrder = 10;
    return sprite;
  }

  private shadowDisc(radius: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    mesh.position.y = 0.02;
    return mesh;
  }

  /* ------------------------------------------------------------------ */
  /* 캐릭터                                                              */
  /* ------------------------------------------------------------------ */

  private buildPlayerRig(): void {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.74, 5, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f6fe0, roughness: 0.6, metalness: 0.15 }),
    );
    body.position.y = 0.87;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xf3d5bb, roughness: 0.9 }),
    );
    head.position.y = 1.58;
    group.add(head);

    // 어깨 망토 — 뒤에서 보이는 실루엣이 있어야 3인칭이 산다
    const cape = new THREE.Mesh(
      new THREE.ConeGeometry(0.44, 0.95, 8, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x1e3a8a,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    cape.position.set(-0.14, 1.05, 0);
    cape.rotation.z = 0.18;
    group.add(cape);

    // 무기 — +X가 정면이므로 오른쪽 앞에 든다
    const weapon = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.09, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xd7dee8, roughness: 0.35, metalness: 0.7 }),
    );
    weapon.position.set(0.55, 0.95, 0.34);
    group.add(weapon);

    // 가드 자세일 때만 보이는 방패
    const guard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.5, metalness: 0.4 }),
    );
    guard.rotation.z = Math.PI / 2;
    guard.position.set(0.55, 1.0, -0.2);
    guard.visible = false;
    group.add(guard);

    // 무적 프레임 표시
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.06, 8, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 }),
    );
    ring.position.y = 0.12;
    ring.visible = false;
    group.add(ring);

    group.add(this.shadowDisc(0.5));

    this.playerRig = group;
    this.playerParts = { body, head, weapon, guard, ring };
    this.scene.add(group);
  }

  private buildMonsterRig(monster: RenderSnapshot['monsters'][number]): THREE.Group {
    const group = new THREE.Group();
    const color =
      monster.isBoss ? 0xdc2626 : monster.kind === 'ELITE' ? 0xc026d3 : 0xc2701c;
    const radius = monster.radius;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius * 0.85, radius * 1.5, 4, 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true }),
    );
    body.position.y = radius * 1.45;
    body.name = 'body';
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.6, 10, 8),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.75),
        roughness: 0.9,
        flatShading: true,
      }),
    );
    head.position.y = radius * 2.55;
    group.add(head);

    // 눈 — 어느 쪽을 보는지 알아야 배후를 잡을 수 있다
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
    );
    eye.position.set(radius * 0.5, radius * 2.6, 0);
    group.add(eye);

    group.add(this.shadowDisc(radius * 1.1));

    const label = this.makeLabel(
      monster.isBoss || monster.kind === 'ELITE' ? `${monster.name} Lv${monster.level}` : monster.name,
      monster.isBoss ? '#fca5a5' : monster.kind === 'ELITE' ? '#e9d5ff' : '#e2e8f0',
      radius * 3.4 + 0.4,
    );
    label.name = 'label';
    group.add(label);

    // HP 바 — 빌보드 스프라이트
    const hpSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x4ade80, depthTest: false, transparent: true }),
    );
    hpSprite.name = 'hp';
    hpSprite.position.y = radius * 3.2;
    hpSprite.scale.set(1.2, 0.1, 1);
    hpSprite.renderOrder = 11;
    hpSprite.visible = false;
    group.add(hpSprite);

    const hpBack = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x111827, depthTest: false, transparent: true, opacity: 0.8 }),
    );
    hpBack.name = 'hpBack';
    hpBack.position.y = radius * 3.2;
    hpBack.scale.set(1.24, 0.13, 1);
    hpBack.renderOrder = 10;
    hpBack.visible = false;
    group.add(hpBack);

    this.scene.add(group);
    return group;
  }

  /* ------------------------------------------------------------------ */
  /* 프레임                                                              */
  /* ------------------------------------------------------------------ */

  render(snapshot: RenderSnapshot): void {
    if (this.disposed) return;
    if (!this.playerRig) this.buildPlayerRig();

    this.updatePlayer(snapshot);
    this.updateMonsters(snapshot);
    this.updateSlashes(snapshot);
    this.updateAnimatedProps(snapshot.nowMs);
    this.updateCamera(snapshot);
    this.updateSun(snapshot);

    this.renderer.render(this.scene, this.camera);
    this.updateOverlay(snapshot);
  }

  private updatePlayer(snapshot: RenderSnapshot): void {
    const rig = this.playerRig as THREE.Group;
    const parts = this.playerParts as NonNullable<Renderer3D['playerParts']>;
    const { player } = snapshot;

    rig.position.set(player.pos.x, 0, player.pos.y);
    // 메시는 +X가 정면이므로 조준 각도의 부호를 뒤집는다
    rig.rotation.y = -player.aim;
    rig.visible = player.alive;

    // 걸을 때 위아래로 살짝 흔든다 — 미끄러지듯 이동하면 3D가 어색하다
    const bob = player.moving ? Math.sin(snapshot.nowMs / 90) * 0.055 : 0;
    parts.body.position.y = 0.87 + bob;
    parts.head.position.y = 1.58 + bob;
    parts.weapon.position.y = 0.95 + bob;

    parts.guard.visible = player.guarding;
    parts.ring.visible = player.invulnerable;
    if (player.invulnerable) {
      parts.ring.rotation.z = snapshot.nowMs / 240;
    }
  }

  private updateMonsters(snapshot: RenderSnapshot): void {
    const seen = new Set<string>();

    for (const monster of snapshot.monsters) {
      seen.add(monster.id);
      let rig = this.monsterRigs.get(monster.id);
      if (!rig) {
        rig = this.buildMonsterRig(monster);
        this.monsterRigs.set(monster.id, rig);
      }

      rig.position.set(monster.pos.x, 0, monster.pos.y);
      rig.rotation.y = -monster.aim;
      rig.visible = true;

      const body = rig.getObjectByName('body') as THREE.Mesh | undefined;
      if (body) {
        const material = body.material as THREE.MeshStandardMaterial;
        // 그로기면 주황으로 달아오른다
        material.emissive = new THREE.Color(monster.groggy ? 0xf97316 : 0x000000);
        material.emissiveIntensity = monster.groggy ? 0.8 : 0;
      }

      const hp = rig.getObjectByName('hp') as THREE.Sprite | undefined;
      const hpBack = rig.getObjectByName('hpBack') as THREE.Sprite | undefined;
      const hurt = monster.hpRatio < 0.999;
      if (hp && hpBack) {
        hp.visible = hurt;
        hpBack.visible = hurt;
        if (hurt) {
          const full = monster.isBoss ? 2.0 : 1.2;
          hp.scale.set(full * monster.hpRatio, 0.1, 1);
          // 스프라이트는 중심 정렬이므로 줄어든 만큼 왼쪽으로 민다
          hp.center.set(0.5 / Math.max(monster.hpRatio, 0.001) - 0, 0.5);
          hp.center.set(0.5, 0.5);
          hp.position.x = -(full * (1 - monster.hpRatio)) / 2;
          hpBack.scale.set(full + 0.04, 0.13, 1);
          hpBack.position.x = 0;
          (hp.material as THREE.SpriteMaterial).color.set(monster.isBoss ? 0xf87171 : 0x4ade80);
        }
      }

      this.updateTelegraph(monster, snapshot.nowMs);
    }

    // 사라진 몬스터 정리
    for (const [id, rig] of this.monsterRigs) {
      if (seen.has(id)) continue;
      this.disposeGroup(rig);
      this.scene.remove(rig);
      this.monsterRigs.delete(id);
      const telegraph = this.telegraphMeshes.get(id);
      if (telegraph) {
        this.scene.remove(telegraph);
        this.disposeObject(telegraph);
        this.telegraphMeshes.delete(id);
      }
    }
  }

  /** 공격 예고 — 바닥에 붉은 부채꼴을 깐다 */
  private updateTelegraph(monster: RenderSnapshot['monsters'][number], nowMs: number): void {
    let mesh = this.telegraphMeshes.get(monster.id);

    if (monster.telegraph === null) {
      if (mesh) mesh.visible = false;
      return;
    }

    if (!mesh) {
      const half = (monster.attackAngle * Math.PI) / 180 / 2;
      const geometry = new THREE.CircleGeometry(monster.attackRange, 22, -half, half * 2);
      geometry.rotateX(-Math.PI / 2);
      mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: 0xef4444,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      );
      this.scene.add(mesh);
      this.telegraphMeshes.set(monster.id, mesh);
    }

    mesh.visible = true;
    mesh.position.set(monster.pos.x, 0.08, monster.pos.y);
    mesh.rotation.y = -monster.aim;
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.16 + monster.telegraph * 0.4;
    void nowMs;
  }

  /** 공격 궤적 */
  private updateSlashes(snapshot: RenderSnapshot): void {
    // 새로 들어온 것만 만든다 (age가 매우 작은 것)
    for (const slash of snapshot.slashes) {
      if (slash.age > 40) continue;
      const half = (slash.angle * Math.PI) / 180 / 2;
      const geometry = new THREE.RingGeometry(
        Math.max(0.2, slash.range * 0.25),
        slash.range,
        20,
        1,
        -half,
        half * 2,
      );
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: slash.hostile ? 0xf87171 : 0x93c5fd,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.set(slash.origin.x, 0.9, slash.origin.y);
      mesh.rotation.y = -slash.aim;
      this.scene.add(mesh);
      this.slashMeshes.push({ mesh, born: snapshot.nowMs, life: slash.life });
    }

    for (let i = this.slashMeshes.length - 1; i >= 0; i -= 1) {
      const entry = this.slashMeshes[i] as { mesh: THREE.Mesh; born: number; life: number };
      const age = snapshot.nowMs - entry.born;
      if (age > entry.life) {
        this.scene.remove(entry.mesh);
        this.disposeObject(entry.mesh);
        this.slashMeshes.splice(i, 1);
        continue;
      }
      const t = age / entry.life;
      (entry.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
      entry.mesh.scale.setScalar(1 + t * 0.18);
    }
  }

  private updateAnimatedProps(nowMs: number): void {
    this.staticGroup.traverse((object) => {
      if (object.userData.bob) {
        object.position.y = (object.userData.baseY ??= object.position.y) + Math.sin(nowMs / 420 + object.position.x) * 0.18;
        object.rotation.y = nowMs / 900;
      }
      if (object.userData.spin) {
        object.rotation.y = nowMs / 1400;
      }
      if (object.userData.flicker) {
        const s = 0.9 + Math.sin(nowMs / 90 + object.position.x * 3) * 0.14;
        object.scale.set(s, 1 / s, s);
      }
    });
  }

  private updateSun(snapshot: RenderSnapshot): void {
    // 태양을 플레이어 주변에 붙여 둔다 (그림자를 안 쓰므로 방향만 유지)
    const { player } = snapshot;
    this.sun.position.set(player.pos.x + 26, 44, player.pos.y + 18);
    this.sun.target.position.set(player.pos.x, 0, player.pos.y);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * 3인칭 카메라 — 플레이어 뒤에서 어깨 너머로 본다.
   * 지형에 파묻히지 않도록 앞에 장애물이 있으면 당겨 온다.
   */
  private updateCamera(snapshot: RenderSnapshot): void {
    const { player } = snapshot;
    const dir = new THREE.Vector3(Math.cos(player.aim), 0, Math.sin(player.aim));

    this.camTarget.set(player.pos.x, 1.45, player.pos.y);

    let distance = this.camDistance;
    const map = this.mapRef;
    if (map) {
      // 카메라가 들어갈 자리에 나무가 있으면 그만큼 당긴다
      for (const obstacle of map.obstacles) {
        if (obstacle.radius < 0.4) continue;
        const dx = player.pos.x - obstacle.pos.x;
        const dy = player.pos.y - obstacle.pos.y;
        const along = -(dx * dir.x + dy * dir.z);
        if (along <= 0 || along > distance) continue;
        const perp = Math.abs(dx * dir.z - dy * dir.x);
        if (perp < obstacle.radius + 0.6) distance = Math.min(distance, Math.max(2.6, along - 0.5));
      }
    }

    const back = Math.cos(this.camPitch) * distance;
    const up = Math.sin(this.camPitch) * distance;
    this.camPos.set(
      player.pos.x - dir.x * back,
      1.45 + up + 0.5,
      player.pos.y - dir.z * back,
    );
    // 바닥을 뚫지 않게
    this.camPos.y = Math.max(0.9, this.camPos.y);

    this.camera.position.lerp(this.camPos, 0.28);
    this.camera.lookAt(this.camTarget);
  }

  /* ------------------------------------------------------------------ */
  /* DOM 오버레이 — 데미지 숫자와 상호작용 안내                            */
  /* ------------------------------------------------------------------ */

  private updateOverlay(snapshot: RenderSnapshot): void {
    const parts: string[] = [];
    const projected = new THREE.Vector3();
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;

    for (const floater of snapshot.floaters) {
      const t = floater.age / floater.life;
      projected.set(floater.pos.x, 1.6 + t * 1.4, floater.pos.y).project(this.camera);
      if (projected.z > 1) continue;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      parts.push(
        `<span class="f3d" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;color:${floater.color};font-size:${floater.size}px;opacity:${(1 - t).toFixed(2)}">${floater.text}</span>`,
      );
    }

    if (snapshot.prompt) {
      parts.push(`<span class="prompt3d">[E] ${snapshot.prompt}</span>`);
    }

    this.overlay.innerHTML = parts.join('');
  }

  /* ------------------------------------------------------------------ */
  /* 정리                                                                */
  /* ------------------------------------------------------------------ */

  private disposeObject(object: THREE.Object3D): void {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose?.();
  }

  private disposeGroup(group: THREE.Object3D): void {
    group.traverse((object) => this.disposeObject(object));
    group.removeFromParent();
  }

  dispose(): void {
    this.disposed = true;
    this.disposeGroup(this.staticGroup);
    if (this.playerRig) this.disposeGroup(this.playerRig);
    for (const rig of this.monsterRigs.values()) this.disposeGroup(rig);
    this.monsterRigs.clear();
    for (const entry of this.slashMeshes) this.disposeObject(entry.mesh);
    this.slashMeshes.length = 0;
    for (const mesh of this.telegraphMeshes.values()) this.disposeObject(mesh);
    this.telegraphMeshes.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}
