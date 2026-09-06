/**
 * 에테르니아 클라이언트 진입점.
 *
 * 기획서 2-1은 PixiJS를 권하지만, M1에서 검증해야 하는 것은 렌더러가 아니라
 * **히트박스 판정과 프레임 데이터**다. 그래서 렌더 레이어는 의존성 없는
 * Canvas 2D로 얇게 두고, 판정은 전부 @eternia/shared(서버와 같은 코드)에 맡겼다.
 * 렌더러 교체는 scenes/TrainingScene.ts의 render 메서드만 건드리면 된다.
 */
import './style.css';
import './game.css';
import { dataSummary } from '@eternia/shared';
import { TrainingScene } from './scenes/TrainingScene.js';
import { renderCodex } from './ui/codex.js';
import { renderGame, stopGame } from './ui/game.js';
import { renderNickname } from './ui/nickname.js';
import { renderRoadmap } from './ui/roadmap.js';

type TabId = 'adventure' | 'training' | 'codex' | 'nickname' | 'roadmap';

const TABS: { id: TabId; label: string }[] = [
  { id: 'adventure', label: '⚔ 모험 시작' },
  { id: 'training', label: '훈련장' },
  { id: 'codex', label: '도감' },
  { id: 'nickname', label: '닉네임 검증기' },
  { id: 'roadmap', label: '구현 현황' },
];

const app = document.querySelector<HTMLDivElement>('#app') as HTMLDivElement;
const summary = dataSummary();

let scene: TrainingScene | null = null;
let current: TabId = 'adventure';

function shell(): void {
  app.innerHTML = `
    <header class="masthead">
      <h1>에테르니아 — 균열의 기록</h1>
      <div class="sub">
        Eternia: Chronicle of the Rift · 논타겟 액션 멀티플레이 오픈월드 RPG
      </div>
      <div class="meta">
        <span class="chip">맵 <strong>${summary.maps}</strong></span>
        <span class="chip">직업 <strong>${summary.classes + summary.hiddenClasses}</strong></span>
        <span class="chip">스킬 <strong>${summary.skills}</strong></span>
        <span class="chip">아이템 <strong>${summary.items}</strong></span>
        <span class="chip">퀘스트 <strong>${summary.quests}</strong></span>
        <span class="chip">던전 <strong>${summary.dungeons}</strong></span>
        <span class="chip">레이드 <strong>${summary.raids}</strong></span>
      </div>
    </header>
    <nav class="tabs">
      ${TABS.map((tab) => `<button data-tab="${tab.id}" aria-selected="${tab.id === current}">${tab.label}</button>`).join('')}
    </nav>
    <main id="view"></main>
    <footer>
      기획서 <code>에테르니아_RPG_기획서_v2.md</code> 기반 구현 ·
      판정 로직은 클라이언트와 서버가 공유한다 (<code>@eternia/shared</code>) ·
      <a href="https://github.com/yeonny3209/eternia" target="_blank" rel="noreferrer">소스</a>
    </footer>`;

  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.tab as TabId;
      if (next === current) return;
      current = next;
      shell();
    });
  });

  route();
}

function route(): void {
  const view = app.querySelector<HTMLElement>('#view') as HTMLElement;
  scene?.stop();
  scene = null;
  stopGame();
  document.querySelectorAll('.side-panel, .modal-backdrop').forEach((n) => n.remove());

  switch (current) {
    case 'adventure':
      renderGame(view);
      break;
    case 'training':
      renderTraining(view);
      break;
    case 'codex':
      renderCodex(view);
      break;
    case 'nickname':
      renderNickname(view);
      break;
    case 'roadmap':
      renderRoadmap(view);
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 훈련장 화면                                                          */
/* ------------------------------------------------------------------ */

function renderTraining(view: HTMLElement): void {
  view.innerHTML = `
    <div class="arena-layout">
      <div class="panel">
        <h2>허수아비 훈련장</h2>
        <p class="hint">
          기획서 M1의 검증 씬이다. 회피 무적 프레임 · 패리 판정 창 · 자세 붕괴가
          실제로 동작하는지 손으로 확인하는 것이 목적이다.
          <strong>허수아비도 주기적으로 반격한다</strong> — 붉은 부채꼴이 예고다.
        </p>
        <canvas id="arena" width="760" height="430"></canvas>

        <div class="hud">
          <div class="bar">
            <span>HP</span>
            <div class="track"><div class="fill" id="hp-fill" style="background:#4ade80"></div></div>
            <span class="val" id="hp-val"></span>
          </div>
          <div class="bar">
            <span>스태미나</span>
            <div class="track"><div class="fill" id="st-fill" style="background:#38bdf8"></div></div>
            <span class="val" id="st-val"></span>
          </div>
          <div class="bar">
            <span>내 자세</span>
            <div class="track"><div class="fill" id="po-fill" style="background:#fde68a"></div></div>
            <span class="val" id="po-val"></span>
          </div>
          <div class="bar">
            <span>적 자세</span>
            <div class="track"><div class="fill" id="dp-fill" style="background:#f97316"></div></div>
            <span class="val" id="dp-val"></span>
          </div>
        </div>

        <div class="skillbar" id="skillbar"></div>

        <div class="statgrid" id="statgrid"></div>
      </div>

      <div class="panel tuning">
        <h2 style="font-size:15px">프레임 튜닝</h2>
        <p class="hint" style="margin-bottom:0">
          기획서 M1: "프레임 수치는 전부 JSON으로 빼서 바로 튜닝할 수 있게 해줘."
          값을 바꾸면 즉시 적용된다.
        </p>

        <label>기본 공격 선딜 <span id="v-startup"></span></label>
        <input type="range" id="t-startup" min="40" max="600" step="10" />

        <label>기본 공격 판정 <span id="v-active"></span></label>
        <input type="range" id="t-active" min="30" max="400" step="10" />

        <label>기본 공격 후딜 <span id="v-recovery"></span></label>
        <input type="range" id="t-recovery" min="60" max="900" step="10" />

        <label>회피 무적 프레임 <span id="v-iframe"></span></label>
        <input type="range" id="t-iframe" min="60" max="700" step="10" />

        <label>회피 동작 전체 <span id="v-dodge"></span></label>
        <input type="range" id="t-dodge" min="200" max="1200" step="20" />

        <label>패리 판정 창 <span id="v-parry"></span></label>
        <input type="range" id="t-parry" min="60" max="600" step="10" />

        <div class="row">
          <input type="checkbox" id="t-hitbox" checked />
          <label for="t-hitbox" style="margin:0">히트박스 표시</label>
        </div>

        <button class="action" id="reset">초기화</button>

        <h3>조작</h3>
        <div class="keycaps">
          <kbd>WASD</kbd><span>8방향 이동</span>
          <kbd>마우스</kbd><span>조준 (항상 커서를 본다)</span>
          <kbd>좌클릭</kbd><span>기본 공격 3연타 콤보</span>
          <kbd>우클릭</kbd><span>가드 / 패리 (누르고 있기)</span>
          <kbd>Space</kbd><span>회피 구르기 (무적)</span>
          <kbd>Q</kbd><span>방패 강타 (스턴)</span>
          <kbd>E</kbd><span>대지 가르기 (광역)</span>
          <kbd>R</kbd><span>처형 선언 (궁극)</span>
        </div>

        <h3>보는 법</h3>
        <p class="hint" style="margin:0">
          캐릭터 위 색 막대가 현재 페이즈다.
          <span style="color:#fbbf24">노랑=선딜</span> ·
          <span style="color:#ef4444">빨강=판정</span> ·
          <span style="color:#38bdf8">파랑=후딜</span>.
          후딜에서만 회피·다른 스킬로 캔슬된다.
        </p>
      </div>
    </div>`;

  const canvas = view.querySelector<HTMLCanvasElement>('#arena') as HTMLCanvasElement;

  // 캔버스를 표시 크기에 맞춘다
  const resize = () => {
    const width = Math.max(320, Math.floor(canvas.clientWidth));
    canvas.width = width;
    canvas.height = Math.round(width * 0.565);
  };
  resize();
  window.addEventListener('resize', resize);

  scene = new TrainingScene(canvas);

  const bindRange = (
    id: keyof typeof rangeMap,
    key: 'startupMs' | 'activeMs' | 'recoveryMs' | 'iframeMs' | 'dodgeDurationMs' | 'parryWindowMs',
    labelId: string,
  ) => {
    const input = view.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    const label = view.querySelector<HTMLSpanElement>(`#${labelId}`) as HTMLSpanElement;
    input.value = String((scene as TrainingScene).tuning[key]);
    label.textContent = `${input.value}ms`;
    input.addEventListener('input', () => {
      label.textContent = `${input.value}ms`;
      scene?.applyTuning({ [key]: Number(input.value) });
    });
  };

  const rangeMap = {
    't-startup': 1,
    't-active': 1,
    't-recovery': 1,
    't-iframe': 1,
    't-dodge': 1,
    't-parry': 1,
  } as const;

  bindRange('t-startup', 'startupMs', 'v-startup');
  bindRange('t-active', 'activeMs', 'v-active');
  bindRange('t-recovery', 'recoveryMs', 'v-recovery');
  bindRange('t-iframe', 'iframeMs', 'v-iframe');
  bindRange('t-dodge', 'dodgeDurationMs', 'v-dodge');
  bindRange('t-parry', 'parryWindowMs', 'v-parry');

  const hitboxToggle = view.querySelector<HTMLInputElement>('#t-hitbox') as HTMLInputElement;
  hitboxToggle.addEventListener('change', () => {
    if (scene) scene.tuning.showHitboxes = hitboxToggle.checked;
  });

  view.querySelector<HTMLButtonElement>('#reset')?.addEventListener('click', () => scene?.reset());

  /* HUD 갱신 */
  const el = (id: string) => view.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
  const skillbar = el('skillbar');
  const statgrid = el('statgrid');

  scene.onStats = (stats, self) => {
    const hud = self.hudState();

    el('hp-fill').style.width = `${(hud.hp / hud.maxHp) * 100}%`;
    el('hp-val').textContent = `${Math.round(hud.hp)} / ${hud.maxHp}`;
    el('st-fill').style.width = `${(hud.stamina / hud.maxStamina) * 100}%`;
    el('st-val').textContent = hud.vulnerable ? '무방비!' : `${Math.round(hud.stamina)}`;
    el('po-fill').style.width = `${hud.poise * 100}%`;
    el('po-val').textContent = `${Math.round(hud.poise * 100)}%`;
    el('dp-fill').style.width = `${hud.dummyPoise * 100}%`;
    el('dp-val').textContent = hud.dummyGroggy
      ? `그로기 ${(hud.groggyRemaining / 1000).toFixed(1)}s`
      : `${Math.round(hud.dummyPoise * 100)}%`;

    const keys = ['클릭', 'Q', 'E', 'R'];
    skillbar.innerHTML = hud.cooldowns
      .map((cooldown, index) => {
        const overlay =
          cooldown.remaining > 0
            ? `<div class="cd">${(cooldown.remaining / 1000).toFixed(1)}</div>`
            : '';
        return `<div class="skill">
          <div class="key">${keys[index]}</div>
          <div class="nm">${cooldown.name}</div>
          ${overlay}
        </div>`;
      })
      .join('');

    statgrid.innerHTML = `
      <div><div class="n">${stats.hits}</div><div class="l">명중</div></div>
      <div><div class="n">${stats.parries}</div><div class="l">패리</div></div>
      <div><div class="n">${stats.iframeSaves}</div><div class="l">무적 회피</div></div>
      <div><div class="n">${stats.groggyBreaks}</div><div class="l">자세 붕괴</div></div>
      <div><div class="n">${stats.dodges}</div><div class="l">구르기</div></div>
      <div><div class="n">${(stats.totalDamage / 1000).toFixed(1)}k</div><div class="l">누적 피해</div></div>`;
  };

  scene.start();
}

shell();
