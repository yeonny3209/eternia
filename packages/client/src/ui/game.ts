/**
 * 게임 화면 — 캐릭터 생성 → 오픈월드 → HUD·패널.
 *
 * 퀘스트 진행은 @eternia/shared의 엔진을 그대로 쓰고, 진행도만
 * PlayerState에 얹어 localStorage에 저장한다.
 */
import {
  EQUIP_SLOTS,
  ITEM_BY_ID,
  MAP_BY_ID,
  NPC_BY_ID,
  POI_BY_ID,
  MONSTER_BY_ID,
  QUEST_BY_ID,
  RARITY_META,
  applyEvent,
  checkNickname,
  rollItem,
  describeAffix,
  initProgress,
  nicknameKey,
  prerequisitesMet,
  suggestNickname,
  CLASSES,
  MAX_LEVEL,
  type EquipSlot,
  type GameEvent,
  type ItemInstance,
  type QuestDef,
  type QuestProgress,
} from '@eternia/shared';
import { WorldScene, PPM } from '../world/WorldScene.js';
import { WORLD_LAYOUT, generateMap } from '../world/mapgen.js';
import {
  BACKGROUNDS,
  createPlayer,
  derivedStats,
  dropItem,
  addItem,
  equipItem,
  expProgress,
  gainExp,
  hasSave,
  isEquipped,
  load,
  save,
  unequipSlot,
  clearSave,
  type PlayerState,
} from '../world/player.js';

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );

let scene: WorldScene | null = null;
let player: PlayerState | null = null;
let openPanel: 'NONE' | 'INVENTORY' | 'QUEST' | 'MAP' | 'CHARACTER' = 'NONE';
let modal: HTMLElement | null = null;

export function stopGame(): void {
  scene?.stop();
  scene = null;
}

/* ================================================================== */
/* 진입                                                                */
/* ================================================================== */

export function renderGame(root: HTMLElement): void {
  const existing = load();
  if (existing) {
    player = existing;
    mountWorld(root);
  } else {
    renderCreation(root);
  }
}

/* ================================================================== */
/* 캐릭터 생성 (기획서 4-1 / 4-2 / 4-3)                                 */
/* ================================================================== */

function renderCreation(root: HTMLElement): void {
  const backgrounds = Object.entries(BACKGROUNDS);
  root.innerHTML = `
    <div class="panel create">
      <h2>모험가 등록</h2>
      <p class="hint">
        기획서 4-1의 의도적 설계: <strong>직업은 지금 고르지 않는다.</strong>
        5레벨에 도달하면 신전에서 10개 직업 중 하나를 정하게 된다.
      </p>

      <h3>닉네임</h3>
      <div class="nick-input">
        <input id="c-nick" type="text" placeholder="한글 2~8자 / 영문 4~16자" autocomplete="off" spellcheck="false" maxlength="16" />
        <button id="c-suggest" type="button">추천</button>
      </div>
      <div id="c-verdict" class="verdict">닉네임을 입력하세요</div>

      <h3>시작 배경</h3>
      <div class="bg-grid">
        ${backgrounds
          .map(
            ([id, bg], index) => `
          <button class="bg-card" data-bg="${id}" aria-selected="${index === 0}">
            <strong>${esc(bg.name)}</strong>
            <span>${esc(bg.note)}</span>
          </button>`,
          )
          .join('')}
      </div>

      <button class="action primary" id="c-start" disabled>세계로 나선다</button>
      ${hasSave() ? '<button class="action" id="c-continue">이어하기</button>' : ''}
    </div>`;

  const input = root.querySelector<HTMLInputElement>('#c-nick') as HTMLInputElement;
  const verdict = root.querySelector<HTMLDivElement>('#c-verdict') as HTMLDivElement;
  const startButton = root.querySelector<HTMLButtonElement>('#c-start') as HTMLButtonElement;
  let selectedBackground = backgrounds[0]?.[0] as keyof typeof BACKGROUNDS;
  let nicknameOk = false;

  const evaluate = () => {
    const raw = input.value;
    if (raw.trim().length === 0) {
      verdict.className = 'verdict';
      verdict.textContent = '닉네임을 입력하세요';
      nicknameOk = false;
    } else {
      const result = checkNickname(raw, false);
      nicknameOk = result.ok;
      verdict.className = `verdict ${result.ok ? 'ok' : 'bad'}`;
      verdict.innerHTML = result.ok
        ? `✅ 사용할 수 있습니다 <code>${nicknameKey(raw)}</code>`
        : `❌ ${esc(result.message)}`;
    }
    startButton.disabled = !nicknameOk;
  };

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(evaluate, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && nicknameOk) startButton.click();
  });

  root.querySelector('#c-suggest')?.addEventListener('click', () => {
    input.value = suggestNickname();
    evaluate();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-bg]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedBackground = button.dataset.bg as keyof typeof BACKGROUNDS;
      root.querySelectorAll('[data-bg]').forEach((b) => b.setAttribute('aria-selected', 'false'));
      button.setAttribute('aria-selected', 'true');
    });
  });

  startButton.addEventListener('click', () => {
    if (!nicknameOk) return;
    player = createPlayer(input.value.trim(), selectedBackground);
    save(player);
    mountWorld(root);
  });

  root.querySelector('#c-continue')?.addEventListener('click', () => {
    const existing = load();
    if (existing) {
      player = existing;
      mountWorld(root);
    }
  });

  input.focus();
}

/* ================================================================== */
/* 월드                                                                */
/* ================================================================== */

function mountWorld(root: HTMLElement): void {
  const state = player as PlayerState;

  root.innerHTML = `
    <div class="game-wrap">
      <div class="game-stage">
        <canvas id="world"></canvas>

        <div class="hud-top">
          <div class="hud-name">
            <strong id="h-name"></strong>
            <span id="h-class"></span>
          </div>
          <div class="hud-bars">
            <div class="hbar"><i id="h-hp"></i><b id="h-hp-t"></b></div>
            <div class="hbar mp"><i id="h-mp"></i><b id="h-mp-t"></b></div>
            <div class="hbar st"><i id="h-st"></i></div>
            <div class="hbar xp"><i id="h-xp"></i><b id="h-xp-t"></b></div>
          </div>
          <div class="hud-place">
            <strong id="h-map"></strong>
            <span id="h-gold"></span>
          </div>
        </div>

        <div class="hud-quest" id="h-quest"></div>
        <canvas class="minimap" id="minimap" width="150" height="150"></canvas>
        <div class="toasts" id="toasts"></div>

        <div class="hud-bottom">
          <div class="hotbar" id="hotbar"></div>
          <div class="hud-keys">
            <span><kbd>WASD</kbd> 이동</span>
            <span><kbd>클릭</kbd> 공격</span>
            <span><kbd>우클릭</kbd> 가드</span>
            <span><kbd>Space</kbd> 회피</span>
            <span><kbd>1</kbd> 물약</span>
            <span><kbd>E</kbd> 상호작용</span>
            <span><kbd>I</kbd> 가방</span>
            <span><kbd>J</kbd> 퀘스트</span>
            <span><kbd>M</kbd> 지도</span>
            <span><kbd>C</kbd> 캐릭터</span>
          </div>
        </div>
      </div>
      <div id="panel-host"></div>
    </div>`;

  const canvas = root.querySelector<HTMLCanvasElement>('#world') as HTMLCanvasElement;
  const resize = () => {
    const width = Math.max(360, Math.floor(canvas.clientWidth));
    canvas.width = width;
    canvas.height = Math.round(Math.min(620, Math.max(360, width * 0.58)));
  };
  resize();
  window.addEventListener('resize', resize);

  scene = new WorldScene(canvas, state, {
    onToast: (text, kind) => toast(text, kind),
    onKill: (monsterId) => {
      pushQuestEvent({ type: 'KILL', target: monsterId });
    },
    onLoot: (instance) => {
      const def = ITEM_BY_ID.get(instance.itemId);
      if (def) toast(`${def.name} 획득`, 'LOOT');
      pushQuestEvent({ type: 'COLLECT', target: instance.itemId });
    },
    onLevelUp: (level, needsClassChoice) => {
      toast(`레벨 ${level} 달성!`, 'LEVEL');
      if (needsClassChoice) showClassChoice();
    },
    onEnterMap: (mapId) => {
      const def = MAP_BY_ID.get(mapId);
      if (def) toast(`${def.name} (권장 Lv ${def.levelRange[0]}~${def.levelRange[1]})`, 'INFO');
      pushQuestEvent({ type: 'REACH', target: mapId });
      persist();
    },
    onInteractNpc: (npcId) => showDialogue(npcId),
    onInteractPoi: (poiId, name) => {
      // 장소는 '방문'이자 '사용'이다 — 두 목표 타입 모두에 흘려보낸다
      pushQuestEvent({ type: 'REACH', target: poiId });
      pushQuestEvent({ type: 'USE', target: poiId });
      toast(`${name} 조사`, 'QUEST');
    },
    onPotionUsed: (remaining) => toast(`물약 사용 (${remaining}개 남음)`, 'INFO'),
    onPlayerDeath: () => showDeath(),
    onStateChanged: () => {
      persist();
      refreshHud();
    },
  });

  scene.start();
  bindPanelKeys();

  // 디버깅용 훅 — 콘솔에서 상태를 들여다볼 수 있게 열어 둔다
  (window as unknown as Record<string, unknown>).__eternia = {
    get scene() {
      return scene;
    },
    get player() {
      return player;
    },
  };
  refreshHud();
  setInterval(refreshHud, 120);
  setInterval(persist, 8000);
}

function persist(): void {
  if (player) save(player);
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function refreshHud(): void {
  if (!scene || !player) return;
  const hud = scene.hud();
  const stats = derivedStats(player);
  const xp = expProgress(player);
  const mapDef = MAP_BY_ID.get(player.mapId);

  const el = (id: string) => document.getElementById(id);
  const setWidth = (id: string, ratio: number) => {
    const node = el(id);
    if (node) node.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  };

  const name = el('h-name');
  if (name) name.textContent = `${player.nickname}  Lv.${player.level}`;
  const klass = el('h-class');
  if (klass) {
    const classDef = CLASSES.find((c) => c.id === player?.classId);
    klass.textContent = classDef ? classDef.name : player.level >= 5 ? '직업 미정' : '모험가';
  }

  setWidth('h-hp', hud.hp / hud.maxHp);
  setWidth('h-mp', hud.maxMp > 0 ? hud.mp / hud.maxMp : 0);
  setWidth('h-st', hud.stamina / hud.maxStamina);
  setWidth('h-xp', xp.ratio);

  const hpText = el('h-hp-t');
  if (hpText) hpText.textContent = `${Math.round(hud.hp)} / ${hud.maxHp}`;
  const mpText = el('h-mp-t');
  if (mpText) mpText.textContent = `${Math.round(hud.mp)} / ${hud.maxMp}`;
  const xpText = el('h-xp-t');
  if (xpText) {
    xpText.textContent =
      player.level >= MAX_LEVEL ? `각성 AP ${player.awakenPoint}` : `${xp.current} / ${xp.required}`;
  }

  const mapName = el('h-map');
  if (mapName) mapName.textContent = mapDef?.name ?? player.mapId;
  const gold = el('h-gold');
  if (gold) gold.textContent = `${player.gold.toLocaleString('ko-KR')} G · ATK ${stats.atk} · DEF ${stats.def}`;

  // 핫바
  const hotbar = el('hotbar');
  if (hotbar) {
    const slots = [
      `<div class="slot"><span class="k">클릭</span><span class="n">${esc(hud.basicAttackName)}</span></div>`,
      `<div class="slot ${hud.potions === 0 ? 'empty' : ''}"><span class="k">1</span><span class="n">물약 ×${hud.potions}</span></div>`,
      ...hud.cooldowns.map((cooldown) => {
        const overlay =
          cooldown.remaining > 0
            ? `<span class="cd">${(cooldown.remaining / 1000).toFixed(1)}</span>`
            : '';
        return `<div class="slot"><span class="k">${cooldown.key}</span><span class="n">${esc(cooldown.name)}</span>${overlay}</div>`;
      }),
    ];
    hotbar.innerHTML = slots.join('');
  }

  renderQuestTracker();
  renderMinimap(hud);
}

function renderQuestTracker(): void {
  const host = document.getElementById('h-quest');
  if (!host || !player) return;
  const active = player.quests.filter((q) => q.state === 'ACTIVE' || q.state === 'COMPLETE').slice(0, 3);
  if (active.length === 0) {
    host.innerHTML = '<div class="qt-empty">NPC에게 말을 걸어 퀘스트를 받으세요</div>';
    return;
  }
  host.innerHTML = active
    .map((progress) => {
      const def = QUEST_BY_ID.get(progress.questId);
      if (!def) return '';
      const lines = progress.objectives
        .map((objective, index) => {
          const spec = def.objectives[index];
          const label = objectiveLabel(spec);
          const done = objective.done ? '✔' : '·';
          return `<li class="${objective.done ? 'done' : ''}">${done} ${esc(label)} <b>${objective.current}/${objective.required}</b></li>`;
        })
        .join('');
      return `<div class="qt"><strong>${esc(def.title)}</strong>${progress.state === 'COMPLETE' ? '<em>완료 — 보고하세요</em>' : ''}<ul>${lines}</ul></div>`;
    })
    .join('');
}

function objectiveLabel(spec: QuestDef['objectives'][number] | undefined): string {
  if (!spec) return '';
  const target = spec.target ?? '';
  const name =
    target.startsWith('mob_') || target.startsWith('boss_')
      ? (MONSTER_BY_ID.get(target)?.name ?? monsterName(target))
      : target.startsWith('item_')
        ? (ITEM_BY_ID.get(target)?.name ?? target)
        : target.startsWith('npc_')
          ? (NPC_BY_ID.get(target)?.name ?? target)
          : target.startsWith('poi_')
            ? (POI_BY_ID.get(target)?.name ?? target)
            : target.startsWith('choice_')
              ? '선택'
              : (MAP_BY_ID.get(target)?.name ?? target);
  const verb: Record<string, string> = {
    KILL: '처치',
    COLLECT: '수집',
    TALK: '대화',
    REACH: '방문',
    ESCORT: '호위',
    DEFEND: '방어',
    USE: '사용',
    CRAFT: '제작',
    SURVIVE: '생존',
    CHOICE: '선택',
  };
  return `${name} ${verb[spec.type] ?? spec.type}`;
}

function monsterName(id: string): string {
  return MONSTER_BY_ID.get(id)?.name ?? id.replace(/^(mob|boss)_/, '').replace(/_/g, ' ');
}

function renderMinimap(hud: ReturnType<WorldScene['hud']>): void {
  const canvas = document.getElementById('minimap') as HTMLCanvasElement | null;
  if (!canvas || !scene || !player) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const map = scene.map;
  const scale = Math.min(canvas.width / map.width, canvas.height / map.height);
  const ox = (canvas.width - map.width * scale) / 2;
  const oy = (canvas.height - map.height * scale) / 2;
  const toMini = (p: { x: number; y: number }) => ({ x: ox + p.x * scale, y: oy + p.y * scale });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(8,12,22,0.82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = map.biome.ground;
  ctx.fillRect(ox, oy, map.width * scale, map.height * scale);

  ctx.fillStyle = 'rgba(120,150,120,0.45)';
  for (const obstacle of map.obstacles) {
    const p = toMini(obstacle.pos);
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }

  ctx.fillStyle = '#c4b5fd';
  for (const portal of map.portals) {
    const p = toMini(portal.pos);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#fde047';
  for (const poi of map.pois) {
    const p = toMini(poi.pos);
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }

  ctx.fillStyle = '#fb923c';
  for (const campfire of map.campfires) {
    const p = toMini(campfire);
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }

  for (const monster of hud.monsters) {
    const p = toMini(monster.pos);
    ctx.fillStyle = monster.boss ? '#ef4444' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(p.x, p.y, monster.boss ? 3 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const me = toMini(hud.pos);
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.arc(me.x, me.y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* 토스트                                                               */
/* ------------------------------------------------------------------ */

function toast(text: string, kind: string): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast ${kind.toLowerCase()}`;
  node.textContent = text;
  host.appendChild(node);
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3200);
  while (host.children.length > 5) host.firstChild?.remove();
}

/* ------------------------------------------------------------------ */
/* 퀘스트                                                               */
/* ------------------------------------------------------------------ */

function pushQuestEvent(event: GameEvent): void {
  if (!player) return;
  let changed = false;
  player.quests = player.quests.map((progress) => {
    const def = QUEST_BY_ID.get(progress.questId);
    if (!def || progress.state !== 'ACTIVE') return progress;
    const result = applyEvent(def, progress, event);
    if (result.changed) {
      changed = true;
      if (result.completed) toast(`퀘스트 완료: ${def.title}`, 'QUEST');
    }
    return result.progress;
  });
  if (changed) {
    persist();
    renderQuestTracker();
  }
}

function acceptQuest(questId: string): void {
  if (!player) return;
  const def = QUEST_BY_ID.get(questId);
  if (!def) return;
  if (player.quests.some((q) => q.questId === questId)) return;
  player.quests.push(initProgress(def));
  toast(`퀘스트 수락: ${def.title}`, 'QUEST');
  persist();
  renderQuestTracker();
}

function turnInQuest(questId: string): void {
  if (!player) return;
  const def = QUEST_BY_ID.get(questId);
  const progress = player.quests.find((q) => q.questId === questId);
  if (!def || !progress || progress.state !== 'COMPLETE') return;

  player.quests = player.quests.filter((q) => q.questId !== questId);
  player.completedQuests.push(questId);
  player.gold += def.rewards.gold;
  if (def.rewards.skillPoint) player.skillPoints += def.rewards.skillPoint;

  // 보상 아이템 — 개수만큼 굴려서 넣는다
  for (const [itemId, count] of def.rewards.items ?? []) {
    const itemDef = ITEM_BY_ID.get(itemId);
    if (!itemDef) continue;
    for (let i = 0; i < count; i += 1) {
      const instance = rollItem(
        itemDef,
        Math.random,
        `it_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}_${i}`,
      );
      if (!addItem(player, instance)) {
        toast('가방이 가득 차 보상을 못 받았습니다', 'DANGER');
        break;
      }
      toast(`${itemDef.name} 획득`, 'LOOT');
    }
  }

  grantExp(def.rewards.exp);

  toast(`보상: ${def.rewards.exp} EXP, ${def.rewards.gold} G`, 'QUEST');
  persist();
  refreshHud();
}

/**
 * 퀘스트 보상 경험치.
 * 레벨업 시 전투 수치를 다시 만들어야 하므로 씬을 거쳐 처리한다 —
 * 안 그러면 레벨은 올랐는데 HP 상한이 그대로인 상태가 된다.
 */
function grantExp(amount: number): void {
  if (!player) return;
  const result = gainExp(player, amount);
  if (result.levelsGained > 0) {
    scene?.rebuildHero();
    toast(`레벨 ${result.newLevel} 달성!`, 'LEVEL');
    if (result.needsClassChoice) showClassChoice();
  }
  refreshHud();
}

/* ------------------------------------------------------------------ */
/* 모달                                                                 */
/* ------------------------------------------------------------------ */

function closeModal(): void {
  modal?.remove();
  modal = null;
  scene?.setPaused(false);
}

function openModal(html: string, options: { dismissable?: boolean } = {}): HTMLElement {
  closeModal();
  scene?.setPaused(true);
  const node = document.createElement('div');
  node.className = 'modal-backdrop';
  node.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(node);
  modal = node;
  if (options.dismissable !== false) {
    node.addEventListener('click', (e) => {
      if (e.target === node) closeModal();
    });
  }
  return node;
}

function showDialogue(npcId: string): void {
  if (!player) return;
  const npc = NPC_BY_ID.get(npcId);

  // 대화 자체가 퀘스트 목표일 수 있다. 화면을 그리기 **전에** 반영해야
  // "말을 걸었더니 완료됐는데 보고 버튼이 없는" 상황이 안 생긴다.
  pushQuestEvent({ type: 'TALK', target: npcId });

  const completed = new Set(player.completedQuests);

  const offered = [...QUEST_BY_ID.values()].filter(
    (quest) =>
      quest.giver === npcId &&
      quest.type !== 'HIDDEN' &&
      !completed.has(quest.id) &&
      !player?.quests.some((q) => q.questId === quest.id) &&
      prerequisitesMet(quest, completed),
  );

  const turnIns = player.quests.filter((progress) => {
    const def = QUEST_BY_ID.get(progress.questId);
    return def?.giver === npcId && progress.state === 'COMPLETE';
  });

  const inProgress = player.quests.filter((progress) => {
    const def = QUEST_BY_ID.get(progress.questId);
    return def?.giver === npcId && progress.state === 'ACTIVE';
  });

  const body = `
    <h3 class="dlg-name">${esc(npc?.name ?? npcId)}</h3>
    ${
      turnIns.length > 0
        ? `<h4>보고</h4>${turnIns
            .map((progress) => {
              const def = QUEST_BY_ID.get(progress.questId) as QuestDef;
              return `<div class="quest-offer complete">
                <strong>${esc(def.title)}</strong>
                <p>${esc(def.summary ?? '')}</p>
                <p class="reward">보상 · ${def.rewards.exp} EXP · ${def.rewards.gold} G</p>
                <button class="action primary" data-turnin="${def.id}">보상 받기</button>
              </div>`;
            })
            .join('')}`
        : ''
    }
    ${
      offered.length > 0
        ? `<h4>의뢰</h4>${offered
            .map(
              (quest) => `<div class="quest-offer">
                <strong>${esc(quest.title)}</strong>
                <span class="tag">${quest.type} · 권장 Lv${quest.level}</span>
                <p>${esc(quest.summary ?? '')}</p>
                <ul>${quest.objectives.map((o) => `<li>${esc(objectiveLabel(o))} ${o.count ?? 1}</li>`).join('')}</ul>
                <p class="reward">보상 · ${quest.rewards.exp} EXP · ${quest.rewards.gold} G</p>
                <button class="action" data-accept="${quest.id}">수락</button>
              </div>`,
            )
            .join('')}`
        : ''
    }
    ${
      inProgress.length > 0
        ? `<h4>진행 중</h4>${inProgress
            .map((progress) => {
              const def = QUEST_BY_ID.get(progress.questId) as QuestDef;
              return `<div class="quest-offer dim"><strong>${esc(def.title)}</strong>
                <p>${progress.objectives.map((o) => `${o.current}/${o.required}`).join(' · ')}</p></div>`;
            })
            .join('')}`
        : ''
    }
    ${
      offered.length === 0 && turnIns.length === 0 && inProgress.length === 0
        ? '<p class="hint">지금은 부탁할 일이 없다고 합니다.</p>'
        : ''
    }
    <button class="action" data-close>닫기</button>`;

  const node = openModal(body);

  node.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach((button) =>
    button.addEventListener('click', () => {
      acceptQuest(button.dataset.accept as string);
      closeModal();
    }),
  );
  node.querySelectorAll<HTMLButtonElement>('[data-turnin]').forEach((button) =>
    button.addEventListener('click', () => {
      turnInQuest(button.dataset.turnin as string);
      closeModal();
    }),
  );
  node.querySelector('[data-close]')?.addEventListener('click', closeModal);
}

function showClassChoice(): void {
  const body = `
    <h3>직업 선택</h3>
    <p class="hint">
      기획서 4-1: 튜토리얼 동안 무기를 체험한 뒤 5레벨에 직업을 정한다.
      한 번 정하면 30레벨 이후 '전직 서약서'가 있어야 바꿀 수 있다.
    </p>
    <div class="class-grid">
      ${CLASSES.map(
        (klass) => `
        <button class="class-card" data-class="${klass.id}">
          <strong>${esc(klass.name)}</strong>
          <span class="tag">${'★'.repeat(klass.difficulty)}${'☆'.repeat(5 - klass.difficulty)} · ${klass.roles.join('/')}</span>
          <p>${esc(klass.concept)}</p>
        </button>`,
      ).join('')}
    </div>`;

  const node = openModal(body, { dismissable: false });
  node.querySelectorAll<HTMLButtonElement>('[data-class]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!player) return;
      player.classId = button.dataset.class as string;
      scene?.rebuildHero();
      const klass = CLASSES.find((c) => c.id === player?.classId);
      toast(`${klass?.name ?? ''} 가 되었습니다`, 'LEVEL');
      persist();
      refreshHud();
      closeModal();
    }),
  );
}

function showDeath(): void {
  const node = openModal(
    `<h3>쓰러졌습니다</h3>
     <p class="hint">가장 가까운 모닥불에서 다시 일어납니다.</p>
     <button class="action primary" data-respawn>부활</button>`,
    { dismissable: false },
  );
  node.querySelector('[data-respawn]')?.addEventListener('click', () => {
    scene?.respawn();
    closeModal();
  });
}

/* ------------------------------------------------------------------ */
/* 패널 (I / J / M / C)                                                 */
/* ------------------------------------------------------------------ */

function bindPanelKeys(): void {
  window.addEventListener('keydown', (e) => {
    if (modal) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    const key = e.key.toLowerCase();
    const map: Record<string, typeof openPanel> = {
      i: 'INVENTORY',
      j: 'QUEST',
      m: 'MAP',
      c: 'CHARACTER',
    };
    if (map[key]) {
      e.preventDefault();
      openPanel = openPanel === map[key] ? 'NONE' : (map[key] as typeof openPanel);
      renderPanel();
    }
    if (key === 'escape') {
      openPanel = 'NONE';
      renderPanel();
    }
  });
}

function renderPanel(): void {
  const host = document.getElementById('panel-host');
  if (!host || !player) return;

  if (openPanel === 'NONE') {
    host.innerHTML = '';
    scene?.setPaused(false);
    return;
  }
  scene?.setPaused(true);

  const views: Record<string, () => string> = {
    INVENTORY: inventoryView,
    QUEST: questView,
    MAP: mapView,
    CHARACTER: characterView,
  };

  host.innerHTML = `<div class="side-panel">
    <div class="sp-head">
      <strong>${
        openPanel === 'INVENTORY' ? '가방과 장비' :
        openPanel === 'QUEST' ? '퀘스트' :
        openPanel === 'MAP' ? '월드 지도' : '캐릭터'
      }</strong>
      <button class="sp-close" data-close-panel>✕</button>
    </div>
    <div class="sp-body">${views[openPanel]?.() ?? ''}</div>
  </div>`;

  host.querySelector('[data-close-panel]')?.addEventListener('click', () => {
    openPanel = 'NONE';
    renderPanel();
  });

  bindPanelActions(host);
}

function bindPanelActions(host: HTMLElement): void {
  host.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!player) return;
      if (equipItem(player, button.dataset.equip as string)) {
        scene?.rebuildHero();
        persist();
        renderPanel();
        refreshHud();
      } else {
        toast('장착할 수 없습니다 (레벨 부족)', 'DANGER');
      }
    }),
  );
  host.querySelectorAll<HTMLButtonElement>('[data-unequip]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!player) return;
      unequipSlot(player, button.dataset.unequip as EquipSlot);
      scene?.rebuildHero();
      persist();
      renderPanel();
      refreshHud();
    }),
  );
  host.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!player) return;
      dropItem(player, button.dataset.drop as string);
      scene?.rebuildHero();
      persist();
      renderPanel();
      refreshHud();
    }),
  );
  host.querySelectorAll<HTMLButtonElement>('[data-travel]').forEach((button) =>
    button.addEventListener('click', () => {
      if (scene?.travelTo(button.dataset.travel as string)) {
        openPanel = 'NONE';
        renderPanel();
      }
    }),
  );
  host.querySelectorAll<HTMLButtonElement>('[data-stat]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!player || player.freePoints <= 0) return;
      const key = button.dataset.stat as keyof PlayerState['stats'];
      player.stats[key] += 1;
      player.freePoints -= 1;
      scene?.rebuildHero();
      persist();
      renderPanel();
      refreshHud();
    }),
  );
  host.querySelector('[data-reset-save]')?.addEventListener('click', () => {
    if (!confirm('정말 처음부터 다시 시작할까요? 저장된 진행이 모두 지워집니다.')) return;
    clearSave();
    location.reload();
  });
}

function itemLine(instance: ItemInstance, equipped: boolean): string {
  const def = ITEM_BY_ID.get(instance.itemId);
  if (!def) return '';
  const meta = RARITY_META[def.rarity];
  const stats = Object.entries(instance.rolledStats)
    .map(([key, value]) => `${key.toUpperCase()} +${Math.round(value)}`)
    .join(' · ');
  const affixes = instance.affixes.map((a) => describeAffix(a)).join('<br />');
  return `
    <div class="item ${equipped ? 'equipped' : ''}">
      <div class="item-head">
        <strong style="color:${meta.color}">${esc(def.name)}${instance.enhanceLevel > 0 ? ` +${instance.enhanceLevel}` : ''}</strong>
        <span class="tag">${meta.ko} · Lv${def.levelReq}</span>
      </div>
      ${stats ? `<div class="item-stats">${esc(stats)}</div>` : ''}
      ${affixes ? `<div class="item-affix">${affixes}</div>` : ''}
      <div class="item-actions">
        ${
          equipped
            ? `<button class="mini" data-unequip="${def.slot}">해제</button>`
            : `<button class="mini" data-equip="${instance.uid}">장착</button>`
        }
        <button class="mini danger" data-drop="${instance.uid}">버리기</button>
      </div>
    </div>`;
}

function inventoryView(): string {
  if (!player) return '';
  const stats = derivedStats(player);

  const slots = EQUIP_SLOTS.map((slot) => {
    const uid = player?.equipment[slot];
    const instance = uid ? player?.inventory.find((i) => i.uid === uid) : null;
    const def = instance ? ITEM_BY_ID.get(instance.itemId) : null;
    return `<div class="eq-slot ${instance ? 'filled' : ''}">
      <span class="eq-name">${slotLabel(slot)}</span>
      <span class="eq-item" style="color:${def ? RARITY_META[def.rarity].color : 'var(--muted)'}">
        ${def ? esc(def.name) : '비어 있음'}
      </span>
    </div>`;
  }).join('');

  const bag = player.inventory.length === 0
    ? '<p class="hint">가방이 비었습니다. 몬스터를 처치해 전리품을 모으세요.</p>'
    : player.inventory
        .map((instance) => itemLine(instance, isEquipped(player as PlayerState, instance.uid)))
        .join('');

  return `
    <div class="sp-stats">
      <span>공격력 <b>${stats.atk}</b> <em>(장비 +${stats.gearAtk})</em></span>
      <span>방어력 <b>${stats.def}</b> <em>(장비 +${stats.gearDef})</em></span>
      <span>최대 HP <b>${stats.maxHp}</b></span>
    </div>
    <h4>장비 16슬롯</h4>
    <div class="eq-grid">${slots}</div>
    <h4>가방 (${player.inventory.length})</h4>
    <div class="bag">${bag}</div>`;
}

function slotLabel(slot: EquipSlot): string {
  const labels: Record<EquipSlot, string> = {
    MAIN_HAND: '주무기', OFF_HAND: '보조', HELM: '투구', SHOULDER: '어깨',
    CHEST: '갑옷', GLOVES: '장갑', BELT: '벨트', BOOTS: '신발', CLOAK: '망토',
    NECKLACE: '목걸이', EARRING_1: '귀걸이1', EARRING_2: '귀걸이2',
    RING_1: '반지1', RING_2: '반지2', BRACELET: '팔찌', EMBLEM: '문장',
  };
  return labels[slot];
}

function questView(): string {
  if (!player) return '';
  const active = player.quests;
  if (active.length === 0 && player.completedQuests.length === 0) {
    return '<p class="hint">아직 받은 퀘스트가 없습니다. 마을 NPC에게 말을 걸어보세요.</p>';
  }
  const rows = active
    .map((progress) => {
      const def = QUEST_BY_ID.get(progress.questId);
      if (!def) return '';
      const mapName = MAP_BY_ID.get(def.map)?.name ?? def.map;
      return `<div class="quest-offer ${progress.state === 'COMPLETE' ? 'complete' : ''}">
        <strong>${esc(def.title)}</strong>
        <span class="tag">${def.type} · ${esc(mapName)} · Lv${def.level}</span>
        <p>${esc(def.summary ?? '')}</p>
        <ul>${progress.objectives
          .map(
            (objective, index) =>
              `<li class="${objective.done ? 'done' : ''}">${esc(objectiveLabel(def.objectives[index]))} <b>${objective.current}/${objective.required}</b></li>`,
          )
          .join('')}</ul>
      </div>`;
    })
    .join('');
  return `${rows}
    <h4>완료 ${player.completedQuests.length}건</h4>
    <p class="hint">${player.completedQuests.map((id) => esc(QUEST_BY_ID.get(id)?.title ?? id)).join(', ') || '없음'}</p>`;
}

function mapView(): string {
  if (!player) return '';
  const visited = new Set(player.visitedMaps);
  const entries = Object.entries(WORLD_LAYOUT);
  const maxX = Math.max(...entries.map(([, p]) => p.x));
  const maxY = Math.max(...entries.map(([, p]) => p.y));

  const nodes = entries
    .map(([mapId, pos]) => {
      const def = MAP_BY_ID.get(mapId);
      if (!def) return '';
      const seen = visited.has(mapId);
      const here = player?.mapId === mapId;
      const left = (pos.x / (maxX || 1)) * 88 + 6;
      const top = (pos.y / (maxY || 1)) * 88 + 6;
      return `<button class="wm-node ${here ? 'here' : ''} ${seen ? 'seen' : 'unseen'}"
        style="left:${left}%;top:${top}%"
        ${seen && !here ? `data-travel="${mapId}"` : 'disabled'}
        title="${esc(def.name)} · 권장 Lv${def.levelRange[0]}~${def.levelRange[1]}">
        <span>${seen ? esc(def.name) : '???'}</span>
        <em>${def.levelRange[0]}~${def.levelRange[1]}</em>
      </button>`;
    })
    .join('');

  return `
    <p class="hint">
      가 본 맵으로는 바로 이동할 수 있습니다. 회색은 아직 발견하지 못한 곳입니다.
      맵끼리는 필드 가장자리의 <span style="color:#c4b5fd">보라색 포탈</span>로 이어집니다.
    </p>
    <div class="worldmap">${nodes}</div>
    <p class="hint">발견한 맵 ${visited.size} / ${entries.length}</p>`;
}

function characterView(): string {
  if (!player) return '';
  const stats = derivedStats(player);
  const klass = CLASSES.find((c) => c.id === player?.classId);
  const xp = expProgress(player);
  const statKeys: [keyof typeof player.stats, string][] = [
    ['str', '힘 STR'], ['agi', '민첩 AGI'], ['int', '지능 INT'],
    ['vit', '체력 VIT'], ['wil', '정신 WIL'], ['luk', '행운 LUK'],
  ];

  return `
    <div class="sp-stats">
      <span>${esc(player.nickname)} · Lv <b>${player.level}</b></span>
      <span>직업 <b>${esc(klass?.name ?? '미정')}</b></span>
      <span>배경 <b>${esc(BACKGROUNDS[player.background].name)}</b></span>
      <span>경험치 <b>${player.level >= MAX_LEVEL ? `AP ${player.awakenPoint}` : `${xp.current}/${xp.required}`}</b></span>
      <span>골드 <b>${player.gold.toLocaleString('ko-KR')}</b></span>
      <span>플레이 <b>${Math.floor(player.playtimeMs / 60000)}분</b></span>
    </div>

    <h4>스탯 ${player.freePoints > 0 ? `<em style="color:var(--accent-2)">배분 가능 ${player.freePoints}</em>` : ''}</h4>
    <div class="stat-grid">
      ${statKeys
        .map(
          ([key, label]) => `<div class="stat-row">
            <span>${label}</span>
            <b>${player?.stats[key]}</b>
            <em>+${Math.round((stats.totalStats[key] ?? 0) - (player?.stats[key] ?? 0))}</em>
            ${player && player.freePoints > 0 ? `<button class="mini" data-stat="${key}">＋</button>` : ''}
          </div>`,
        )
        .join('')}
    </div>

    <h4>파생 능력치</h4>
    <div class="stat-grid">
      <div class="stat-row"><span>공격력</span><b>${stats.atk}</b></div>
      <div class="stat-row"><span>방어력</span><b>${stats.def}</b></div>
      <div class="stat-row"><span>최대 HP</span><b>${stats.maxHp}</b></div>
      <div class="stat-row"><span>최대 MP</span><b>${stats.maxMp}</b></div>
      <div class="stat-row"><span>치명타</span><b>${(stats.critRate * 100).toFixed(1)}%</b></div>
      <div class="stat-row"><span>이동속도</span><b>${stats.moveSpeed.toFixed(2)}</b></div>
    </div>

    <h4>처치 기록</h4>
    <p class="hint">${
      Object.keys(player.kills).length === 0
        ? '아직 없음'
        : Object.entries(player.kills)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([id, count]) => `${esc(monsterName(id))} ×${count}`)
            .join(', ')
    }</p>

    <button class="action danger" data-reset-save>처음부터 다시 시작</button>`;
}

export { PPM, generateMap };
