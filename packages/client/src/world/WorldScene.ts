/**
 * 월드 씬 — 3인칭 오픈월드.
 *
 * 판정은 전부 @eternia/shared를 쓴다. 게임 로직은 2D 평면(x, y)에서 돌고,
 * Renderer3D가 그것을 (x, z)로 옮겨 3D로 그린다.
 * 렌더러를 2D에서 3D로 갈아끼우는 동안 전투·퀘스트 코드는 한 줄도 바뀌지 않았다 —
 * 기획서 2-2의 "판정은 서버가 한다"를 지키려고 로직과 렌더를 갈라 둔 덕이다.
 *
 * 기획서 1-2 ①: 레벨 제한으로 맵을 막지 않는다. 저렙도 고렙 맵에 갈 수 있다 — 죽을 뿐이다.
 */
import {
  Combatant,
  ITEMS,
  MONSTER_BY_ID,
  POI_BY_ID,
  RARITY_META,
  SKILL_BY_ID,
  hitPosition,
  levelFactor,
  partyExpShare,
  resolveHitbox,
  rollItem,
  skillsForClass,
  type HitResult,
  type HitTarget,
  type ItemInstance,
  type MonsterDef,
  type SkillDef,
} from '@eternia/shared';
import { Renderer3D, type RenderSnapshot } from './Renderer3D.js';
import { arrivalPoint, generateMap, type GeneratedMap, type Vec2 } from './mapgen.js';
import {
  POTION_HEAL,
  addItem,
  consumePotion,
  derivedStats,
  gainExp,
  potionCount,
  type PlayerState,
} from './player.js';

const TICK_MS = 1000 / 30;

/** 몬스터가 플레이어를 알아채는 거리 */
const AGGRO_RANGE = 7.5;
const AGGRO_RANGE_BOSS = 11;
/** 이 거리를 넘어가면 집으로 돌아간다 */
const LEASH_RANGE = 22;
const RESPAWN_MS = 22_000;
/** 비전투 자연 회복 — 이게 없으면 한 번 다친 뒤로는 계속 불리하다 */
const REGEN_DELAY_MS = 5_000;
const REGEN_PER_SEC = 0.045;

/** 마우스 감도 (라디안/픽셀) */
const LOOK_SENSITIVITY = 0.0032;
/** 방향키 시점 회전 속도 (라디안/초) — 마우스 잠금이 막힌 환경의 대비책 */
const ARROW_LOOK_SPEED = 2.4;

export type ToastKind = 'INFO' | 'LOOT' | 'LEVEL' | 'DANGER' | 'QUEST';

export interface WorldCallbacks {
  onToast(text: string, kind: ToastKind): void;
  onKill(monsterId: string, monsterName: string): void;
  onLoot(instance: ItemInstance): void;
  onLevelUp(level: number, needsClassChoice: boolean): void;
  onEnterMap(mapId: string): void;
  onInteractNpc(npcId: string): void;
  onInteractPoi(poiId: string, name: string): void;
  onPotionUsed(remaining: number): void;
  onPlayerDeath(): void;
  onStateChanged(): void;
  /** 마우스 잠금 상태가 바뀌었다 — UI가 안내를 띄운다 */
  onPointerLockChange(locked: boolean): void;
}

interface MonsterEntity {
  def: MonsterDef;
  combatant: Combatant;
  home: Vec2;
  state: 'IDLE' | 'CHASE' | 'ATTACK' | 'RETURN' | 'DEAD';
  telegraphAt: number;
  attackAt: number;
  respawnAt: number;
  isBoss: boolean;
  wanderTarget: Vec2 | null;
  nextWanderAt: number;
}

interface FloatingText {
  text: string;
  pos: Vec2;
  bornAt: number;
  color: string;
  size: number;
}

interface Slash {
  origin: Vec2;
  aim: number;
  range: number;
  angle: number;
  bornAt: number;
  hostile: boolean;
}

export interface HotbarSlot {
  key: string;
  skill: SkillDef;
}

export class WorldScene {
  private readonly renderer: Renderer3D;
  private readonly cb: WorldCallbacks;

  player: PlayerState;
  map!: GeneratedMap;
  private hero!: Combatant;
  private monsters: MonsterEntity[] = [];

  private now = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private running = false;
  private rafId = 0;
  private paused = false;

  private readonly keys = new Set<string>();
  private pendingSkill: SkillDef | null = null;
  private pendingDodge = false;
  private pendingInteract = false;
  private pendingPotion = false;
  private activeSkill: SkillDef | null = null;
  private lastDamagedAt = -Infinity;
  private moving = false;

  private readonly floaters: FloatingText[] = [];
  private readonly slashes: Slash[] = [];

  /** 마우스 잠금 상태 */
  pointerLocked = false;

  /** 지금 상호작용할 수 있는 대상 */
  nearby: { kind: 'NPC' | 'PORTAL' | 'CAMPFIRE' | 'POI'; id: string; label: string } | null = null;

  hotbar: HotbarSlot[] = [];
  private basicAttack!: SkillDef;

  private readonly listeners: (() => void)[] = [];

  constructor(container: HTMLElement, player: PlayerState, callbacks: WorldCallbacks) {
    this.player = player;
    this.cb = callbacks;
    this.renderer = new Renderer3D(container);

    this.basicAttack = SKILL_BY_ID.get('sk_sw_slash') as SkillDef;
    this.loadMap(player.mapId, null);
    this.rebuildHero(false);
    this.bindInput();
  }

  /* ------------------------------------------------------------------ */
  /* 캐릭터                                                              */
  /* ------------------------------------------------------------------ */

  rebuildHero(keepPosition = true): void {
    const stats = derivedStats(this.player);
    const previous = this.hero;

    this.hero = new Combatant({
      id: 'player',
      name: this.player.nickname,
      level: this.player.level,
      maxHp: stats.maxHp,
      maxMp: stats.maxMp,
      atk: stats.atk,
      def: stats.def,
      critRate: stats.critRate,
      critDmgBonus: stats.critDmg,
      radius: 0.5,
      moveSpeed: stats.moveSpeed,
      parryWindowMs: 250,
      faction: 'PLAYER',
    });

    if (previous && keepPosition) {
      this.hero.pos = { ...previous.pos };
      this.hero.aim = previous.aim;
      this.hero.hp = Math.min(stats.maxHp, previous.hp > 0 ? previous.hp : stats.maxHp);
      this.hero.mp = Math.min(stats.maxMp, previous.mp);
    } else {
      this.hero.pos = { ...this.map.entry };
      this.hero.hp = this.player.hp > 0 ? Math.min(stats.maxHp, this.player.hp) : stats.maxHp;
      this.hero.mp = this.player.mp > 0 ? Math.min(stats.maxMp, this.player.mp) : stats.maxMp;
    }

    this.rebuildHotbar();
  }

  private rebuildHotbar(): void {
    const keys = ['Q', 'R', 'F'];
    const classId = this.player.classId;
    if (!classId) {
      this.hotbar = [];
      this.basicAttack = SKILL_BY_ID.get('sk_sw_slash') as SkillDef;
      return;
    }
    const skills = skillsForClass(classId).filter((s) => s.kind !== 'PASSIVE');
    const basic = skills.find((s) => s.cooldownMs === 0 && s.kind === 'ACTIVE');
    this.basicAttack = basic ?? (SKILL_BY_ID.get('sk_sw_slash') as SkillDef);
    // 히트박스가 없는 스킬(버프·소환)은 아직 효과를 구현하지 않았으므로 핫바에서 뺀다
    this.hotbar = skills
      .filter((s) => s.id !== this.basicAttack.id && s.hitbox !== null)
      .slice(0, 3)
      .map((skill, index) => ({ key: keys[index] as string, skill }));
  }

  get heroCombatant(): Combatant {
    return this.hero;
  }

  /* ------------------------------------------------------------------ */
  /* 맵                                                                  */
  /* ------------------------------------------------------------------ */

  loadMap(mapId: string, fromMapId: string | null): void {
    this.map = generateMap(mapId);
    this.player.mapId = mapId;
    if (!this.player.visitedMaps.includes(mapId)) this.player.visitedMaps.push(mapId);

    this.monsters = this.map.spawns.map((spawn) =>
      this.spawnMonster(spawn.monsterId, spawn.pos, spawn.isBoss),
    );
    this.floaters.length = 0;
    this.slashes.length = 0;

    if (this.hero) {
      this.hero.pos = arrivalPoint(this.map, fromMapId);
      this.hero.action.interrupt();
    }
    this.renderer.setMap(this.map);
    this.cb.onEnterMap(mapId);
  }

  private spawnMonster(monsterId: string, pos: Vec2, isBoss: boolean): MonsterEntity {
    const def = MONSTER_BY_ID.get(monsterId) as MonsterDef;
    const combatant = new Combatant({
      id: `${monsterId}_${pos.x.toFixed(1)}_${pos.y.toFixed(1)}`,
      name: def.name,
      level: def.level,
      maxHp: def.hp,
      maxMp: 0,
      atk: def.atk,
      def: def.def,
      critRate: 0.05,
      critDmgBonus: 0,
      radius: isBoss ? 1.3 : def.kind === 'ELITE' ? 0.8 : 0.6,
      moveSpeed: isBoss ? 2.6 : def.kind === 'ELITE' ? 3.0 : 3.4,
      parryWindowMs: 0,
      faction: 'ENEMY',
    });
    combatant.pos = { ...pos };
    return {
      def,
      combatant,
      home: { ...pos },
      state: 'IDLE',
      telegraphAt: -1,
      attackAt: -1,
      respawnAt: 0,
      isBoss,
      wanderTarget: null,
      nextWanderAt: 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 입력 — 3인칭 마우스 룩                                               */
  /* ------------------------------------------------------------------ */

  private bindInput(): void {
    const canvas = this.renderer.canvas;

    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        [' ', 'w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '1',
         'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)
      ) {
        e.preventDefault();
      }
      if (this.keys.has(key)) return;
      this.keys.add(key);
      if (this.paused) return;

      if (key === ' ') this.pendingDodge = true;
      if (key === 'e') this.pendingInteract = true;
      if (key === '1') this.pendingPotion = true;

      const slot = this.hotbar.find((s) => s.key.toLowerCase() === key);
      if (slot) this.pendingSkill = slot.skill;
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.listeners.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });

    // 마우스 잠금 — 3인칭에서 커서가 화면을 벗어나면 시점을 못 돌린다
    const requestLock = () => {
      if (this.paused) return;
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
    };
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) this.keys.clear();
      this.cb.onPointerLockChange(this.pointerLocked);
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.listeners.push(() => document.removeEventListener('pointerlockchange', onLockChange));

    const onMouseMove = (e: MouseEvent) => {
      if (!this.pointerLocked || this.paused) return;
      this.hero.aim += e.movementX * LOOK_SENSITIVITY;
      this.renderer.camPitch = Math.max(
        -0.35,
        Math.min(0.95, this.renderer.camPitch + e.movementY * LOOK_SENSITIVITY * 0.7),
      );
    };
    document.addEventListener('mousemove', onMouseMove);
    this.listeners.push(() => document.removeEventListener('mousemove', onMouseMove));

    const onMouseDown = (e: MouseEvent) => {
      if (this.paused) return;
      if (!this.pointerLocked) {
        requestLock();
        return;
      }
      e.preventDefault();
      if (e.button === 0) this.pendingSkill = this.basicAttack;
      if (e.button === 2) this.hero.startGuard(this.now);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) this.hero.stopGuard(this.now);
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    this.listeners.push(() => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    });

    const onWheel = (e: WheelEvent) => {
      if (!this.pointerLocked) return;
      e.preventDefault();
      this.renderer.camDistance = Math.max(
        3.2,
        Math.min(12, this.renderer.camDistance + e.deltaY * 0.006),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this.listeners.push(() => canvas.removeEventListener('wheel', onWheel));

    const onResize = () => this.renderer.resize();
    window.addEventListener('resize', onResize);
    this.listeners.push(() => window.removeEventListener('resize', onResize));
  }

  /** UI 패널이 열리면 마우스를 풀어 준다 */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      if (document.pointerLockElement === this.renderer.canvas) document.exitPointerLock?.();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 루프                                                                */
  /* ------------------------------------------------------------------ */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (timestamp: number) => {
      if (!this.running) return;
      const delta = Math.min(120, timestamp - this.lastFrame);
      this.lastFrame = timestamp;
      if (!this.paused) {
        this.accumulator += delta;
        this.player.playtimeMs += delta;
        while (this.accumulator >= TICK_MS) {
          this.tick(TICK_MS);
          this.accumulator -= TICK_MS;
        }
      }
      this.renderer.render(this.snapshot());
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.renderer.dispose();
  }

  private tick(dt: number): void {
    this.now += dt;

    this.updateArrowLook(dt);

    if (this.hero.alive) {
      this.updateMovement(dt);
      this.updateActions();
    }

    const snapshot = this.hero.update(dt, this.now);
    if (snapshot.activeStarted && this.activeSkill) {
      this.resolvePlayerHit(this.activeSkill, snapshot.comboIndex);
      this.activeSkill = null;
    }

    this.updateMonsters(dt);
    this.updateNearby();
    this.updatePotion();
    this.updateRegen(dt);
    this.syncPlayerState();
  }

  /**
   * 방향키로도 시점을 돌릴 수 있게 한다.
   * 브라우저나 정책 때문에 마우스 잠금이 거부될 수 있는데,
   * 그때 시점을 못 돌리면 게임 자체가 안 굴러간다.
   */
  private updateArrowLook(dt: number): void {
    const step = (ARROW_LOOK_SPEED * dt) / 1000;
    if (this.keys.has('arrowleft')) this.hero.aim -= step;
    if (this.keys.has('arrowright')) this.hero.aim += step;
    if (this.keys.has('arrowup')) {
      this.renderer.camPitch = Math.max(-0.35, this.renderer.camPitch - step * 0.5);
    }
    if (this.keys.has('arrowdown')) {
      this.renderer.camPitch = Math.min(0.95, this.renderer.camPitch + step * 0.5);
    }
  }

  /** WASD는 카메라 기준이다 — 3인칭에서 절대 방향 이동은 조작이 안 된다 */
  private inputDirection(): Vec2 | null {
    const forward = { x: Math.cos(this.hero.aim), y: Math.sin(this.hero.aim) };
    const right = { x: -Math.sin(this.hero.aim), y: Math.cos(this.hero.aim) };
    const dir = { x: 0, y: 0 };
    if (this.keys.has('w')) {
      dir.x += forward.x;
      dir.y += forward.y;
    }
    if (this.keys.has('s')) {
      dir.x -= forward.x;
      dir.y -= forward.y;
    }
    if (this.keys.has('d')) {
      dir.x += right.x;
      dir.y += right.y;
    }
    if (this.keys.has('a')) {
      dir.x -= right.x;
      dir.y -= right.y;
    }
    return dir.x === 0 && dir.y === 0 ? null : dir;
  }

  private updateMovement(dt: number): void {
    const dir = this.inputDirection();
    this.moving = dir !== null;

    if (dir) {
      const before = { ...this.hero.pos };
      this.hero.move(dir, dt);
      this.resolveTerrain(this.hero, before);
    }

    if (this.pendingDodge) {
      this.pendingDodge = false;
      // 입력 방향으로 구른다. 입력이 없으면 뒤로 물러난다.
      const heading = dir ? Math.atan2(dir.y, dir.x) : this.hero.aim + Math.PI;
      const before = { ...this.hero.pos };
      if (this.hero.tryDodge(this.now, heading)) {
        this.resolveTerrain(this.hero, before);
        this.spawnFloater('회피', this.hero.pos, '#7dd3fc', 12);
      }
    }
  }

  private updateActions(): void {
    if (!this.pendingSkill) return;
    const skill = this.pendingSkill;
    this.pendingSkill = null;
    if (this.hero.useSkill(skill, this.now) !== null) this.activeSkill = skill;
  }

  private updatePotion(): void {
    if (!this.pendingPotion) return;
    this.pendingPotion = false;
    if (!this.hero.alive) return;
    if (this.hero.hp >= this.hero.maxHp) {
      this.cb.onToast('이미 체력이 가득합니다', 'INFO');
      return;
    }
    if (!consumePotion(this.player)) {
      this.cb.onToast('물약이 없습니다', 'DANGER');
      return;
    }
    const healed = this.hero.heal(POTION_HEAL);
    this.spawnFloater(`+${Math.round(healed)}`, this.hero.pos, '#4ade80', 16);
    this.cb.onPotionUsed(potionCount(this.player));
    this.cb.onStateChanged();
  }

  private updateRegen(dt: number): void {
    if (!this.hero.alive) return;
    if (this.now - this.lastDamagedAt < REGEN_DELAY_MS) return;
    if (this.hero.hp >= this.hero.maxHp) return;
    this.hero.heal((this.hero.maxHp * REGEN_PER_SEC * dt) / 1000);
  }

  /* ------------------------------------------------------------------ */
  /* 지형 충돌                                                            */
  /* ------------------------------------------------------------------ */

  private resolveTerrain(entity: Combatant, previous: Vec2): void {
    const r = entity.opts.radius;
    entity.pos.x = Math.max(r, Math.min(this.map.width - r, entity.pos.x));
    entity.pos.y = Math.max(r, Math.min(this.map.height - r, entity.pos.y));

    for (const obstacle of this.map.obstacles) {
      const dx = entity.pos.x - obstacle.pos.x;
      const dy = entity.pos.y - obstacle.pos.y;
      const min = obstacle.radius + r;
      const distance = Math.hypot(dx, dy);
      if (distance >= min) continue;
      if (distance < 1e-4) {
        entity.pos = { ...previous };
        return;
      }
      entity.pos = {
        x: obstacle.pos.x + (dx / distance) * min,
        y: obstacle.pos.y + (dy / distance) * min,
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* 전투                                                                */
  /* ------------------------------------------------------------------ */

  private livingMonsters(): MonsterEntity[] {
    return this.monsters.filter((m) => m.state !== 'DEAD' && m.combatant.alive);
  }

  private resolvePlayerHit(skill: SkillDef, comboIndex: number): void {
    const box = skill.hitbox;
    if (!box) return;

    if (box.type === 'SECTOR') {
      this.slashes.push({
        origin: { ...this.hero.pos },
        aim: this.hero.aim,
        range: box.range,
        angle: box.angle,
        bornAt: this.now,
        hostile: false,
      });
    }

    const targets: HitTarget[] = this.livingMonsters().map((m) => m.combatant.asTarget(this.now));
    // 투사체는 서버가 소유해야 하지만(기획서 6-3-6), 싱글 데모에서는
    // 즉시 판정되는 직선으로 근사한다. 서버가 붙으면 Projectile로 교체한다.
    const effective =
      box.type === 'PROJECTILE'
        ? ({
            type: 'LINE',
            length: box.maxDistance,
            width: box.radius * 4,
            pierce: box.pierce ?? 1,
          } as const)
        : box;

    const hits = resolveHitbox({ pos: this.hero.pos, aim: this.hero.aim }, effective, targets);
    for (const hit of hits) {
      const monster = this.livingMonsters().find((m) => m.combatant.id === hit.targetId);
      if (monster) this.damageMonster(monster, skill, hit, comboIndex);
    }
  }

  private damageMonster(
    monster: MonsterEntity,
    skill: SkillDef,
    hit: HitResult,
    comboIndex: number,
  ): void {
    const isCrit = Math.random() < this.hero.opts.critRate;
    const outcome = monster.combatant.takeHit({
      attackerId: this.hero.id,
      attackerLevel: this.player.level,
      attackerAtk: this.hero.opts.atk,
      skillCoef: skill.coef.pve,
      comboIndex,
      poiseDamage: skill.poiseDamage,
      position: hit.position,
      isCrit,
      critDmgBonus: this.hero.opts.critDmgBonus,
      elementMultiplier: 1,
      contextCoef: 1,
      roll: Math.random(),
      hitTimeMs: this.now,
    });

    const label = hit.position === 'BACK' ? `${outcome.damage} 배후!` : `${outcome.damage}`;
    this.spawnFloater(
      label,
      monster.combatant.pos,
      isCrit ? '#fbbf24' : monster.combatant.poise.isGroggy(this.now) ? '#fca5a5' : '#f1f5f9',
      isCrit ? 20 : 15,
    );

    if (outcome.groggyBroke) this.spawnFloater('자세 붕괴!', monster.combatant.pos, '#f97316', 19);
    if (monster.state === 'IDLE' || monster.state === 'RETURN') monster.state = 'CHASE';
    if (outcome.verdict === 'DEAD') this.killMonster(monster);
  }

  private killMonster(monster: MonsterEntity): void {
    monster.state = 'DEAD';
    monster.respawnAt = this.now + RESPAWN_MS * (monster.isBoss ? 4 : 1);

    const factor = levelFactor(this.player.level, monster.def.level);
    const exp = Math.max(1, Math.round(partyExpShare(monster.def.exp, 1) * factor));
    const [goldLow, goldHigh] = monster.def.gold;
    const gold = Math.round(goldLow + Math.random() * (goldHigh - goldLow));

    this.player.gold += gold;
    this.player.kills[monster.def.id] = (this.player.kills[monster.def.id] ?? 0) + 1;

    const result = gainExp(this.player, exp);
    this.spawnFloater(`+${exp} EXP`, monster.combatant.pos, '#a3e635', 13);
    this.spawnFloater(`+${gold} G`, monster.combatant.pos, '#fbbf24', 12);

    this.cb.onKill(monster.def.id, monster.def.name);

    if (result.levelsGained > 0) {
      this.rebuildHero();
      this.hero.hp = this.hero.maxHp;
      this.spawnFloater(`레벨 업! ${result.newLevel}`, this.hero.pos, '#facc15', 22);
      this.cb.onLevelUp(result.newLevel, result.needsClassChoice);
    }

    this.rollLoot(monster);
    this.cb.onStateChanged();
  }

  private rollLoot(monster: MonsterEntity): void {
    const chance = monster.isBoss ? 1 : monster.def.kind === 'ELITE' ? 0.55 : 0.18;
    if (Math.random() > chance) return;

    const level = monster.def.level;
    const pool = ITEMS.filter(
      (item) =>
        item.levelReq <= level + 2 &&
        item.levelReq >= Math.max(1, level - 14) &&
        item.affixPool !== 'pool_consumable' &&
        item.affixPool !== 'pool_material',
    );
    if (pool.length === 0) return;

    const filtered = monster.isBoss
      ? pool.filter((i) => i.rarity !== 'COMMON' && i.rarity !== 'UNCOMMON')
      : pool;
    const candidates = filtered.length > 0 ? filtered : pool;
    const def = candidates[Math.floor(Math.random() * candidates.length)];
    if (!def) return;

    const instance = rollItem(
      def,
      Math.random,
      `it_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`,
    );
    if (!addItem(this.player, instance)) {
      this.cb.onToast('가방이 가득 찼습니다', 'DANGER');
      return;
    }

    this.spawnFloater(def.name, monster.combatant.pos, RARITY_META[def.rarity].color, 15);
    this.cb.onLoot(instance);
  }

  /* ------------------------------------------------------------------ */
  /* 몬스터 AI                                                            */
  /* ------------------------------------------------------------------ */

  private updateMonsters(dt: number): void {
    for (const monster of this.monsters) {
      if (monster.state === 'DEAD') {
        if (this.now >= monster.respawnAt) {
          monster.combatant.reset();
          monster.combatant.pos = { ...monster.home };
          monster.state = 'IDLE';
        }
        continue;
      }

      const mob = monster.combatant;
      mob.update(dt, this.now);
      if (!mob.alive) continue;

      const toPlayer = { x: this.hero.pos.x - mob.pos.x, y: this.hero.pos.y - mob.pos.y };
      const distance = Math.hypot(toPlayer.x, toPlayer.y);
      const aggro = monster.isBoss ? AGGRO_RANGE_BOSS : AGGRO_RANGE;
      const homeDistance = Math.hypot(mob.pos.x - monster.home.x, mob.pos.y - monster.home.y);

      if (mob.poise.isGroggy(this.now)) continue;

      switch (monster.state) {
        case 'IDLE': {
          if (this.hero.alive && distance < aggro) {
            monster.state = 'CHASE';
            break;
          }
          this.wander(monster, dt);
          break;
        }
        case 'CHASE': {
          if (!this.hero.alive || homeDistance > LEASH_RANGE) {
            monster.state = 'RETURN';
            break;
          }
          mob.aim = Math.atan2(toPlayer.y, toPlayer.x);
          const reach = mob.opts.radius + this.hero.opts.radius + 1.1;
          if (distance <= reach) {
            monster.state = 'ATTACK';
            monster.telegraphAt = this.now;
            monster.attackAt = this.now + (monster.isBoss ? 800 : 620);
          } else {
            const before = { ...mob.pos };
            mob.move(toPlayer, dt);
            this.resolveTerrain(mob, before);
            this.separateFromOthers(monster);
          }
          break;
        }
        case 'ATTACK': {
          mob.aim = Math.atan2(toPlayer.y, toPlayer.x);
          if (this.now >= monster.attackAt) {
            this.monsterAttack(monster);
            monster.state = 'CHASE';
            monster.telegraphAt = -1;
          }
          break;
        }
        case 'RETURN': {
          if (homeDistance < 0.6) {
            monster.state = 'IDLE';
            mob.hp = mob.maxHp;
            break;
          }
          const before = { ...mob.pos };
          mob.move({ x: monster.home.x - mob.pos.x, y: monster.home.y - mob.pos.y }, dt);
          this.resolveTerrain(mob, before);
          break;
        }
        default:
          break;
      }
    }
  }

  private wander(monster: MonsterEntity, dt: number): void {
    if (!monster.wanderTarget || this.now >= monster.nextWanderAt) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1 + Math.random() * 4;
      monster.wanderTarget = {
        x: monster.home.x + Math.cos(angle) * radius,
        y: monster.home.y + Math.sin(angle) * radius,
      };
      monster.nextWanderAt = this.now + 2500 + Math.random() * 3000;
    }
    const target = monster.wanderTarget;
    const dx = target.x - monster.combatant.pos.x;
    const dy = target.y - monster.combatant.pos.y;
    if (Math.hypot(dx, dy) < 0.4) return;
    const before = { ...monster.combatant.pos };
    monster.combatant.aim = Math.atan2(dy, dx);
    monster.combatant.move({ x: dx, y: dy }, dt * 0.45);
    this.resolveTerrain(monster.combatant, before);
  }

  private separateFromOthers(monster: MonsterEntity): void {
    for (const other of this.monsters) {
      if (other === monster || other.state === 'DEAD') continue;
      const dx = monster.combatant.pos.x - other.combatant.pos.x;
      const dy = monster.combatant.pos.y - other.combatant.pos.y;
      const min = monster.combatant.opts.radius + other.combatant.opts.radius;
      const distance = Math.hypot(dx, dy);
      if (distance >= min || distance < 1e-4) continue;
      const push = (min - distance) / 2;
      monster.combatant.pos.x += (dx / distance) * push;
      monster.combatant.pos.y += (dy / distance) * push;
    }
  }

  private monsterAttack(monster: MonsterEntity): void {
    const mob = monster.combatant;
    const range = mob.opts.radius + 2.2;
    const box = { type: 'SECTOR', range, angle: monster.isBoss ? 140 : 100 } as const;

    this.slashes.push({
      origin: { ...mob.pos },
      aim: mob.aim,
      range,
      angle: box.angle,
      bornAt: this.now,
      hostile: true,
    });

    if (!this.hero.alive) return;
    const hits = resolveHitbox({ pos: mob.pos, aim: mob.aim }, box, [this.hero.asTarget(this.now)]);
    if (hits.length === 0) {
      if (this.hero.stamina.wasInvulnerableAt(this.now)) {
        this.spawnFloater('무적!', this.hero.pos, '#38bdf8', 15);
      }
      return;
    }

    this.lastDamagedAt = this.now;
    const outcome = this.hero.takeHit({
      attackerId: mob.id,
      attackerLevel: monster.def.level,
      attackerAtk: mob.opts.atk,
      skillCoef: monster.isBoss ? 1.3 : 0.8,
      comboIndex: 0,
      poiseDamage: monster.isBoss ? 40 : 18,
      position: hitPosition(mob.pos, this.hero.asTarget(this.now)),
      isCrit: false,
      critDmgBonus: 0,
      elementMultiplier: 1,
      contextCoef: 1,
      roll: Math.random(),
      hitTimeMs: this.now,
    });

    switch (outcome.verdict) {
      case 'PARRIED':
        mob.sufferParry(this.now);
        this.spawnFloater('패리!', this.hero.pos, '#facc15', 22);
        break;
      case 'IFRAME':
        this.spawnFloater('무적!', this.hero.pos, '#38bdf8', 15);
        break;
      case 'BLOCKED':
        this.spawnFloater(`막음 ${outcome.damage}`, this.hero.pos, '#94a3b8', 14);
        break;
      case 'GUARD_BROKEN':
        this.spawnFloater('가드 브레이크!', this.hero.pos, '#ef4444', 19);
        break;
      case 'DEAD':
        this.spawnFloater('사망', this.hero.pos, '#ef4444', 22);
        this.onDeath();
        break;
      default:
        this.spawnFloater(`-${outcome.damage}`, this.hero.pos, '#fca5a5', 15);
    }
  }

  private onDeath(): void {
    const lost = Math.floor(this.player.gold * 0.05);
    this.player.gold -= lost;
    this.cb.onToast(`쓰러졌습니다. 골드 ${lost}를 잃었습니다.`, 'DANGER');
    this.cb.onPlayerDeath();
  }

  respawn(): void {
    this.hero.reset();
    this.hero.hp = this.hero.maxHp;
    const campfire = this.map.campfires[0];
    this.hero.pos = campfire ? { ...campfire } : { ...this.map.entry };
    this.hero.stamina.grantInvulnerability(this.now, 3000);
    this.lastDamagedAt = -Infinity;
    this.cb.onToast('부활했습니다 (3초간 무적)', 'INFO');
    this.cb.onStateChanged();
  }

  /* ------------------------------------------------------------------ */
  /* 상호작용                                                             */
  /* ------------------------------------------------------------------ */

  private updateNearby(): void {
    const pos = this.hero.pos;
    let found: WorldScene['nearby'] = null;
    let best = Infinity;

    for (const npc of this.map.npcs) {
      const distance = Math.hypot(npc.pos.x - pos.x, npc.pos.y - pos.y);
      if (distance < 2.6 && distance < best) {
        best = distance;
        found = { kind: 'NPC', id: npc.id, label: npc.name };
      }
    }
    for (const portal of this.map.portals) {
      const distance = Math.hypot(portal.pos.x - pos.x, portal.pos.y - pos.y);
      if (distance < portal.radius + 1.0 && distance < best) {
        best = distance;
        found = { kind: 'PORTAL', id: portal.to, label: `${portal.toName}(으)로 이동` };
      }
    }
    for (const campfire of this.map.campfires) {
      const distance = Math.hypot(campfire.x - pos.x, campfire.y - pos.y);
      if (distance < 2.4 && distance < best) {
        best = distance;
        found = { kind: 'CAMPFIRE', id: 'campfire', label: '모닥불에서 휴식' };
      }
    }
    for (const poi of this.map.pois) {
      const distance = Math.hypot(poi.pos.x - pos.x, poi.pos.y - pos.y);
      if (distance < 2.6 && distance < best) {
        best = distance;
        found = { kind: 'POI', id: poi.id, label: `${poi.name} 조사` };
      }
    }

    this.nearby = found;

    if (this.pendingInteract) {
      this.pendingInteract = false;
      this.interact();
    }
  }

  private interact(): void {
    const target = this.nearby;
    if (!target) return;
    if (target.kind === 'PORTAL') {
      const from = this.player.mapId;
      this.loadMap(target.id, from);
      this.cb.onStateChanged();
      return;
    }
    if (target.kind === 'CAMPFIRE') {
      this.hero.hp = this.hero.maxHp;
      this.hero.mp = this.hero.opts.maxMp;
      this.hero.stamina.refill();
      this.spawnFloater('회복', this.hero.pos, '#4ade80', 17);
      this.cb.onToast('모닥불에서 쉬었습니다. 체력이 모두 찼습니다.', 'INFO');
      this.cb.onStateChanged();
      return;
    }
    if (target.kind === 'POI') {
      const poi = POI_BY_ID.get(target.id);
      this.spawnFloater('조사 완료', this.hero.pos, '#fde68a', 15);
      this.cb.onInteractPoi(target.id, poi?.name ?? target.id);
      return;
    }
    this.cb.onInteractNpc(target.id);
  }

  travelTo(mapId: string): boolean {
    if (!this.player.visitedMaps.includes(mapId)) return false;
    const from = this.player.mapId;
    this.loadMap(mapId, from);
    this.cb.onStateChanged();
    return true;
  }

  private syncPlayerState(): void {
    this.player.hp = this.hero.hp;
    this.player.mp = this.hero.mp;
  }

  private spawnFloater(text: string, pos: Vec2, color: string, size: number): void {
    this.floaters.push({
      text,
      pos: { x: pos.x + (Math.random() - 0.5) * 0.5, y: pos.y + (Math.random() - 0.5) * 0.5 },
      bornAt: this.now,
      color,
      size,
    });
    if (this.floaters.length > 40) this.floaters.shift();
  }

  /* ------------------------------------------------------------------ */
  /* 렌더러에 넘길 스냅샷                                                  */
  /* ------------------------------------------------------------------ */

  private snapshot(): RenderSnapshot {
    for (let i = this.floaters.length - 1; i >= 0; i -= 1) {
      if (this.now - (this.floaters[i] as FloatingText).bornAt > 1100) this.floaters.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i -= 1) {
      if (this.now - (this.slashes[i] as Slash).bornAt > 400) this.slashes.splice(i, 1);
    }

    return {
      nowMs: this.now,
      player: {
        pos: this.hero.pos,
        aim: this.hero.aim,
        radius: this.hero.opts.radius,
        alive: this.hero.alive,
        guarding: this.hero.guard.isGuarding,
        invulnerable: this.hero.stamina.wasInvulnerableAt(this.now),
        moving: this.moving,
        nickname: this.player.nickname,
        level: this.player.level,
        hpRatio: this.hero.hpRatio,
      },
      monsters: this.monsters
        .filter((m) => m.state !== 'DEAD')
        .map((m) => ({
          id: m.combatant.id,
          pos: m.combatant.pos,
          aim: m.combatant.aim,
          radius: m.combatant.opts.radius,
          hpRatio: m.combatant.hpRatio,
          name: m.def.name,
          level: m.def.level,
          kind: m.def.kind,
          isBoss: m.isBoss,
          groggy: m.combatant.poise.isGroggy(this.now),
          telegraph:
            m.state === 'ATTACK' && m.telegraphAt >= 0
              ? Math.min(1, (this.now - m.telegraphAt) / Math.max(1, m.attackAt - m.telegraphAt))
              : null,
          attackRange: m.combatant.opts.radius + 2.2,
          attackAngle: m.isBoss ? 140 : 100,
        })),
      slashes: this.slashes.map((s) => ({
        origin: s.origin,
        aim: s.aim,
        range: s.range,
        angle: s.angle,
        age: this.now - s.bornAt,
        life: s.hostile ? 340 : 240,
        hostile: s.hostile,
      })),
      floaters: this.floaters.map((f) => ({
        text: f.text,
        pos: f.pos,
        age: this.now - f.bornAt,
        life: 1100,
        color: f.color,
        size: f.size,
      })),
      prompt: this.nearby?.label ?? null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* HUD가 읽는 값                                                        */
  /* ------------------------------------------------------------------ */

  hud() {
    return {
      hp: this.hero.hp,
      maxHp: this.hero.maxHp,
      mp: this.hero.mp,
      maxMp: this.hero.opts.maxMp,
      stamina: this.hero.stamina.value,
      maxStamina: this.hero.stamina.max,
      alive: this.hero.alive,
      pos: { ...this.hero.pos },
      aim: this.hero.aim,
      pois: this.map.pois.map((p) => ({ pos: { ...p.pos } })),
      monsters: this.monsters
        .filter((m) => m.state !== 'DEAD')
        .map((m) => ({ pos: { ...m.combatant.pos }, boss: m.isBoss })),
      cooldowns: this.hotbar.map((slot) => ({
        key: slot.key,
        name: slot.skill.name,
        remaining: this.hero.cooldownRemaining(slot.skill.id, this.now),
        total: slot.skill.cooldownMs,
        mpCost: slot.skill.mpCost,
      })),
      basicAttackName: this.basicAttack.name,
      potions: potionCount(this.player),
      pointerLocked: this.pointerLocked,
    };
  }
}
