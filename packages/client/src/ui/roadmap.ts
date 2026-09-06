/**
 * 구현 현황 — 기획서 16부 로드맵 대비 무엇이 되고 무엇이 안 되는지 그대로 적는다.
 * 실제보다 잘 돼 있는 것처럼 보이게 만들지 않는다.
 */
import { dataSummary } from '@eternia/shared';

type Status = 'DONE' | 'PARTIAL' | 'TODO';

interface Task {
  label: string;
  status: Status;
  note?: string;
}

interface Milestone {
  id: string;
  title: string;
  estimate: string;
  tasks: Task[];
}

const MILESTONES: Milestone[] = [
  {
    id: 'M0',
    title: '기반',
    estimate: '1~2주',
    tasks: [
      { label: '모노레포 세팅 (shared / server / client)', status: 'DONE', note: 'npm workspaces' },
      { label: 'Prisma 스키마 (기획서 15부)', status: 'DONE', note: 'packages/server/prisma/schema.prisma' },
      {
        label: '계정 가입/로그인 + JWT',
        status: 'DONE',
        note: 'bcrypt 해시, 계정 존재 여부 비노출',
      },
      {
        label: '닉네임 검증기 + 중복 체크 (4-2절 전체)',
        status: 'DONE',
        note: '32개 테스트 통과. 혼동 문자 정규화로 사칭 차단',
      },
      {
        label: 'tools/validate-data.ts 데이터 검증기',
        status: 'DONE',
        note: '참조 무결성 + 기획서 규칙(히든 비노출, 등급별 접사 상한 등) 검사',
      },
      { label: 'PostgreSQL 마이그레이션 실행', status: 'TODO', note: '스키마는 있으나 DB 미연결 (현재 인메모리 저장소)' },
    ],
  },
  {
    id: 'M1',
    title: '액션 전투 코어 ★가장 중요',
    estimate: '3~4주',
    tasks: [
      {
        label: '히트박스 엔진 6종 (SECTOR/LINE/CIRCLE/PROJECTILE/DASH/GROUND)',
        status: 'DONE',
        note: '투사체 터널링 방지 포함. 20개 테스트',
      },
      {
        label: '애니메이션 상태 머신 (선딜/판정/후딜 + 캔슬 규칙)',
        status: 'DONE',
        note: '한 틱에 여러 페이즈를 통과해도 판정을 건너뛰지 않는다',
      },
      {
        label: '회피 구르기 + 무적 프레임 + 스태미나',
        status: 'DONE',
        note: '무적 구간을 서버 타임스탬프로 보관 → 되감기 판정 가능',
      },
      { label: '가드 / 패리 판정', status: 'DONE', note: '직업별 판정 창, 가드 브레이크' },
      { label: '자세 붕괴(그로기) 게이지', status: 'DONE', note: 'PvE 3초/+80%, PvP 1.2초/+35%' },
      { label: '데미지 공식 (6-3-5)', status: 'DONE', note: '난수를 주입받아 결정적으로 검증' },
      { label: '허수아비 테스트 씬', status: 'DONE', note: '이 페이지의 훈련장 탭' },
      { label: '캐릭터 이동/카메라, 맵 로더', status: 'DONE', note: '3인칭 3D(Three.js). 19개 맵 절차 생성 + 추적 카메라' },
      { label: '처형 모션 연출', status: 'TODO', note: '판정(canExecute)은 있으나 연출 없음' },
    ],
  },
  {
    id: 'M2',
    title: '장비 시스템',
    estimate: '2~3주',
    tasks: [
      { label: '접사 롤 엔진 (접두 48 / 접미 36 / 전설 20)', status: 'DONE' },
      { label: '강화 +20, 재련, 계승, 각인', status: 'DONE', note: '단계별 위험도(유지/하락/파괴) 구현' },
      { label: 'tools/generate-items.ts', status: 'DONE', note: '760종 자동 생성 + 손으로 40종 = 800종' },
      { label: 'tools/balance-sim.ts', status: 'DONE', note: '몬테카를로 + 직업 DPS 편차 + 히든 105% 상한 검사' },
      { label: '16슬롯 인벤토리/장착', status: 'DONE', note: '전리품 장착 시 능력치에 실제 반영' },
      { label: '무기 스왑 (X키 세트 전환)', status: 'TODO' },
      { label: '세트 효과 40종', status: 'PARTIAL', note: '2종 구현 (프레임과 검증기는 완성)' },
      { label: '외형 변경 + 도감 등록', status: 'TODO' },
    ],
  },
  {
    id: 'M3',
    title: '직업 & 퀘스트',
    estimate: '3~4주',
    tasks: [
      { label: '퀘스트 엔진 (objective 10종)', status: 'DONE', note: '히든은 로그에 등록하지 않는다' },
      { label: '기본 직업 10종 데이터 + 20/40레벨 분기', status: 'DONE' },
      { label: '히든 직업 7종 데이터', status: 'DONE', note: '해금 조건은 서버에만' },
      { label: '스킬 엔진 (쿨타임, 자원, 히트박스 연결)', status: 'PARTIAL', note: 'Combatant에 구현. 이펙트 훅 없음' },
      { label: '직업당 20스킬 = 200스킬', status: 'PARTIAL', note: '핵심 스킬 93개 (직업당 6~8개)' },
      { label: '퀘스트 수령/진행/보고 루프', status: 'DONE', note: 'NPC 대화 → 목표 지점(POI) → 보상' },
      { label: '직업 선택 UI (5레벨)', status: 'DONE' },
      { label: '튜토리얼 T-01~T-11', status: 'TODO', note: '생성 후 바로 오픈월드로 들어간다' },
    ],
  },
  {
    id: 'M4',
    title: '멀티플레이',
    estimate: '4~5주',
    tasks: [
      { label: 'Colyseus WorldRoom / TownRoom (30tick, AoI)', status: 'TODO' },
      { label: '지연 보상 (최대 200ms 되감기)', status: 'PARTIAL', note: '무적 구간 타임스탬프 조회는 준비됨' },
      { label: '파티 시스템 + 경험치/전리품 분배', status: 'PARTIAL', note: '분배 공식만 구현' },
      { label: '어그로 시스템', status: 'PARTIAL', note: '위협 수치 공식만 구현' },
      { label: '자동 매칭 큐 (Redis)', status: 'TODO' },
    ],
  },
  { id: 'M5', title: '월드 확장 (맵 4~14, 던전/레이드 구현)', estimate: '5~7주', tasks: [
    { label: '맵 데이터 19종', status: 'DONE', note: '연결 그래프 + PK 플래그' },
    { label: '19개 맵 실제 플레이 가능', status: 'DONE', note: '절차 생성 + 포탈 이동 + 월드 지도' },
    { label: '몬스터 스폰 · AI · 전리품', status: 'DONE', note: '추격/공격 예고/리쉬 복귀, 필드 보스' },
    { label: '던전·레이드 인스턴스 진입', status: 'TODO', note: '데이터만 있고 방이 없다' },
    { label: '던전 30종 / 레이드 25종 데이터', status: 'DONE', note: '기믹 설명까지' },
    { label: '서브/기본 퀘스트 대량 투입', status: 'PARTIAL', note: '50 / 211종' },
    { label: '경매장, 골드 싱크, 세력 평판, 길드', status: 'TODO' },
  ] },
  { id: 'M6', title: '엔드게임 (각성, 균열 심층, 6막 엔딩)', estimate: '4주', tasks: [
    { label: '각성 시스템 공식 (A1~A999)', status: 'DONE', note: 'AP 곡선 + 능력치 배율' },
    { label: '균열 심층(프로시저럴), 6막 엔딩 분기', status: 'TODO' },
  ] },
  { id: 'M7', title: '히든 & 폴리싱', estimate: '3주', tasks: [
    { label: 'HiddenProgress 추적기', status: 'PARTIAL', note: '카운터 API + DB 스키마 완료' },
    { label: '히든 퀘스트 27종', status: 'PARTIAL', note: '3종 (맵 1~3)' },
    { label: '밸런스 패스 (DPS 편차 ±7%)', status: 'TODO', note: 'balance-sim이 현재 편차를 측정 중 — 아래 참고' },
  ] },
  { id: 'M8', title: 'PvP (별도 문서)', estimate: '—', tasks: [
    { label: 'PvP 계수 분리 (contextCoef / pvpOverride)', status: 'DONE', note: '스킬 데이터에 pve/pvp 계수 분리 완료' },
    { label: 'PvP 자세 붕괴 약화값', status: 'DONE', note: 'PVP_POISE' },
    { label: '아레나·오픈월드 PK·공성전', status: 'TODO', note: 'M4 완료 후 착수 (기획서 지시)' },
  ] },
];

const STATUS_META: Record<Status, { label: string; color: string }> = {
  DONE: { label: '완료', color: '#4ade80' },
  PARTIAL: { label: '부분', color: '#fbbf24' },
  TODO: { label: '미착수', color: '#64748b' },
};

export function renderRoadmap(root: HTMLElement): void {
  const all = MILESTONES.flatMap((m) => m.tasks);
  const done = all.filter((t) => t.status === 'DONE').length;
  const partial = all.filter((t) => t.status === 'PARTIAL').length;
  const summary = dataSummary();

  const milestoneHtml = MILESTONES.map((milestone) => {
    const rows = milestone.tasks
      .map((task) => {
        const meta = STATUS_META[task.status];
        return `<tr>
          <td style="width:64px"><span style="color:${meta.color}">● ${meta.label}</span></td>
          <td>${task.label}</td>
          <td style="color:var(--muted)">${task.note ?? ''}</td>
        </tr>`;
      })
      .join('');

    const doneCount = milestone.tasks.filter((t) => t.status === 'DONE').length;

    return `
      <h3>${milestone.id} — ${milestone.title}
        <span style="text-transform:none;letter-spacing:0;color:#64748b">
          (${milestone.estimate} · ${doneCount}/${milestone.tasks.length} 완료)
        </span>
      </h3>
      <table class="data"><tbody>${rows}</tbody></table>`;
  }).join('');

  root.innerHTML = `
    <div class="panel">
      <h2>구현 현황</h2>
      <p class="hint">
        기획서 16부 로드맵 대비 실제 상태다. 한 세션에 전체를 만들 수는 없으므로
        기획서가 지시한 순서 — <strong>데이터보다 시스템을 먼저</strong> — 를 그대로 따랐다.
        아래 표는 실제보다 잘 돼 있는 것처럼 적지 않았다.
      </p>

      <div class="statgrid" style="grid-template-columns:repeat(4,1fr)">
        <div><div class="n" style="color:#4ade80">${done}</div><div class="l">완료</div></div>
        <div><div class="n" style="color:#fbbf24">${partial}</div><div class="l">부분 구현</div></div>
        <div><div class="n" style="color:#64748b">${all.length - done - partial}</div><div class="l">미착수</div></div>
        <div><div class="n">${summary.items + summary.quests + summary.skills}</div><div class="l">데이터 엔트리</div></div>
      </div>

      <div class="note" style="margin-top:18px">
        <strong>balance-sim이 찾아낸 것</strong><br />
        접사 조합 몬테카를로에서 상위 0.1% / 중앙값 비율은 기획서 기준(3배) 이내다.
        다만 직업별 DPS 편차는 아직 목표(±7%)를 크게 벗어나 있고,
        히든 직업 일부가 105% 상한을 넘는다. 기획서가 "수치는 M1~M2 플레이테스트로 조정"이라 했으므로
        이 도구는 게이트가 아니라 관측기로 두었다.
        <code>npm run sim:balance</code>로 직접 확인할 수 있다.
      </div>

      ${milestoneHtml}
    </div>`;
}
