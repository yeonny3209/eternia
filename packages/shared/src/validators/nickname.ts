/**
 * 기획서 4-2 — 닉네임 시스템 (서버 검증 필수).
 *
 * | 항목 | 값 |
 * | 길이 | 한글 2~8자 / 영문 4~16자 (혼용 시 한글 기준) |
 * | 허용 문자 | 한글 완성형, 영문 대소문자, 숫자 |
 * | 금지 | 공백, 특수문자, 이모지, 자음/모음 단독(ㅋㅋㅋ, ㅏㅏㅏ) |
 * | 숫자 | 전체가 숫자면 불가. 첫 글자 숫자 불가 |
 * | 중복 | 전 서버 유일 (대소문자 무시 비교, Aria == aria) |
 * | 유사문자 | 혼동 문자 정규화 후 비교 (0/O, 1/l/I) → 사칭 방지 |
 * | 금칙어 | 욕설·성적 표현·운영자 사칭 필터 |
 *
 * DB에는 nickname(표시용 원문)과 nicknameKey(정규화, UNIQUE) 두 컬럼을 둔다.
 */
import { containsForbiddenWord } from './forbidden.js';

export type NicknameError =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_CHAR'
  | 'INCOMPLETE_HANGUL'
  | 'ALL_DIGITS'
  | 'LEADING_DIGIT'
  | 'FORBIDDEN_WORD'
  | 'DUPLICATE';

export const NICKNAME_ERROR_MESSAGES: Record<NicknameError, string> = {
  TOO_SHORT: '닉네임이 너무 짧습니다. (한글 2자 / 영문 4자 이상)',
  TOO_LONG: '닉네임이 너무 깁니다. (한글 8자 / 영문 16자 이하)',
  INVALID_CHAR: '한글·영문·숫자만 사용할 수 있습니다. (공백·특수문자·이모지 불가)',
  INCOMPLETE_HANGUL: '자음이나 모음만 단독으로 쓸 수 없습니다.',
  ALL_DIGITS: '숫자만으로는 만들 수 없습니다.',
  LEADING_DIGIT: '첫 글자는 숫자일 수 없습니다.',
  FORBIDDEN_WORD: '사용할 수 없는 단어가 포함되어 있습니다.',
  DUPLICATE: '이미 사용 중인 닉네임입니다.',
};

/** 한글 완성형 (가 ~ 힣) */
const HANGUL_SYLLABLE = /[가-힣]/;
/** 호환 자모 — ㅋㅋㅋ, ㅏㅏㅏ 같은 단독 자음/모음 */
const HANGUL_JAMO = /[ㄱ-ㆎᄀ-ᇿꥠ-꥿ힰ-퟿]/;
/** 허용 문자 전체 */
const ALLOWED = /^[가-힣A-Za-z0-9]+$/;

export const HANGUL_MIN = 2;
export const HANGUL_MAX = 8;
export const LATIN_MIN = 4;
export const LATIN_MAX = 16;

/** 표시 이름을 문자 단위 배열로 — 이모지/서로게이트 페어를 한 글자로 센다 */
function chars(s: string): string[] {
  return Array.from(s);
}

export function hasHangul(s: string): boolean {
  return HANGUL_SYLLABLE.test(s);
}

/**
 * 형식 검사. 중복(DUPLICATE)은 여기서 판정하지 않는다 —
 * 그건 DB 조회가 필요하므로 서버의 isNicknameAvailable()이 담당한다.
 */
export function validateNickname(raw: string): NicknameError | null {
  const name = raw.trim();
  const cs = chars(name);

  if (cs.length === 0) return 'TOO_SHORT';

  // 자음/모음 단독은 '허용 문자 아님'보다 구체적인 오류를 준다
  if (HANGUL_JAMO.test(name)) return 'INCOMPLETE_HANGUL';

  if (!ALLOWED.test(name)) return 'INVALID_CHAR';

  // 혼용 시 한글 기준
  const korean = hasHangul(name);
  const min = korean ? HANGUL_MIN : LATIN_MIN;
  const max = korean ? HANGUL_MAX : LATIN_MAX;
  if (cs.length < min) return 'TOO_SHORT';
  if (cs.length > max) return 'TOO_LONG';

  if (/^[0-9]+$/.test(name)) return 'ALL_DIGITS';
  if (/^[0-9]/.test(name)) return 'LEADING_DIGIT';

  if (containsForbiddenWord(name)) return 'FORBIDDEN_WORD';

  return null;
}

/**
 * 중복 비교용 정규화 키.
 * 대소문자를 무시하고, 혼동 문자를 하나로 접는다(0/O, 1/l/I).
 * DB의 nicknameKey 컬럼에 UNIQUE 인덱스를 건다.
 */
export function nicknameKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[0]/g, 'o')
    .replace(/[1l|]/g, 'i')
    .replace(/[5]/g, 's')
    .replace(/[2]/g, 'z')
    .replace(/[8]/g, 'b');
}

/** 두 닉네임이 사칭 관계인가 (Aria vs aria vs Ar1a) */
export function isConfusable(a: string, b: string): boolean {
  return nicknameKey(a) === nicknameKey(b);
}

export interface NicknameCheckResult {
  ok: boolean;
  error: NicknameError | null;
  message: string | null;
  key: string;
}

/** 형식 + 중복까지 한 번에. taken은 서버가 넘긴 조회 결과 */
export function checkNickname(raw: string, taken = false): NicknameCheckResult {
  const error = validateNickname(raw);
  const key = nicknameKey(raw);
  if (error) return { ok: false, error, message: NICKNAME_ERROR_MESSAGES[error], key };
  if (taken) {
    return { ok: false, error: 'DUPLICATE', message: NICKNAME_ERROR_MESSAGES.DUPLICATE, key };
  }
  return { ok: true, error: null, message: null, key };
}

/* ------------------------------------------------------------------ */
/* 추천 닉네임 — 기획서 4-2 UX: [형용사][명사][2자리 숫자]              */
/* ------------------------------------------------------------------ */

const ADJECTIVES = [
  '잿빛',
  '고요한',
  '붉은',
  '새벽의',
  '침묵의',
  '떠도는',
  '별빛',
  '무너진',
  '푸른',
  '빛나는',
  '얼어붙은',
  '깊은',
  '흐린',
  '마지막',
  '이름없는',
  '균열의',
];

const NOUNS = [
  '방랑자',
  '검객',
  '순례자',
  '파수꾼',
  '사냥꾼',
  '기록자',
  '나그네',
  '수호자',
  '탐험가',
  '이방인',
  '추적자',
  '연금술사',
  '점성술사',
  '개척자',
  '망령',
  '불꽃',
];

/**
 * 추천 닉네임 생성. rng를 주입받아 테스트를 결정적으로 만든다.
 * 생성 결과는 반드시 validateNickname을 통과한다(한글 8자 상한 고려).
 */
export function suggestNickname(rng: () => number = Math.random): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)] as string;
    const noun = NOUNS[Math.floor(rng() * NOUNS.length)] as string;
    const num = String(Math.floor(rng() * 100)).padStart(2, '0');
    const candidate = `${adj}${noun}${num}`;
    if (validateNickname(candidate) === null) return candidate;
    // 8자를 넘으면 형용사를 빼고 재시도
    const short = `${noun}${num}`;
    if (validateNickname(short) === null) return short;
  }
  return `방랑자${Math.floor(rng() * 90 + 10)}`;
}

/* ------------------------------------------------------------------ */
/* 닉네임 변경 정책 — 기획서 4-2                                       */
/* ------------------------------------------------------------------ */

export const NICKNAME_CHANGE_COOLDOWN_DAYS = 30;
/** 이전 닉은 30일간 예약 보존 후 해제 */
export const NICKNAME_RESERVATION_DAYS = 30;

export interface NicknameChangePolicy {
  /** 무료 변경권을 이미 썼는가 */
  usedFreeChange: boolean;
  /** 마지막 변경 시각(ms). 없으면 변경 이력 없음 */
  lastChangedAt: number | null;
}

export type NicknameChangeVerdict =
  | { allowed: true; cost: 'FREE' | 'ITEM' }
  | { allowed: false; reason: 'COOLDOWN'; availableAt: number };

/** 최초 무료 1회, 이후 '이름의 증표' 소모. 변경 후 30일 쿨다운 */
export function canChangeNickname(
  policy: NicknameChangePolicy,
  nowMs: number,
): NicknameChangeVerdict {
  if (policy.lastChangedAt !== null) {
    const availableAt = policy.lastChangedAt + NICKNAME_CHANGE_COOLDOWN_DAYS * 86_400_000;
    if (nowMs < availableAt) return { allowed: false, reason: 'COOLDOWN', availableAt };
  }
  return { allowed: true, cost: policy.usedFreeChange ? 'ITEM' : 'FREE' };
}
