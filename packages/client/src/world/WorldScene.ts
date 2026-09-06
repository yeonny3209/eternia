/**
 * 월드 씬 — 실제로 걸어다니는 오픈월드.
 *
 * 판정은 전부 @eternia/shared를 쓴다. 서버가 붙으면 이 파일의 update()가
 * 그대로 서버 틱이 되고, 클라이언트는 렌더만 남는다.
 *
 * 기획서 1-2 ①: 레벨 제한으로 맵을 막지 않는다. 저렙도 고렙 맵에 갈 수 있다 — 죽을 뿐이다.
 */
import {
  Combatant,
  ITEMS,
  ITEM_BY_ID,
  MONSTER_BY_ID,
  NPC_BY_ID,
  POI_BY_ID,
  SKILL_BY_ID,
  RARITY_META,
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
/** 1미터당 픽셀 */
export const PPM = 30;

/** 몬스터가 플레이어를 알아채는 거리 */
const AGGRO_RANGE = 7.5;
const AGGRO_RANGE_BOSS = 11;
/** 이 거리를 넘어가면 집으로 돌아간다 */
const LEASH_RANGE = 22;
const RESPAWN_MS = 22_000;
/** 비전투 자연 회복 — 이게 없으면 한 번 다친 뒤로는 계속 불리하다 */
const REGEN_DELAY_MS = 5_000;
const REGEN_PER_SEC = 0.045;

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
}

interface MonsterEntity {
  def: MonsterDef;
  combatant: Combatant;
  home: Vec2;
  state: 'IDLE' | 'CHASE' | 'ATTACK' | 'RETURN' | 'DEAD';
  nextAttackAt: number;
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
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
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
  private cursorScreen: Vec2 = { x: 0, y: 0 };
  private pendingSkill: SkillDef | null = null;
  private pendingDodge = false;
  private pendingInteract = false;
  private pendingPotion = false;
  private lastDamagedAt = -Infinity;
  private activeSkill: SkillDef | null = null;

  private readonly floaters: FloatingText[] = [];
  private readonly slashes: Slash[] = [];
  private camera: Vec2 = { x: 0, y: 0 };

  /** 지금 상호작용할 수 있는 대상 */
  nearby: { kind: 'NPC' | 'PORTAL' | 'CAMPFIRE' | 'POI'; id: string; label: string } | null = null;

  hotbar: HotbarSlot[] = [];
  private basicAttack!: SkillDef;

  constructor(canvas: HTMLCanvasElement, player: PlayerState, callbacks: WorldCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.ctx = ctx;
    this.player = player;
    this.cb = callbacks;

    this.basicAttack = SKILL_BY_ID.get('sk_sw_slash') as SkillDef;
    this.loadMap(player.mapId, null);
    this.rebuildHero();
    this.bindInput();
  }

  /* ------------------------------------------------------------------ */
  /* 캐릭터                                                              */
  /* ------------------------------------------------------------------ */

  /** 레벨업·장비 변경 후 전투 수치를 다시 만든다 */
  rebuildHero(keepPosition = true): void {
    const stats = derivedStats(this.player);
    const previous = this.hero;
    const parryWindow = 250;

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
      parryWindowMs: parryWindow,
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
    const keys = ['Q', 'E', 'R', 'F'];
    const classId = this.player.classId;
    if (!classId) {
      // 직업을 정하기 전에는 기본 공격만 쓴다 (기획서 4-1)
      this.hotbar = [];
      this.basicAttack = SKILL_BY_ID.get('sk_sw_slash') as SkillDef;
      return;
    }
    const skills = skillsForClass(classId).filter((s) => s.kind !== 'PASSIVE');
    const basic = skills.find((s) => s.cooldownMs === 0 && s.kind === 'ACTIVE');
    this.basicAttack = basic ?? (SKILL_BY_ID.get('sk_sw_slash') as SkillDef);
    this.hotbar = skills
      .filter((s) => s.id !== this.basicAttack.id)
      .slice(0, 4)
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

    this.monsters = this.map.spawns.map((spawn) => this.spawnMonster(spawn.monsterId, spawn.pos, spawn.isBoss));
    this.floaters.length = 0;
    this.slashes.length = 0;

    if (this.hero) {
      this.hero.pos = arrivalPoint(this.map, fromMapId);
      this.hero.action.interrupt();
    }
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
      nextAttackAt: 0,
      telegraphAt: -1,
      attackAt: -1,
      respawnAt: 0,
      isBoss,
      wanderTarget: null,
      nextWanderAt: 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 입력                                                                */
  /* ------------------------------------------------------------------ */

  private bindInput(): void {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '1'].includes(key)) e.preventDefault();
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

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.cursorScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.paused) return;
      if (e.button === 0) this.pendingSkill = this.basicAttack;
      if (e.button === 2) this.hero.startGuard(this.now);
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.hero.stopGuard(this.now);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mouseleave', () => this.hero.stopGuard(this.now));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.keys.clear();
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
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick(dt: number): void {
    this.now += dt;

    // 카메라를 먼저 확정한다.
    // 조준은 커서 화면 좌표를 월드 좌표로 바꿔서 구하는데, 그 변환이 카메라에 걸려 있다.
    // 카메라를 render()에서만 갱신하면 프레임이 걸러진 틱에서 조준이 엉뚱한 곳을 향한다.
    this.updateCamera();

    if (this.hero.alive) {
      this.updateAim();
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

  /** 물약 — 기획서 6-3-1 퀵슬롯 */
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
    this.spawnFloater(`+${healed}`, this.hero.pos, '#4ade80', 16);
    this.cb.onPotionUsed(potionCount(this.player));
    this.cb.onStateChanged();
  }

  /**
   * 비전투 자연 회복.
   * 모닥불까지 걸어가야만 회복된다면 지도를 넓게 만든 의미가 없다 —
   * 다친 채로 탐험을 이어갈 수 있어야 오픈월드가 굴러간다.
   */
  private updateRegen(dt: number): void {
    if (!this.hero.alive) return;
    if (this.now - this.lastDamagedAt < REGEN_DELAY_MS) return;
    if (this.hero.hp >= this.hero.maxHp) return;
    this.hero.heal((this.hero.maxHp * REGEN_PER_SEC * dt) / 1000);
  }

  /** 카메라는 플레이어를 따라가되 맵 밖을 비추지 않는다 */
  private updateCamera(): void {
    const viewW = this.canvas.width / PPM;
    const viewH = this.canvas.height / PPM;
    this.camera = {
      x: Math.max(viewW / 2, Math.min(this.map.width - viewW / 2, this.hero.pos.x)),
      y: Math.max(viewH / 2, Math.min(this.map.height - viewH / 2, this.hero.pos.y)),
    };
    if (this.map.width < viewW) this.camera.x = this.map.width / 2;
    if (this.map.height < viewH) this.camera.y = this.map.height / 2;
  }

  private updateAim(): void {
    const world = this.screenToWorld(this.cursorScreen);
    this.hero.aim = Math.atan2(world.y - this.hero.pos.y, world.x - this.hero.pos.x);
  }

  private updateMovement(dt: number): void {
    const dir: Vec2 = { x: 0, y: 0 };
    if (this.keys.has('w')) dir.y -= 1;
    if (this.keys.has('s')) dir.y += 1;
    if (this.keys.has('a')) dir.x -= 1;
    if (this.keys.has('d')) dir.x += 1;

    if (dir.x !== 0 || dir.y !== 0) {
      const before = { ...this.hero.pos };
      this.hero.move(dir, dt);
      this.resolveTerrain(this.hero, before);
    }

    if (this.pendingDodge) {
      this.pendingDodge = false;
      const before = { ...this.hero.pos };
      if (this.hero.tryDodge(this.now)) {
        this.resolveTerrain(this.hero, before);
        this.spawnFloater('회피', this.hero.pos, '#7dd3fc', 12);
      }
    }
  }

  private updateActions(): void {
    if (!this.pendingSkill) return;
    const skill = this.pendingSkill;
    this.pendingSkill = null;
    if (this.hero.useSkill(skill, this.now) !== null) {
      this.activeSkill = skill;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 지형 충돌                                                            */
  /* ------------------------------------------------------------------ */

  private resolveTerrain(entity: Combatant, previous: Vec2): void {
    const r = entity.opts.radius;
    // 맵 밖으로 못 나간다
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
      // 밀어내기 — 벽에 붙어 미끄러지게 해야 조작이 답답하지 않다
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
    // 투사체까지 다루면 코드가 커진다. 원거리 스킬은 즉시 판정 형태로 근사한다.
    const effective = box.type === 'PROJECTILE'
      ? ({ type: 'LINE', length: box.maxDistance, width: box.radius * 4, pierce: box.pierce ?? 1 } as const)
      : box;

    const hits = resolveHitbox({ pos: this.hero.pos, aim: this.hero.aim }, effective, targets);
    for (const hit of hits) {
      const monster = this.livingMonsters().find((m) => m.combatant.id === hit.targetId);
      if (monster) this.damageMonster(monster, skill, hit, comboIndex);
    }
  }

  private damageMonster(monster: MonsterEntity, skill: SkillDef, hit: HitResult, comboIndex: number): void {
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
      { x: monster.combatant.pos.x, y: monster.combatant.pos.y - 0.6 },
      isCrit ? '#fbbf24' : monster.combatant.poise.isGroggy(this.now) ? '#fca5a5' : '#f1f5f9',
      isCrit ? 18 : 14,
    );

    if (outcome.groggyBroke) {
      this.spawnFloater('자세 붕괴!', monster.combatant.pos, '#f97316', 18);
    }

    // 맞으면 즉시 반응한다 — 때렸는데 가만히 있으면 사냥이 재미없다
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
    this.spawnFloater(`+${exp} EXP`, { x: monster.combatant.pos.x, y: monster.combatant.pos.y - 1.4 }, '#a3e635', 13);
    this.spawnFloater(`+${gold} G`, { x: monster.combatant.pos.x + 0.8, y: monster.combatant.pos.y - 0.9 }, '#fbbf24', 12);

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

  /** 전리품 — 몬스터 레벨대에 맞는 아이템 중에서 고른다 */
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

    // 보스는 희귀 이상만 준다
    const filtered = monster.isBoss
      ? pool.filter((i) => i.rarity !== 'COMMON' && i.rarity !== 'UNCOMMON')
      : pool;
    const candidates = filtered.length > 0 ? filtered : pool;
    const def = candidates[Math.floor(Math.random() * candidates.length)];
    if (!def) return;

    const instance = rollItem(def, Math.random, `it_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`);
    if (!addItem(this.player, instance)) {
      this.cb.onToast('가방이 가득 찼습니다', 'DANGER');
      return;
    }

    const meta = RARITY_META[def.rarity];
    this.spawnFloater(def.name, { x: monster.combatant.pos.x, y: monster.combatant.pos.y - 2 }, meta.color, 14);
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

      const toPlayer = {
        x: this.hero.pos.x - mob.pos.x,
        y: this.hero.pos.y - mob.pos.y,
      };
      const distance = Math.hypot(toPlayer.x, toPlayer.y);
      const aggro = monster.isBoss ? AGGRO_RANGE_BOSS : AGGRO_RANGE;
      const homeDistance = Math.hypot(mob.pos.x - monster.home.x, mob.pos.y - monster.home.y);

      if (mob.poise.isGroggy(this.now)) continue; // 그로기 중에는 아무것도 못 한다

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
            mob.move({ x: toPlayer.x, y: toPlayer.y }, dt);
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
            monster.nextAttackAt = this.now + (monster.isBoss ? 2300 : 1900) + Math.random() * 700;
          }
          break;
        }
        case 'RETURN': {
          if (homeDistance < 0.6) {
            monster.state = 'IDLE';
            mob.hp = mob.maxHp; // 리쉬 복귀 시 회복 — 치고 빠지기 방지
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

  /** 몬스터끼리 겹쳐 서지 않게 */
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
        this.spawnFloater('무적!', this.hero.pos, '#38bdf8', 14);
      }
      return;
    }

    this.lastDamagedAt = this.now;
    const outcome = this.hero.takeHit({
      attackerId: mob.id,
      attackerLevel: monster.def.level,
      attackerAtk: mob.opts.atk,
      // 여러 마리가 붙으면 순식간에 죽는다. 한 대의 무게를 낮추고
      // '여러 마리를 동시에 상대하는 상황' 자체를 위험 요소로 남긴다.
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
        this.spawnFloater('패리!', this.hero.pos, '#facc15', 20);
        break;
      case 'IFRAME':
        this.spawnFloater('무적!', this.hero.pos, '#38bdf8', 14);
        break;
      case 'BLOCKED':
        this.spawnFloater(`막음 ${outcome.damage}`, this.hero.pos, '#94a3b8', 13);
        break;
      case 'GUARD_BROKEN':
        this.spawnFloater('가드 브레이크!', this.hero.pos, '#ef4444', 18);
        break;
      case 'DEAD':
        this.spawnFloater('사망', this.hero.pos, '#ef4444', 22);
        this.onDeath();
        break;
      default:
        this.spawnFloater(`-${outcome.damage}`, this.hero.pos, '#fca5a5', 14);
    }
  }

  private onDeath(): void {
    // 기획서 4-2절 범위 밖이라 페널티는 가볍게 — 골드 5%만 잃고 마을로
    const lost = Math.floor(this.player.gold * 0.05);
    this.player.gold -= lost;
    this.cb.onToast(`쓰러졌습니다. 골드 ${lost}를 잃었습니다.`, 'DANGER');
    this.cb.onPlayerDeath();
  }

  /** 부활 — 가장 가까운 거점으로 */
  respawn(): void {
    this.hero.reset();
    this.hero.hp = this.hero.maxHp;
    const campfire = this.map.campfires[0];
    this.hero.pos = campfire ? { ...campfire } : { ...this.map.entry };
    // 부활 지점에 몬스터가 몰려 있으면 일어나자마자 다시 죽는다.
    // 3초의 유예를 준다 — 도망칠지 싸울지 정할 시간.
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
      if (distance < 2.4 && distance < best) {
        best = distance;
        const def = NPC_BY_ID.get(npc.id);
        found = { kind: 'NPC', id: npc.id, label: def?.name ?? npc.id };
      }
    }
    for (const portal of this.map.portals) {
      const distance = Math.hypot(portal.pos.x - pos.x, portal.pos.y - pos.y);
      if (distance < portal.radius + 0.8 && distance < best) {
        best = distance;
        found = { kind: 'PORTAL', id: portal.to, label: `${portal.toName}(으)로 이동` };
      }
    }
    for (const campfire of this.map.campfires) {
      const distance = Math.hypot(campfire.x - pos.x, campfire.y - pos.y);
      if (distance < 2.2 && distance < best) {
        best = distance;
        found = { kind: 'CAMPFIRE', id: 'campfire', label: '모닥불에서 휴식' };
      }
    }
    for (const poi of this.map.pois) {
      const distance = Math.hypot(poi.pos.x - pos.x, poi.pos.y - pos.y);
      if (distance < 2.4 && distance < best) {
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
      this.spawnFloater('회복', this.hero.pos, '#4ade80', 16);
      this.cb.onToast('모닥불에서 쉬었습니다. 체력이 모두 찼습니다.', 'INFO');
      this.cb.onStateChanged();
      return;
    }
    if (target.kind === 'POI') {
      const poi = POI_BY_ID.get(target.id);
      this.spawnFloater('조사 완료', this.hero.pos, '#fde68a', 14);
      this.cb.onInteractPoi(target.id, poi?.name ?? target.id);
      return;
    }
    this.cb.onInteractNpc(target.id);
  }

  /** 월드 지도에서 이동 — 이미 가 본 맵만 */
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

  /* ------------------------------------------------------------------ */
  /* 렌더링                                                              */
  /* ------------------------------------------------------------------ */

  private spawnFloater(text: string, pos: Vec2, color: string, size: number): void {
    this.floaters.push({ text, pos: { ...pos }, bornAt: this.now, color, size });
    if (this.floaters.length > 60) this.floaters.shift();
  }

  private screenToWorld(screen: Vec2): Vec2 {
    return {
      x: this.camera.x + (screen.x - this.canvas.width / 2) / PPM,
      y: this.camera.y + (screen.y - this.canvas.height / 2) / PPM,
    };
  }

  private toScreen(world: Vec2): Vec2 {
    return {
      x: this.canvas.width / 2 + (world.x - this.camera.x) * PPM,
      y: this.canvas.height / 2 + (world.y - this.camera.y) * PPM,
    };
  }

  private render(): void {
    const { ctx, canvas } = this;
    const biome = this.map.biome;
    ctx.fillStyle = biome.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.renderGrid();
    this.renderDecorations();
    this.renderCampfires();
    this.renderPortals();
    this.renderPois();
    this.renderObstacles();
    this.renderNpcs();
    this.renderSlashes();
    this.renderMonsters();
    this.renderHero();
    this.renderFloaters();

    // 분위기 오버레이
    ctx.fillStyle = biome.haze;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.renderVignette();
  }

  private renderGrid(): void {
    const { ctx } = this;
    ctx.strokeStyle = this.map.biome.grid;
    ctx.lineWidth = 1;
    const start = this.screenToWorld({ x: 0, y: 0 });
    const end = this.screenToWorld({ x: this.canvas.width, y: this.canvas.height });
    for (let x = Math.floor(start.x / 4) * 4; x <= end.x; x += 4) {
      const a = this.toScreen({ x, y: start.y });
      const b = this.toScreen({ x, y: end.y });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let y = Math.floor(start.y / 4) * 4; y <= end.y; y += 4) {
      const a = this.toScreen({ x: start.x, y });
      const b = this.toScreen({ x: end.x, y });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private inView(pos: Vec2, pad = 4): boolean {
    const dx = Math.abs(pos.x - this.camera.x);
    const dy = Math.abs(pos.y - this.camera.y);
    return dx < this.canvas.width / PPM / 2 + pad && dy < this.canvas.height / PPM / 2 + pad;
  }

  private renderDecorations(): void {
    const { ctx } = this;
    ctx.fillStyle = this.map.biome.decor;
    ctx.globalAlpha = 0.32;
    for (const decoration of this.map.decorations) {
      if (!this.inView(decoration.pos, 2)) continue;
      const p = this.toScreen(decoration.pos);
      const size = decoration.scale * 3;
      if (decoration.kind === 'GRASS') {
        ctx.fillRect(p.x, p.y, 1.4, -size * 2);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderObstacles(): void {
    const { ctx } = this;
    for (const obstacle of this.map.obstacles) {
      if (!this.inView(obstacle.pos, 4)) continue;
      const p = this.toScreen(obstacle.pos);
      const r = obstacle.radius * PPM;

      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r * 0.25, r, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (obstacle.kind === 'WATER') {
        ctx.fillStyle = 'rgba(70,150,190,0.4)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,220,255,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        continue;
      }

      if (obstacle.kind === 'BUILDING') {
        const size = r * 1.5;
        ctx.fillStyle = this.map.biome.propDark;
        ctx.fillRect(p.x - size / 2, p.y - size * 0.9, size, size * 1.1);
        ctx.fillStyle = this.map.biome.prop;
        ctx.fillRect(p.x - size / 2, p.y - size * 0.9, size, size * 0.35);
        continue;
      }

      if (obstacle.kind === 'TREE') {
        ctx.fillStyle = this.map.biome.propDark;
        ctx.fillRect(p.x - r * 0.18, p.y - r * 0.6, r * 0.36, r * 0.9);
        ctx.fillStyle = this.map.biome.prop;
        ctx.beginPath();
        ctx.arc(p.x, p.y - r * 0.9, r * 1.1, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      if (obstacle.kind === 'CRYSTAL') {
        ctx.fillStyle = this.map.biome.decor;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r * 1.8);
        ctx.lineTo(p.x + r * 0.7, p.y);
        ctx.lineTo(p.x, p.y + r * 0.4);
        ctx.lineTo(p.x - r * 0.7, p.y);
        ctx.closePath();
        ctx.fill();
        continue;
      }

      // ROCK / RUIN
      ctx.fillStyle = this.map.biome.prop;
      ctx.beginPath();
      ctx.arc(p.x, p.y - r * 0.2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.map.biome.propDark;
      ctx.beginPath();
      ctx.arc(p.x - r * 0.25, p.y - r * 0.35, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderCampfires(): void {
    const { ctx } = this;
    for (const campfire of this.map.campfires) {
      if (!this.inView(campfire, 3)) continue;
      const p = this.toScreen(campfire);
      const pulse = 0.7 + Math.sin(this.now / 260) * 0.3;
      const gradient = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 60 * pulse);
      gradient.addColorStop(0, 'rgba(255,170,60,0.5)');
      gradient.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 60 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderPortals(): void {
    const { ctx } = this;
    for (const portal of this.map.portals) {
      if (!this.inView(portal.pos, 4)) continue;
      const p = this.toScreen(portal.pos);
      const r = portal.radius * PPM;
      const pulse = 0.75 + Math.sin(this.now / 400) * 0.25;

      const gradient = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, r * pulse);
      gradient.addColorStop(0, 'rgba(160,120,255,0.55)');
      gradient.addColorStop(1, 'rgba(120,90,220,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(196,181,253,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#ddd6fe';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(portal.toName, p.x, p.y - r * 0.8);
    }
  }

  /** 퀘스트 장소 — 눈에 띄어야 찾아갈 마음이 든다 */
  private renderPois(): void {
    const { ctx } = this;
    for (const poi of this.map.pois) {
      if (!this.inView(poi.pos, 3)) continue;
      const p = this.toScreen(poi.pos);
      const pulse = 0.8 + Math.sin(this.now / 500 + poi.pos.x) * 0.2;

      ctx.strokeStyle = `rgba(250,204,21,${0.35 * pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 * PPM * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(250,204,21,0.85)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 12);
      ctx.lineTo(p.x + 8, p.y);
      ctx.lineTo(p.x, p.y + 12);
      ctx.lineTo(p.x - 8, p.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fde68a';
      ctx.font = '600 11.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(poi.name, p.x, p.y - 20);
    }
  }

  private renderNpcs(): void {
    const { ctx } = this;
    for (const npc of this.map.npcs) {
      if (!this.inView(npc.pos, 3)) continue;
      const p = this.toScreen(npc.pos);
      const def = NPC_BY_ID.get(npc.id);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 8, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 3, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fde68a';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def?.name ?? npc.id, p.x, p.y - 20);
    }
  }

  private renderSlashes(): void {
    const { ctx } = this;
    for (let i = this.slashes.length - 1; i >= 0; i -= 1) {
      const slash = this.slashes[i] as Slash;
      const age = this.now - slash.bornAt;
      const life = slash.hostile ? 320 : 200;
      if (age > life) {
        this.slashes.splice(i, 1);
        continue;
      }
      const alpha = (1 - age / life) * (slash.hostile ? 0.35 : 0.45);
      const p = this.toScreen(slash.origin);
      const half = ((slash.angle * Math.PI) / 180) / 2;
      ctx.fillStyle = slash.hostile ? `rgba(248,113,113,${alpha})` : `rgba(147,197,253,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, slash.range * PPM, slash.aim - half, slash.aim + half);
      ctx.closePath();
      ctx.fill();
    }
  }

  private renderMonsters(): void {
    const { ctx } = this;
    for (const monster of this.monsters) {
      if (monster.state === 'DEAD') continue;
      const mob = monster.combatant;
      if (!this.inView(mob.pos, 3)) continue;
      const p = this.toScreen(mob.pos);
      const r = mob.opts.radius * PPM;

      // 공격 예고
      if (monster.state === 'ATTACK' && monster.telegraphAt >= 0) {
        const progress = Math.min(1, (this.now - monster.telegraphAt) / (monster.attackAt - monster.telegraphAt));
        const half = ((monster.isBoss ? 140 : 100) * Math.PI) / 180 / 2;
        ctx.fillStyle = `rgba(248,113,113,${0.1 + progress * 0.25})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, (mob.opts.radius + 2.2) * PPM, mob.aim - half, mob.aim + half);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r * 0.5, r, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (mob.poise.isGroggy(this.now)) {
        ctx.strokeStyle = 'rgba(249,115,22,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      const color = monster.isBoss ? '#dc2626' : monster.def.kind === 'ELITE' ? '#c026d3' : '#b45309';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 바라보는 방향
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(mob.aim) * (r + 7), p.y + Math.sin(mob.aim) * (r + 7));
      ctx.stroke();

      // HP 바 — 다친 놈만
      if (mob.hp < mob.maxHp) {
        const width = Math.max(28, r * 2.4);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(p.x - width / 2, p.y - r - 12, width, 4);
        ctx.fillStyle = monster.isBoss ? '#f87171' : '#4ade80';
        ctx.fillRect(p.x - width / 2, p.y - r - 12, width * mob.hpRatio, 4);
      }

      if (monster.isBoss || monster.def.kind === 'ELITE') {
        ctx.fillStyle = monster.isBoss ? '#fca5a5' : '#e9d5ff';
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${monster.def.name} Lv${monster.def.level}`, p.x, p.y - r - 17);
      }
    }
  }

  private renderHero(): void {
    const { ctx } = this;
    const p = this.toScreen(this.hero.pos);
    const r = this.hero.opts.radius * PPM;

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.5, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.hero.stamina.wasInvulnerableAt(this.now)) {
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.hero.guard.isGuarding) {
      ctx.strokeStyle = 'rgba(226,232,240,0.9)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, this.hero.aim - 0.9, this.hero.aim + 0.9);
      ctx.stroke();
    }

    ctx.fillStyle = this.hero.alive ? '#2563eb' : '#475569';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = '#bfdbfe';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(this.hero.aim) * (r + 12), p.y + Math.sin(this.hero.aim) * (r + 12));
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.player.nickname} Lv${this.player.level}`, p.x, p.y - r - 12);

    // 상호작용 안내
    if (this.nearby) {
      ctx.fillStyle = '#fde68a';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(`[E] ${this.nearby.label}`, p.x, p.y - r - 30);
    }
  }

  private renderFloaters(): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (let i = this.floaters.length - 1; i >= 0; i -= 1) {
      const floater = this.floaters[i] as FloatingText;
      const age = this.now - floater.bornAt;
      if (age > 1000) {
        this.floaters.splice(i, 1);
        continue;
      }
      const p = this.toScreen(floater.pos);
      ctx.globalAlpha = 1 - age / 1000;
      ctx.fillStyle = floater.color;
      ctx.font = `700 ${floater.size}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(floater.text, p.x, p.y - 24 - age / 26);
      ctx.fillText(floater.text, p.x, p.y - 24 - age / 26);
      ctx.globalAlpha = 1;
    }
  }

  private renderVignette(): void {
    const { ctx, canvas } = this;
    const gradient = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.35,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.85,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    };
  }
}
