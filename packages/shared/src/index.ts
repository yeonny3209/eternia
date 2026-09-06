/**
 * @eternia/shared — 클라이언트·서버 공용 코어.
 *
 * 기획서 2-2 원칙: "모든 판정은 서버가 한다. 클라이언트는 입력만 보낸다."
 * 그래서 판정 로직은 전부 여기 있고, 서버가 권위 있게 실행한다.
 * 클라이언트는 같은 코드를 예측(prediction) 재생에만 쓴다.
 */

// 타입
export * from './types/core.js';
export * from './types/combat.js';
export * from './types/item.js';
export * from './types/quest.js';
export * from './types/world.js';

// 공식 (기획서 6-1 / 6-3-5 / 11-2 / 11-3)
export * from './formulas/combat.js';
export * from './formulas/progression.js';

// 액션 전투 코어 (기획서 6-3)
export * from './combat/hitbox.js';
export * from './combat/actionState.js';
export * from './combat/stamina.js';
export * from './combat/poise.js';
export * from './combat/guard.js';
export * from './combat/combatant.js';

// 장비 (기획서 6-4)
export * from './items/affix.js';
export * from './items/enhance.js';

// 퀘스트 (기획서 9)
export * from './quest/engine.js';

// 닉네임 (기획서 4-2)
export * from './validators/nickname.js';
export * from './validators/forbidden.js';

// 데이터
export * from './data/registry.js';
