/**
 * 기획서 9부 — 퀘스트 엔진.
 *
 * 기획서 16부 원칙: "퀘스트 191개를 손으로 넣기 전에,
 * 퀘스트 엔진이 JSON 하나만 읽으면 동작하도록 만들어야 한다."
 *
 * 이 엔진은 objective 타입 10종을 전부 처리하고, 히든 퀘스트는
 * 로그에 노출하지 않은 채 서버 내부 카운터만 갱신한다(9-3).
 */
import type {
  GameEvent,
  ObjectiveProgress,
  QuestDef,
  QuestProgress,
  QuestRewards,
  QuestState,
} from '../types/quest.js';

/** 일일 05:00 / 주간 월요일 05:00 초기화 (기획서 9-5) */
export const DAILY_RESET_HOUR = 5;

export function nextDailyReset(nowMs: number): number {
  const d = new Date(nowMs);
  const reset = new Date(d);
  reset.setHours(DAILY_RESET_HOUR, 0, 0, 0);
  if (reset.getTime() <= nowMs) reset.setDate(reset.getDate() + 1);
  return reset.getTime();
}

export function nextWeeklyReset(nowMs: number): number {
  const d = new Date(nowMs);
  const reset = new Date(d);
  reset.setHours(DAILY_RESET_HOUR, 0, 0, 0);
  // 1 = 월요일
  const daysUntilMonday = (8 - reset.getDay()) % 7;
  reset.setDate(reset.getDate() + (daysUntilMonday === 0 ? 7 : daysUntilMonday));
  if (reset.getTime() <= nowMs) reset.setDate(reset.getDate() + 7);
  return reset.getTime();
}

export function initProgress(def: QuestDef, nowMs = Date.now()): QuestProgress {
  return {
    questId: def.id,
    state: 'ACTIVE',
    objectives: def.objectives.map((o, index) => ({
      index,
      current: 0,
      required: o.count ?? 1,
      done: false,
    })),
    resetAt:
      def.flags.reset === 'DAILY'
        ? nextDailyReset(nowMs)
        : def.flags.reset === 'WEEKLY'
          ? nextWeeklyReset(nowMs)
          : undefined,
  };
}

/** 선행 퀘스트를 전부 완료했는가 */
export function prerequisitesMet(def: QuestDef, completed: ReadonlySet<string>): boolean {
  return def.prerequisites.every((id) => completed.has(id));
}

export function questState(
  def: QuestDef,
  completed: ReadonlySet<string>,
  active: ReadonlyMap<string, QuestProgress>,
): QuestState {
  const progress = active.get(def.id);
  if (progress) return progress.state;
  if (completed.has(def.id) && !def.flags.repeatable) return 'TURNED_IN';
  return prerequisitesMet(def, completed) ? 'AVAILABLE' : 'LOCKED';
}

/** 이벤트가 이 objective를 진행시키는가 */
function matches(
  objective: QuestDef['objectives'][number],
  event: GameEvent,
): boolean {
  if (objective.type !== event.type) return false;
  if (objective.target && objective.target !== event.target) return false;
  if (objective.type === 'CHOICE' && event.type === 'CHOICE') {
    return !objective.choices || objective.choices.includes(event.choice);
  }
  return true;
}

export interface ApplyResult {
  progress: QuestProgress;
  changed: boolean;
  /** 이번 이벤트로 퀘스트가 완료되었는가 */
  completed: boolean;
}

/**
 * 이벤트 하나를 진행 중인 퀘스트에 적용한다.
 *
 * objective는 **순차 진행이 아니다.** 기획서에 순서 강제가 없으므로
 * 어떤 목표든 동시에 진행된다. 순서를 강제해야 하는 퀘스트는
 * prerequisites로 퀘스트 자체를 쪼갠다.
 */
export function applyEvent(
  def: QuestDef,
  progress: QuestProgress,
  event: GameEvent,
  nowMs = Date.now(),
): ApplyResult {
  if (progress.state !== 'ACTIVE') return { progress, changed: false, completed: false };

  let changed = false;
  const objectives: ObjectiveProgress[] = progress.objectives.map((op) => {
    const objective = def.objectives[op.index];
    if (!objective || op.done || !matches(objective, event)) return op;

    changed = true;

    if (objective.type === 'SURVIVE' && event.type === 'SURVIVE') {
      const required = objective.durationMs ?? 1;
      const current = Math.min(required, event.durationMs);
      return { ...op, current, required, done: current >= required };
    }

    const inc = 'count' in event && typeof event.count === 'number' ? event.count : 1;
    const current = Math.min(op.required, op.current + inc);
    return { ...op, current, done: current >= op.required };
  });

  if (!changed) return { progress, changed: false, completed: false };

  const allDone = objectives.every((o) => o.done);
  const next: QuestProgress = {
    ...progress,
    objectives,
    state: allDone ? 'COMPLETE' : 'ACTIVE',
    completedAt: allDone ? nowMs : progress.completedAt,
    choiceMade:
      event.type === 'CHOICE' ? event.choice : progress.choiceMade,
  };

  return { progress: next, changed: true, completed: allDone };
}

/** 보상 수령 — COMPLETE 상태에서만 가능 */
export function turnIn(
  def: QuestDef,
  progress: QuestProgress,
): { progress: QuestProgress; rewards: QuestRewards } | null {
  if (progress.state !== 'COMPLETE') return null;
  return { progress: { ...progress, state: 'TURNED_IN' }, rewards: def.rewards };
}

/**
 * 여러 퀘스트를 한 번에 굴리는 트래커.
 * 서버의 QuestService가 캐릭터 1명당 하나씩 들고 있는다.
 */
export class QuestTracker {
  private readonly active = new Map<string, QuestProgress>();
  private readonly completed = new Set<string>();
  /** 기획서 9-3: 히든은 로그에 등록하지 않고 카운터만 센다 */
  private readonly hiddenCounters = new Map<string, Record<string, number>>();

  constructor(private readonly defs: ReadonlyMap<string, QuestDef>) {}

  get activeQuests(): QuestProgress[] {
    return [...this.active.values()];
  }

  /** 클라이언트에 보내는 퀘스트 로그 — 히든은 절대 포함하지 않는다 */
  get visibleLog(): QuestProgress[] {
    return this.activeQuests.filter((p) => this.defs.get(p.questId)?.type !== 'HIDDEN');
  }

  get completedIds(): ReadonlySet<string> {
    return this.completed;
  }

  accept(questId: string, nowMs = Date.now()): QuestProgress | null {
    const def = this.defs.get(questId);
    if (!def) return null;
    if (this.active.has(questId)) return this.active.get(questId) as QuestProgress;
    if (!prerequisitesMet(def, this.completed)) return null;
    if (this.completed.has(questId) && !def.flags.repeatable) return null;
    const progress = initProgress(def, nowMs);
    this.active.set(questId, progress);
    return progress;
  }

  /**
   * 게임 이벤트 하나를 모든 활성 퀘스트에 흘려보낸다.
   * @returns 이번 이벤트로 완료된 퀘스트 id 목록
   */
  push(event: GameEvent, nowMs = Date.now()): string[] {
    const completedNow: string[] = [];
    for (const [id, progress] of this.active) {
      const def = this.defs.get(id);
      if (!def) continue;
      const result = applyEvent(def, progress, event, nowMs);
      if (!result.changed) continue;
      this.active.set(id, result.progress);
      if (result.completed) completedNow.push(id);
    }
    return completedNow;
  }

  claim(questId: string): QuestRewards | null {
    const def = this.defs.get(questId);
    const progress = this.active.get(questId);
    if (!def || !progress) return null;
    const result = turnIn(def, progress);
    if (!result) return null;
    this.active.delete(questId);
    this.completed.add(questId);
    return result.rewards;
  }

  /** 히든 진행도 카운터 증가 — 클라이언트에 노출하지 않는다 */
  bumpHidden(hiddenId: string, counter: string, amount = 1): number {
    const counters = this.hiddenCounters.get(hiddenId) ?? {};
    counters[counter] = (counters[counter] ?? 0) + amount;
    this.hiddenCounters.set(hiddenId, counters);
    return counters[counter] as number;
  }

  hiddenCounter(hiddenId: string, counter: string): number {
    return this.hiddenCounters.get(hiddenId)?.[counter] ?? 0;
  }

  /** 일일/주간 리셋 처리 */
  resetExpired(nowMs = Date.now()): string[] {
    const reset: string[] = [];
    for (const [id, progress] of this.active) {
      if (progress.resetAt && nowMs >= progress.resetAt) {
        const def = this.defs.get(id);
        if (!def) continue;
        this.active.set(id, initProgress(def, nowMs));
        this.completed.delete(id);
        reset.push(id);
      }
    }
    return reset;
  }
}
