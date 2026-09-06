/** 기획서 9부 — 퀘스트 엔진. objective 10종 처리와 히든 비노출 원칙. */
import { describe, expect, it } from 'vitest';
import { QuestTracker, applyEvent, initProgress, prerequisitesMet, questState, turnIn } from './engine.js';
import { QUESTS, QUEST_BY_ID } from '../data/registry.js';
import type { QuestDef } from '../types/quest.js';

const sqWw02 = QUEST_BY_ID.get('SQ-WW-02') as QuestDef;

describe('objective 진행', () => {
  it('KILL 목표가 이벤트로 누적된다', () => {
    let progress = initProgress(sqWw02, 0);
    for (let i = 0; i < 12; i += 1) {
      progress = applyEvent(sqWw02, progress, { type: 'KILL', target: 'mob_grey_wolf' }, 0).progress;
    }
    expect(progress.objectives[0]?.done).toBe(true);
    expect(progress.state).toBe('ACTIVE'); // 나머지 목표가 남아 있다
  });

  it('count가 붙은 이벤트는 한 번에 여러 개를 올린다', () => {
    let progress = initProgress(sqWw02, 0);
    progress = applyEvent(
      sqWw02,
      progress,
      { type: 'COLLECT', target: 'item_wolf_fang', count: 8 },
      0,
    ).progress;
    expect(progress.objectives[1]?.current).toBe(8);
    expect(progress.objectives[1]?.done).toBe(true);
  });

  it('요구 수치를 넘겨도 초과 누적되지 않는다', () => {
    let progress = initProgress(sqWw02, 0);
    progress = applyEvent(
      sqWw02,
      progress,
      { type: 'COLLECT', target: 'item_wolf_fang', count: 999 },
      0,
    ).progress;
    expect(progress.objectives[1]?.current).toBe(8);
  });

  it('대상이 다른 이벤트는 무시한다', () => {
    const progress = initProgress(sqWw02, 0);
    const result = applyEvent(sqWw02, progress, { type: 'KILL', target: 'mob_harpy' }, 0);
    expect(result.changed).toBe(false);
  });

  it('모든 목표를 채우면 COMPLETE가 된다', () => {
    let progress = initProgress(sqWw02, 0);
    progress = applyEvent(sqWw02, progress, { type: 'KILL', target: 'mob_grey_wolf', count: 12 }, 0).progress;
    progress = applyEvent(sqWw02, progress, { type: 'COLLECT', target: 'item_wolf_fang', count: 8 }, 0).progress;
    progress = applyEvent(sqWw02, progress, { type: 'REACH', target: 'poi_dried_spring' }, 0).progress;
    const last = applyEvent(sqWw02, progress, { type: 'TALK', target: 'npc_hunter_boron' }, 100);
    expect(last.completed).toBe(true);
    expect(last.progress.state).toBe('COMPLETE');
    expect(last.progress.completedAt).toBe(100);
  });

  it('SURVIVE는 지속 시간으로 판정한다', () => {
    const def: QuestDef = {
      ...sqWw02,
      id: 'TEST-SURVIVE',
      objectives: [{ type: 'SURVIVE', target: 'poi_x', durationMs: 60000 }],
    };
    let progress = initProgress(def, 0);
    progress = applyEvent(def, progress, { type: 'SURVIVE', target: 'poi_x', durationMs: 30000 }, 0).progress;
    expect(progress.objectives[0]?.done).toBe(false);
    progress = applyEvent(def, progress, { type: 'SURVIVE', target: 'poi_x', durationMs: 60000 }, 0).progress;
    expect(progress.objectives[0]?.done).toBe(true);
  });

  it('CHOICE는 선택지를 기록한다', () => {
    const def = QUEST_BY_ID.get('SQ-HP-04') as QuestDef;
    let progress = initProgress(def, 0);
    progress = applyEvent(def, progress, { type: 'COLLECT', target: 'item_ether_crystal', count: 5 }, 0).progress;
    const result = applyEvent(
      def,
      progress,
      { type: 'CHOICE', target: 'choice_smuggling', choice: '고발' },
      0,
    );
    expect(result.progress.choiceMade).toBe('고발');
    expect(result.completed).toBe(true);
  });

  it('허용되지 않은 선택지는 진행되지 않는다', () => {
    const def = QUEST_BY_ID.get('SQ-HP-04') as QuestDef;
    const progress = initProgress(def, 0);
    const result = applyEvent(
      def,
      progress,
      { type: 'CHOICE', target: 'choice_smuggling', choice: '없는선택지' },
      0,
    );
    expect(result.changed).toBe(false);
  });
});

describe('선행 조건과 상태', () => {
  it('선행 퀘스트를 끝내야 수락 가능', () => {
    expect(prerequisitesMet(sqWw02, new Set())).toBe(false);
    expect(prerequisitesMet(sqWw02, new Set(['SQ-WW-01']))).toBe(true);
  });

  it('선행이 없으면 LOCKED, 있으면 AVAILABLE', () => {
    expect(questState(sqWw02, new Set(), new Map())).toBe('LOCKED');
    expect(questState(sqWw02, new Set(['SQ-WW-01']), new Map())).toBe('AVAILABLE');
  });

  it('완료했고 반복 불가면 TURNED_IN', () => {
    expect(questState(sqWw02, new Set(['SQ-WW-01', 'SQ-WW-02']), new Map())).toBe('TURNED_IN');
  });
});

describe('보상 수령', () => {
  it('COMPLETE 상태에서만 수령할 수 있다', () => {
    const progress = initProgress(sqWw02, 0);
    expect(turnIn(sqWw02, progress)).toBeNull();
    const done = { ...progress, state: 'COMPLETE' as const };
    const result = turnIn(sqWw02, done);
    expect(result?.rewards.exp).toBe(1200);
    expect(result?.progress.state).toBe('TURNED_IN');
  });
});

describe('QuestTracker — 히든은 로그에 노출하지 않는다 (기획서 9-3)', () => {
  it('히든 퀘스트는 visibleLog에서 제외된다', () => {
    const tracker = new QuestTracker(QUEST_BY_ID);
    tracker.accept('HQ-DH-01');
    tracker.accept('SQ-DH-02');
    expect(tracker.activeQuests).toHaveLength(2);
    expect(tracker.visibleLog.map((p) => p.questId)).toEqual(['SQ-DH-02']);
  });

  it('선행이 안 끝난 퀘스트는 수락되지 않는다', () => {
    const tracker = new QuestTracker(QUEST_BY_ID);
    expect(tracker.accept('SQ-WW-02')).toBeNull();
  });

  it('이벤트 하나가 여러 퀘스트를 동시에 진행시킨다', () => {
    const tracker = new QuestTracker(QUEST_BY_ID);
    tracker.accept('SQ-WW-01');
    tracker.accept('DQ-WW-01');
    tracker.push({ type: 'KILL', target: 'mob_grey_wolf', count: 12 });
    const sq = tracker.activeQuests.find((p) => p.questId === 'SQ-WW-01');
    const dq = tracker.activeQuests.find((p) => p.questId === 'DQ-WW-01');
    expect(sq?.objectives[0]?.current).toBe(12);
    expect(dq?.objectives[0]?.current).toBe(12);
  });

  it('완료 → 수령 → 완료 목록에 반영', () => {
    const tracker = new QuestTracker(QUEST_BY_ID);
    tracker.accept('SQ-WW-01');
    tracker.push({ type: 'KILL', target: 'mob_grey_wolf', count: 12 });
    const completed = tracker.push({ type: 'TALK', target: 'npc_hunter_boron' });
    expect(completed).toContain('SQ-WW-01');
    const rewards = tracker.claim('SQ-WW-01');
    expect(rewards?.gold).toBe(180);
    expect(tracker.completedIds.has('SQ-WW-01')).toBe(true);
  });

  it('히든 카운터는 별도로 센다', () => {
    const tracker = new QuestTracker(QUEST_BY_ID);
    tracker.bumpHidden('HQ-FR-01', 'visitCount');
    tracker.bumpHidden('HQ-FR-01', 'visitCount');
    expect(tracker.hiddenCounter('HQ-FR-01', 'visitCount')).toBe(2);
    expect(tracker.hiddenCounter('HQ-FR-01', 'noSkillBossKills')).toBe(0);
  });
});

describe('quests 데이터 무결성', () => {
  it('히든 퀘스트는 전부 hiddenTrigger를 가진다', () => {
    for (const quest of QUESTS.filter((q) => q.type === 'HIDDEN')) {
      expect(quest.hiddenTrigger, `${quest.id}`).toBeDefined();
      expect(quest.flags.autoTrack, `${quest.id}는 자동 추적되면 안 된다`).toBe(false);
    }
  });

  it('일일/주간 퀘스트는 reset 플래그를 가진다', () => {
    for (const quest of QUESTS.filter((q) => q.type === 'DAILY')) {
      expect(quest.flags.repeatable, `${quest.id}`).toBe(true);
      expect(quest.flags.reset, `${quest.id}`).toBeDefined();
    }
  });

  it('퀘스트 id는 중복되지 않는다', () => {
    expect(QUEST_BY_ID.size).toBe(QUESTS.length);
  });
});
