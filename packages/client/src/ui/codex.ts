/**
 * 도감 — 기획 데이터를 그대로 읽어 보여준다.
 *
 * 서버 API가 아니라 @eternia/shared 레지스트리를 직접 읽는다.
 * 정적 배포에서도 동작해야 하고, 어차피 클라·서버가 같은 데이터를 쓰기 때문이다.
 *
 * 히든 맵·히든 퀘스트는 여기서도 감춘다 (기획서 8부 / 9-3).
 */
import {
  CLASSES,
  DUNGEONS,
  HIDDEN_CLASSES,
  ITEMS,
  MAPS,
  QUESTS,
  RAIDS,
  RARITY_META,
  SKILLS,
  questsForMap,
  skillsForClass,
} from '@eternia/shared';

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });

type SectionId = 'classes' | 'maps' | 'quests' | 'items' | 'content';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'classes', label: `직업 ${CLASSES.length + HIDDEN_CLASSES.length}종` },
  { id: 'maps', label: `맵 ${MAPS.length}종` },
  { id: 'quests', label: `퀘스트 ${QUESTS.length}종` },
  { id: 'items', label: `아이템 ${ITEMS.length}종` },
  { id: 'content', label: `던전 ${DUNGEONS.length} · 레이드 ${RAIDS.length}` },
];

const PK_LABEL: Record<string, string> = {
  NONE: '불가',
  DUEL_ONLY: '결투 수락 시',
  FREE: '자유 PK',
};

function classesView(): string {
  const base = CLASSES.map((klass) => {
    const stars = '★'.repeat(klass.difficulty) + '☆'.repeat(5 - klass.difficulty);
    const branches20 = klass.branches.filter((b) => b.level === 20);
    return `
      <div class="card">
        <h4>${esc(klass.name)}</h4>
        <div class="tag">${stars} · 패리 판정 ${klass.parryWindowMs}ms · 주스탯 ${klass.mainStats.join('/').toUpperCase()}</div>
        <div class="roles">${klass.roles.map((r) => `<span>${r}</span>`).join('')}</div>
        <p>${esc(klass.concept)}</p>
        <p style="margin-top:8px">
          <strong style="color:var(--text)">20레벨 분기</strong> ·
          ${branches20.map((b) => esc(b.name)).join(' / ')}<br />
          스킬 ${skillsForClass(klass.id).length}개
          ${klass.soloNote ? `<br /><em style="color:#facc15">솔로 대책: ${esc(klass.soloNote)}</em>` : ''}
        </p>
      </div>`;
  }).join('');

  // 히든 직업은 존재만 알리고 해금 조건은 감춘다 (기획서 8부 공통 규칙 1)
  const hidden = HIDDEN_CLASSES.map(
    (klass) => `
      <div class="card" style="border-style:dashed">
        <h4>${esc(klass.name)} <span style="color:var(--muted);font-size:11px">히든</span></h4>
        <div class="tag">요구 레벨 ${klass.levelReq} · 원 직업 ${klass.baseClasses.join(', ')}</div>
        <p>${esc(klass.concept)}</p>
        <p style="color:#64748b">해금 조건 ${klass.unlockSteps.length}단계 — <em>UI에 힌트가 없다</em></p>
      </div>`,
  ).join('');

  return `
    <h3>기본 직업 ${CLASSES.length}종</h3>
    <div class="grid">${base}</div>
    <h3>히든 직업 ${HIDDEN_CLASSES.length}종</h3>
    <p class="hint">
      기획서 8부: 히든 직업은 UI에 어떤 힌트도 없다. 조건은 서버가 조용히 추적한다.
      아래에는 이름과 컨셉만 있고, 실제 해금 조건은 클라이언트에 내려주지 않는다.
    </p>
    <div class="grid">${hidden}</div>`;
}

function mapsView(): string {
  const rows = MAPS.filter((map) => !map.hidden)
    .sort((a, b) => a.index - b.index)
    .map(
      (map) => `
        <tr>
          <td style="font-family:ui-monospace,monospace;color:var(--muted)">${String(map.index).padStart(2, '0')}</td>
          <td><strong>${esc(map.name)}</strong></td>
          <td>${map.levelRange[0]}–${map.levelRange[1]}</td>
          <td>${esc(map.kind)}</td>
          <td>${questsForMap(map.id).length}</td>
          <td>${map.campfires}</td>
          <td style="color:${map.pk === 'FREE' ? 'var(--danger)' : 'var(--muted)'}">${PK_LABEL[map.pk]}</td>
        </tr>`,
    )
    .join('');

  const hiddenCount = MAPS.filter((m) => m.hidden).length;

  return `
    <p class="hint">
      기획서 1-2 ①: 레벨 제한으로 맵을 막지 않는다. 저렙이 고렙 맵에 갈 수는 있지만 죽는다.
      아래 레벨은 <strong>권장</strong>일 뿐이다. PK 열은 별책 PvP 기획서 4-1을 따른다.
    </p>
    <div class="scroll">
      <table class="data">
        <thead>
          <tr><th>#</th><th>맵</th><th>권장 레벨</th><th>유형</th><th>퀘스트</th><th>모닥불</th><th>PK</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:12px">
      지도에 없는 히든 맵 ${hiddenCount}곳은 목록에서 제외했다.
    </p>`;
}

function questsView(): string {
  const visible = QUESTS.filter((q) => q.type !== 'HIDDEN');
  const hiddenCount = QUESTS.length - visible.length;

  const byType = (type: string) => visible.filter((q) => q.type === type).length;

  const rows = visible
    .map(
      (quest) => `
        <tr>
          <td style="font-family:ui-monospace,monospace;color:var(--accent)">${esc(quest.id)}</td>
          <td><strong>${esc(quest.title)}</strong></td>
          <td>${esc(quest.type)}</td>
          <td>${quest.level}</td>
          <td>${quest.objectives.map((o) => o.type).join(', ')}</td>
          <td style="color:var(--muted)">${esc(quest.summary ?? '')}</td>
        </tr>`,
    )
    .join('');

  return `
    <p class="hint">
      메인 ${byType('MAIN')} · 서브 ${byType('SUB')} · 일일/주간 ${byType('DAILY')} · 월드 ${byType('WORLD')}
      &nbsp;|&nbsp; 히든 ${hiddenCount}종은 <strong>퀘스트 로그에 등록되지 않으므로</strong> 여기에도 없다 (기획서 9-3).
    </p>
    <div class="scroll">
      <table class="data">
        <thead>
          <tr><th>ID</th><th>제목</th><th>종류</th><th>Lv</th><th>목표 타입</th><th>내용</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function itemsView(): string {
  const counts = Object.entries(
    ITEMS.reduce<Record<string, number>>((acc, item) => {
      acc[item.rarity] = (acc[item.rarity] ?? 0) + 1;
      return acc;
    }, {}),
  );

  const notable = ITEMS.filter((item) => item.handcrafted && item.uniqueEffects.length > 0)
    .slice(0, 18)
    .map(
      (item) => `
        <div class="card">
          <h4 style="color:${RARITY_META[item.rarity].color}">${esc(item.name)}</h4>
          <div class="tag">${RARITY_META[item.rarity].ko} · ${esc(item.slot)} · Lv${item.levelReq} · 소켓 ${item.sockets}</div>
          <p>${item.uniqueEffects.map((e) => `· ${esc(e)}`).join('<br />')}</p>
        </div>`,
    )
    .join('');

  const rarityChips = counts
    .map(([rarity, count]) => {
      const meta = RARITY_META[rarity as keyof typeof RARITY_META];
      return `<span class="chip"><strong style="color:${meta.color}">${meta.ko}</strong> ${count}</span>`;
    })
    .join('');

  return `
    <p class="hint">
      기획서 6-4-9: 800개를 손으로 쓰지 않는다. 일반~희귀는
      <code>tools/generate-items.ts</code>가 템플릿 × 레벨 구간 × 무기타입으로 생성하고,
      영웅 이상만 손으로 설계한다.
    </p>
    <div class="masthead meta" style="margin-bottom:14px">${rarityChips}</div>
    <h3>손으로 설계한 고유 아이템</h3>
    <div class="grid">${notable}</div>`;
}

function contentView(): string {
  const dungeonRows = DUNGEONS.map(
    (dungeon) => `
      <tr>
        <td style="font-family:ui-monospace,monospace;color:var(--accent)">${esc(dungeon.id)}</td>
        <td><strong>${esc(dungeon.name)}</strong></td>
        <td>${dungeon.levelRange[0]}–${dungeon.levelRange[1]}</td>
        <td>${esc(dungeon.boss)}</td>
        <td style="color:var(--muted)">${esc(dungeon.gimmick)}</td>
      </tr>`,
  ).join('');

  const raidRows = RAIDS.map(
    (raid) => `
      <tr>
        <td style="font-family:ui-monospace,monospace;color:var(--accent-2)">${esc(raid.id)}</td>
        <td><strong>${esc(raid.name)}</strong></td>
        <td>${raid.players}인</td>
        <td>${raid.phases === 99 ? '무한' : `${raid.phases}페이즈`}</td>
        <td style="color:var(--muted)">${esc(raid.gimmick)}</td>
      </tr>`,
  ).join('');

  return `
    <h3>던전 ${DUNGEONS.length}종</h3>
    <div class="scroll" style="max-height:36vh">
      <table class="data">
        <thead><tr><th>ID</th><th>이름</th><th>레벨</th><th>최종 보스</th><th>핵심 기믹</th></tr></thead>
        <tbody>${dungeonRows}</tbody>
      </table>
    </div>
    <h3>레이드 ${RAIDS.length}종</h3>
    <div class="scroll" style="max-height:36vh">
      <table class="data">
        <thead><tr><th>ID</th><th>이름</th><th>인원</th><th>페이즈</th><th>핵심 기믹</th></tr></thead>
        <tbody>${raidRows}</tbody>
      </table>
    </div>`;
}

const VIEWS: Record<SectionId, () => string> = {
  classes: classesView,
  maps: mapsView,
  quests: questsView,
  items: itemsView,
  content: contentView,
};

export function renderCodex(root: HTMLElement): void {
  let current: SectionId = 'classes';

  const draw = () => {
    root.innerHTML = `
      <div class="panel">
        <h2>도감</h2>
        <p class="hint">
          클라이언트와 서버가 <strong>같은 데이터 레지스트리</strong>를 읽는다
          (<code>packages/shared/src/data</code>). 스킬 ${SKILLS.length}개, 퀘스트 ${QUESTS.length}개,
          아이템 ${ITEMS.length}개가 <code>tools/validate-data.ts</code>의 참조 무결성 검사를 통과한 상태다.
        </p>
        <div class="subtabs">
          ${SECTIONS.map(
            (section) =>
              `<button data-section="${section.id}" aria-selected="${section.id === current}">${section.label}</button>`,
          ).join('')}
        </div>
        <div id="codex-body">${VIEWS[current]()}</div>
      </div>`;

    root.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((button) => {
      button.addEventListener('click', () => {
        current = button.dataset.section as SectionId;
        draw();
      });
    });
  };

  draw();
}
