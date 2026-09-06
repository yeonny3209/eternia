/**
 * 허수아비 훈련장 — 기획서 M1의 검증 씬.
 *
 *   "허수아비 테스트 씬으로 손맛 검증 → 여기서 OK 안 나오면 다음으로 가지 말 것"
 *
 * 검사의 기본 공격 3타 콤보 + 회피 구르기 + 가드/패리 + 자세 붕괴만 있으면 된다.
 * 프레임 수치(선딜/무적/후딜)는 화면에서 바로 조절할 수 있게 빼 두었다.
 *
 * 렌더링은 render/ 레이어에만 있다. 판정은 전부 @eternia/shared —
 * 즉 서버가 돌리는 코드와 **같은 코드**다.
 */
import {
  Combatant,
  DEFAULT_STAMINA,
  PVE_POISE,
  Projectile,
  SKILL_BY_ID,
  hitPosition,
  resolveHitbox,
  type HitResult,
  type HitTarget,
  type SkillDef,
  type StaminaConfig,
  type Vec2,
} from '@eternia/shared';

/** 기획서 11-4: 서버 틱 30/s (33ms) */
const TICK_MS = 1000 / 30;
/** 화면 1m = 몇 픽셀인가 */
const PPM = 34;

const SWORDSMAN_SKILLS = [
  'sk_sw_slash',
  'sk_sw_shield_bash',
  'sk_sw_earth_render',
  'sk_sw_execution',
] as const;

interface FloatingText {
  text: string;
  pos: Vec2;
  bornAt: number;
  color: string;
  size: number;
}

interface DebugShape {
  kind: 'sector' | 'line' | 'circle' | 'dash';
  origin: Vec2;
  aim: number;
  a: number;
  b: number;
  bornAt: number;
}

export interface TuningState {
  startupMs: number;
  activeMs: number;
  recoveryMs: number;
  iframeMs: number;
  dodgeDurationMs: number;
  parryWindowMs: number;
  showHitboxes: boolean;
}

export class TrainingScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private player!: Combatant;
  private dummy!: Combatant;
  private readonly projectiles: Projectile[] = [];
  private readonly floaters: FloatingText[] = [];
  private readonly debugShapes: DebugShape[] = [];

  /** 시뮬레이션 시각(ms). 서버 시각을 대신한다 */
  private now = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private running = false;
  private rafId = 0;

  private readonly keys = new Set<string>();
  private cursor: Vec2 = { x: 0, y: 0 };
  private pendingSkill: string | null = null;
  private pendingDodge = false;

  /** 허수아비의 다음 공격 시각 */
  private dummyNextAttackAt = 3000;
  private dummyAttackTelegraphAt = -1;

  private readonly stats = {
    hits: 0,
    parries: 0,
    dodges: 0,
    iframeSaves: 0,
    groggyBreaks: 0,
    totalDamage: 0,
  };

  tuning: TuningState = {
    startupMs: 140,
    activeMs: 90,
    recoveryMs: 260,
    iframeMs: DEFAULT_STAMINA.iframeMs,
    dodgeDurationMs: DEFAULT_STAMINA.dodgeDurationMs,
    parryWindowMs: 250,
    showHitboxes: true,
  };

  onStats?: (stats: TrainingScene['stats'], scene: TrainingScene) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.ctx = ctx;
    this.reset();
    this.bindInput();
  }

  /* ------------------------------ 설정 ------------------------------ */

  reset(): void {
    const staminaConfig: StaminaConfig = {
      ...DEFAULT_STAMINA,
      iframeMs: this.tuning?.iframeMs ?? DEFAULT_STAMINA.iframeMs,
      dodgeDurationMs: this.tuning?.dodgeDurationMs ?? DEFAULT_STAMINA.dodgeDurationMs,
    };

    this.player = new Combatant({
      id: 'player',
      name: '검사',
      level: 20,
      maxHp: 2400,
      maxMp: 300,
      atk: 260,
      def: 90,
      critRate: 0.15,
      critDmgBonus: 0.2,
      radius: 0.55,
      moveSpeed: 5.2,
      parryWindowMs: this.tuning?.parryWindowMs ?? 250,
      staminaConfig,
      faction: 'PLAYER',
    });
    this.player.pos = { x: -1.6, y: 0 };

    this.dummy = new Combatant({
      id: 'dummy',
      name: '훈련용 허수아비',
      level: 20,
      maxHp: 40000,
      maxMp: 0,
      atk: 240,
      def: 70,
      critRate: 0,
      critDmgBonus: 0,
      radius: 0.85,
      moveSpeed: 0,
      parryWindowMs: 0,
      poiseConfig: { ...PVE_POISE, max: 220 },
      faction: 'ENEMY',
    });
    this.dummy.pos = { x: 1.3, y: 0 };
    this.dummy.aim = Math.PI;

    this.projectiles.length = 0;
    this.floaters.length = 0;
    this.debugShapes.length = 0;
    this.now = 0;
    this.dummyNextAttackAt = 3000;
    this.dummyAttackTelegraphAt = -1;
    Object.assign(this.stats, {
      hits: 0,
      parries: 0,
      dodges: 0,
      iframeSaves: 0,
      groggyBreaks: 0,
      totalDamage: 0,
    });
  }

  /** 튜닝 패널이 값을 바꾸면 호출된다 */
  applyTuning(next: Partial<TuningState>): void {
    Object.assign(this.tuning, next);
    this.reset();
  }

  /** 기본 공격의 프레임 데이터를 튜닝 값으로 덮어쓴다 */
  private skillFor(id: string): SkillDef {
    const base = SKILL_BY_ID.get(id) as SkillDef;
    if (id !== 'sk_sw_slash') return base;
    return {
      ...base,
      frames: {
        ...base.frames,
        startupMs: this.tuning.startupMs,
        activeMs: this.tuning.activeMs,
        recoveryMs: this.tuning.recoveryMs,
      },
    };
  }

  /* ------------------------------ 입력 ------------------------------ */

  private bindInput(): void {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ([' ', 'w', 'a', 's', 'd', 'q', 'e', 'r'].includes(key)) e.preventDefault();
      if (this.keys.has(key)) return;
      this.keys.add(key);

      if (key === ' ') this.pendingDodge = true;
      if (key === 'q') this.pendingSkill = 'sk_sw_shield_bash';
      if (key === 'e') this.pendingSkill = 'sk_sw_earth_render';
      if (key === 'r') this.pendingSkill = 'sk_sw_execution';
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.cursor = {
        x: (e.clientX - rect.left - rect.width / 2) / PPM,
        y: (e.clientY - rect.top - rect.height / 2) / PPM,
      };
    });

    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0) this.pendingSkill = 'sk_sw_slash';
      if (e.button === 2) this.player.startGuard(this.now);
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.player.stopGuard(this.now);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mouseleave', () => this.player.stopGuard(this.now));
  }

  /* ------------------------------ 루프 ------------------------------ */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (timestamp: number) => {
      if (!this.running) return;
      const delta = Math.min(100, timestamp - this.lastFrame);
      this.lastFrame = timestamp;
      this.accumulator += delta;
      // 고정 틱 — 서버와 같은 30/s로 돌린다
      while (this.accumulator >= TICK_MS) {
        this.tick(TICK_MS);
        this.accumulator -= TICK_MS;
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

  private tick(dtMs: number): void {
    this.now += dtMs;

    // 캐릭터는 항상 커서를 바라본다 (기획서 6-3-1)
    this.player.aim = Math.atan2(this.cursor.y - this.player.pos.y, this.cursor.x - this.player.pos.x);

    // 이동
    const dir: Vec2 = { x: 0, y: 0 };
    if (this.keys.has('w')) dir.y -= 1;
    if (this.keys.has('s')) dir.y += 1;
    if (this.keys.has('a')) dir.x -= 1;
    if (this.keys.has('d')) dir.x += 1;
    this.player.move(dir, dtMs);

    // 회피
    if (this.pendingDodge) {
      this.pendingDodge = false;
      if (this.player.tryDodge(this.now)) {
        this.stats.dodges += 1;
        this.spawnFloater('회피', this.player.pos, '#7dd3fc', 13);
      }
    }

    // 스킬
    if (this.pendingSkill) {
      const skill = this.skillFor(this.pendingSkill);
      this.pendingSkill = null;
      const comboIndex = this.player.useSkill(skill, this.now);
      if (comboIndex !== null) this.pendingActiveSkill = skill;
    }

    const snapshot = this.player.update(dtMs, this.now);
    this.dummy.update(dtMs, this.now);

    // 판정 프레임에 진입한 순간 히트박스를 굴린다
    if (snapshot.activeStarted && this.pendingActiveSkill) {
      this.resolveSkillHit(this.pendingActiveSkill, snapshot.comboIndex);
      this.pendingActiveSkill = null;
    }

    this.stepProjectiles(dtMs);
    this.updateDummy(dtMs);

    // 화면 밖으로 못 나가게
    this.player.pos.x = Math.max(-9, Math.min(9, this.player.pos.x));
    this.player.pos.y = Math.max(-5.5, Math.min(5.5, this.player.pos.y));

    this.onStats?.(this.stats, this);
  }

  private pendingActiveSkill: SkillDef | null = null;

  /* ---------------------------- 히트 판정 ---------------------------- */

  private resolveSkillHit(skill: SkillDef, comboIndex: number): void {
    if (!skill.hitbox) return;

    if (skill.hitbox.type === 'PROJECTILE') {
      this.projectiles.push(
        new Projectile(
          `pj_${this.now}`,
          this.player.id,
          { ...this.player.pos },
          this.player.aim,
          skill.hitbox,
          this.now,
        ),
      );
      return;
    }

    this.pushDebugShape(skill, this.player.pos, this.player.aim);

    const targets: HitTarget[] = [this.dummy.asTarget(this.now)];
    const hits = resolveHitbox({ pos: this.player.pos, aim: this.player.aim }, skill.hitbox, targets);
    for (const hit of hits) this.applyHit(skill, hit, comboIndex);
  }

  private applyHit(skill: SkillDef, hit: HitResult, comboIndex: number): void {
    const isCrit = Math.random() < this.player.opts.critRate;
    const outcome = this.dummy.takeHit({
      attackerId: this.player.id,
      attackerLevel: this.player.opts.level,
      attackerAtk: this.player.opts.atk,
      skillCoef: skill.coef.pve,
      comboIndex,
      poiseDamage: skill.poiseDamage,
      position: hit.position,
      isCrit,
      critDmgBonus: this.player.opts.critDmgBonus,
      elementMultiplier: 1,
      contextCoef: 1,
      roll: Math.random(),
      hitTimeMs: this.now,
    });

    this.stats.hits += 1;
    this.stats.totalDamage += outcome.damage;

    const positionLabel = hit.position === 'BACK' ? ' 배후!' : hit.position === 'SIDE' ? ' 측면' : '';
    this.spawnFloater(
      `${outcome.damage}${isCrit ? '!' : ''}${positionLabel}`,
      this.dummy.pos,
      isCrit ? '#fbbf24' : this.dummy.poise.isGroggy(this.now) ? '#f87171' : '#f1f5f9',
      isCrit ? 20 : 16,
    );

    if (outcome.groggyBroke) {
      this.stats.groggyBreaks += 1;
      this.spawnFloater('자세 붕괴!', { x: this.dummy.pos.x, y: this.dummy.pos.y - 1.4 }, '#f97316', 22);
    }

    // 허수아비는 죽지 않는다 — 훈련장이므로 계속 서 있어야 한다
    if (!this.dummy.alive) {
      this.dummy.reset();
      this.dummy.aim = Math.PI;
    }
  }

  private stepProjectiles(dtMs: number): void {
    const targets = [this.dummy.asTarget(this.now)];
    for (const projectile of this.projectiles) {
      const hits = projectile.step(dtMs, targets);
      for (const hit of hits) {
        this.applyHit(this.skillFor('sk_sw_slash'), hit, 0);
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      if ((this.projectiles[i] as Projectile).dead) this.projectiles.splice(i, 1);
    }
  }

  /* --------------------------- 허수아비 AI --------------------------- */

  /**
   * 허수아비도 가끔 때린다. 그래야 회피와 패리를 연습할 수 있다.
   * 공격 0.7초 전에 예고 표시를 띄운다 — 반응할 시간이 있어야 실력이 개입한다.
   */
  private updateDummy(_dtMs: number): void {
    if (this.now >= this.dummyNextAttackAt - 700 && this.dummyAttackTelegraphAt < 0) {
      this.dummyAttackTelegraphAt = this.now;
    }

    if (this.now < this.dummyNextAttackAt) return;

    this.dummyAttackTelegraphAt = -1;
    this.dummyNextAttackAt = this.now + 2600 + Math.random() * 900;

    this.dummy.aim = Math.atan2(
      this.player.pos.y - this.dummy.pos.y,
      this.player.pos.x - this.dummy.pos.x,
    );

    const attackBox = { type: 'SECTOR', range: 3.4, angle: 110 } as const;
    this.debugShapes.push({
      kind: 'sector',
      origin: { ...this.dummy.pos },
      aim: this.dummy.aim,
      a: attackBox.range,
      b: attackBox.angle,
      bornAt: this.now,
    });

    const hits = resolveHitbox(
      { pos: this.dummy.pos, aim: this.dummy.aim },
      attackBox,
      [this.player.asTarget(this.now)],
    );

    if (hits.length === 0) {
      // 무적 프레임으로 피했는지, 그냥 범위 밖이었는지 구분해서 보여준다
      const wasInvuln = this.player.stamina.wasInvulnerableAt(this.now);
      if (wasInvuln) {
        this.stats.iframeSaves += 1;
        this.spawnFloater('무적!', this.player.pos, '#38bdf8', 18);
      } else {
        this.spawnFloater('빗나감', this.dummy.pos, '#64748b', 14);
      }
      return;
    }

    const hit = hits[0] as HitResult;
    const outcome = this.player.takeHit({
      attackerId: this.dummy.id,
      attackerLevel: this.dummy.opts.level,
      attackerAtk: this.dummy.opts.atk,
      skillCoef: 1.4,
      comboIndex: 0,
      poiseDamage: 30,
      position: hitPosition(this.dummy.pos, this.player.asTarget(this.now)),
      isCrit: false,
      critDmgBonus: 0,
      elementMultiplier: 1,
      contextCoef: 1,
      roll: Math.random(),
      hitTimeMs: this.now,
    });

    switch (outcome.verdict) {
      case 'PARRIED': {
        this.stats.parries += 1;
        this.dummy.sufferParry(this.now);
        this.spawnFloater('패리!', this.player.pos, '#facc15', 24);
        break;
      }
      case 'IFRAME': {
        this.stats.iframeSaves += 1;
        this.spawnFloater('무적!', this.player.pos, '#38bdf8', 18);
        break;
      }
      case 'BLOCKED':
        this.spawnFloater(`막음 ${outcome.damage}`, this.player.pos, '#94a3b8', 15);
        break;
      case 'GUARD_BROKEN':
        this.spawnFloater('가드 브레이크!', this.player.pos, '#ef4444', 20);
        break;
      case 'DEAD':
        this.spawnFloater('사망 — 초기화', this.player.pos, '#ef4444', 22);
        this.player.reset();
        this.player.pos = { x: -1.6, y: 0 };
        break;
      default:
        this.spawnFloater(`-${outcome.damage}`, this.player.pos, '#fca5a5', 16);
    }
  }

  /* ----------------------------- 렌더링 ------------------------------ */

  private spawnFloater(text: string, pos: Vec2, color: string, size: number): void {
    this.floaters.push({ text, pos: { ...pos }, bornAt: this.now, color, size });
    if (this.floaters.length > 40) this.floaters.shift();
  }

  private pushDebugShape(skill: SkillDef, origin: Vec2, aim: number): void {
    const box = skill.hitbox;
    if (!box) return;
    const common = { origin: { ...origin }, aim, bornAt: this.now };
    if (box.type === 'SECTOR') {
      this.debugShapes.push({ kind: 'sector', a: box.range, b: box.angle, ...common });
    } else if (box.type === 'LINE') {
      this.debugShapes.push({ kind: 'line', a: box.length, b: box.width, ...common });
    } else if (box.type === 'CIRCLE') {
      this.debugShapes.push({ kind: 'circle', a: box.radius, b: box.offset ?? 0, ...common });
    } else if (box.type === 'DASH') {
      this.debugShapes.push({ kind: 'dash', a: box.distance, b: box.width, ...common });
    }
    if (this.debugShapes.length > 24) this.debugShapes.shift();
  }

  private toScreen(pos: Vec2): Vec2 {
    return {
      x: this.canvas.width / 2 + pos.x * PPM,
      y: this.canvas.height / 2 + pos.y * PPM,
    };
  }

  private render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 바닥
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(148,163,184,0.09)';
    ctx.lineWidth = 1;
    for (let x = -10; x <= 10; x += 1) {
      const p = this.toScreen({ x, y: -6 });
      const q = this.toScreen({ x, y: 6 });
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    for (let y = -6; y <= 6; y += 1) {
      const p = this.toScreen({ x: -10, y });
      const q = this.toScreen({ x: 10, y });
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }

    if (this.tuning.showHitboxes) this.renderDebugShapes();
    this.renderTelegraph();
    this.renderProjectiles();
    this.renderEntity(this.dummy, '#b45309', '#fbbf24');
    this.renderEntity(this.player, '#1d4ed8', '#60a5fa');
    this.renderFloaters();
  }

  private renderDebugShapes(): void {
    const { ctx } = this;
    for (const shape of this.debugShapes) {
      const age = this.now - shape.bornAt;
      if (age > 260) continue;
      const alpha = 0.42 * (1 - age / 260);
      ctx.fillStyle = `rgba(96,165,250,${alpha})`;
      ctx.strokeStyle = `rgba(191,219,254,${alpha + 0.2})`;
      ctx.lineWidth = 1.5;
      const o = this.toScreen(shape.origin);

      ctx.beginPath();
      if (shape.kind === 'sector') {
        const half = ((shape.b * Math.PI) / 180) / 2;
        ctx.moveTo(o.x, o.y);
        ctx.arc(o.x, o.y, shape.a * PPM, shape.aim - half, shape.aim + half);
        ctx.closePath();
      } else if (shape.kind === 'line' || shape.kind === 'dash') {
        const dx = Math.cos(shape.aim);
        const dy = Math.sin(shape.aim);
        const nx = -dy * (shape.b / 2) * PPM;
        const ny = dx * (shape.b / 2) * PPM;
        const ex = o.x + dx * shape.a * PPM;
        const ey = o.y + dy * shape.a * PPM;
        ctx.moveTo(o.x + nx, o.y + ny);
        ctx.lineTo(ex + nx, ey + ny);
        ctx.lineTo(ex - nx, ey - ny);
        ctx.lineTo(o.x - nx, o.y - ny);
        ctx.closePath();
      } else {
        const cx = o.x + Math.cos(shape.aim) * shape.b * PPM;
        const cy = o.y + Math.sin(shape.aim) * shape.b * PPM;
        ctx.arc(cx, cy, shape.a * PPM, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  /** 허수아비 공격 예고 — 반응할 시간을 준다 */
  private renderTelegraph(): void {
    if (this.dummyAttackTelegraphAt < 0) return;
    const progress = Math.min(1, (this.now - this.dummyAttackTelegraphAt) / 700);
    const { ctx } = this;
    const o = this.toScreen(this.dummy.pos);
    const aim = Math.atan2(
      this.player.pos.y - this.dummy.pos.y,
      this.player.pos.x - this.dummy.pos.x,
    );
    const half = ((110 * Math.PI) / 180) / 2;
    ctx.fillStyle = `rgba(248,113,113,${0.10 + progress * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.arc(o.x, o.y, 3.4 * PPM, aim - half, aim + half);
    ctx.closePath();
    ctx.fill();
  }

  private renderProjectiles(): void {
    const { ctx } = this;
    ctx.fillStyle = '#a5b4fc';
    for (const projectile of this.projectiles) {
      const p = this.toScreen(projectile.pos);
      ctx.beginPath();
      ctx.arc(p.x, p.y, projectile.box.radius * PPM, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderEntity(entity: Combatant, body: string, accent: string): void {
    const { ctx } = this;
    const p = this.toScreen(entity.pos);
    const r = entity.opts.radius * PPM;

    // 무적 중이면 링을 그린다
    if (entity.stamina.wasInvulnerableAt(this.now)) {
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 그로기
    if (entity.poise.isGroggy(this.now)) {
      ctx.strokeStyle = 'rgba(249,115,22,0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 가드
    if (entity.guard.isGuarding) {
      ctx.strokeStyle = 'rgba(226,232,240,0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, entity.aim - 0.9, entity.aim + 0.9);
      ctx.stroke();
    }

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 조준 방향
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(entity.aim) * (r + 12), p.y + Math.sin(entity.aim) * (r + 12));
    ctx.stroke();

    // 페이즈 표시 — 선딜/판정/후딜이 눈에 보여야 튜닝할 수 있다
    const phase = entity.action.currentPhase;
    if (phase !== 'IDLE') {
      const colors: Record<string, string> = {
        STARTUP: '#fbbf24',
        ACTIVE: '#ef4444',
        RECOVERY: '#38bdf8',
      };
      ctx.fillStyle = colors[phase] ?? '#94a3b8';
      ctx.fillRect(p.x - 18, p.y - r - 26, 36, 5);
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(phase, p.x, p.y - r - 30);
    }

    // 자세 게이지
    const poiseWidth = 44;
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(p.x - poiseWidth / 2, p.y + r + 8, poiseWidth, 4);
    ctx.fillStyle = entity.poise.isGroggy(this.now) ? '#f97316' : '#fde68a';
    ctx.fillRect(p.x - poiseWidth / 2, p.y + r + 8, poiseWidth * entity.poise.ratio, 4);

    // HP
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(p.x - poiseWidth / 2, p.y + r + 14, poiseWidth, 4);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(p.x - poiseWidth / 2, p.y + r + 14, poiseWidth * entity.hpRatio, 4);
  }

  private renderFloaters(): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (let i = this.floaters.length - 1; i >= 0; i -= 1) {
      const floater = this.floaters[i] as FloatingText;
      const age = this.now - floater.bornAt;
      if (age > 900) {
        this.floaters.splice(i, 1);
        continue;
      }
      const p = this.toScreen(floater.pos);
      ctx.globalAlpha = 1 - age / 900;
      ctx.fillStyle = floater.color;
      ctx.font = `700 ${floater.size}px "Pretendard", system-ui, sans-serif`;
      ctx.fillText(floater.text, p.x, p.y - 30 - age / 22);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------ HUD 값 ----------------------------- */

  hudState() {
    return {
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      mp: this.player.mp,
      maxMp: this.player.opts.maxMp,
      stamina: this.player.stamina.value,
      maxStamina: this.player.stamina.max,
      poise: this.player.poise.ratio,
      dummyPoise: this.dummy.poise.ratio,
      dummyGroggy: this.dummy.poise.isGroggy(this.now),
      groggyRemaining: this.dummy.poise.groggyRemaining(this.now),
      combo: this.player.action.combo,
      phase: this.player.action.currentPhase,
      guarding: this.player.guard.isGuarding,
      vulnerable: this.player.stamina.isVulnerable(this.now),
      cooldowns: SWORDSMAN_SKILLS.map((id) => ({
        id,
        name: (SKILL_BY_ID.get(id) as SkillDef).name,
        remaining: this.player.cooldownRemaining(id, this.now),
        total: (SKILL_BY_ID.get(id) as SkillDef).cooldownMs,
      })),
    };
  }
}
