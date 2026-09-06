/**
 * 기획서 4-2 — 금칙어 필터.
 *
 * 운영자 사칭이 최우선 차단 대상이다. 사칭은 사기 피해로 직결되기 때문이다.
 * 욕설·성적 표현은 대표 어근만 두고, 실제 서비스에서는 외부 사전으로 교체한다.
 * (여기 목록을 무한정 늘리는 방식은 유지보수가 불가능하다.)
 */

/** 운영자 사칭 — 부분 일치로 차단 */
export const IMPERSONATION_WORDS = [
  'gm',
  'admin',
  'administrator',
  'moderator',
  'staff',
  'official',
  'system',
  'support',
  'operator',
  '운영자',
  '운영',
  '관리자',
  '관리',
  '공지',
  '공식',
  '고객센터',
  '지에므',
  '에테르니아운영',
];

/** 욕설·성적 표현 대표 어근 */
export const PROFANITY_WORDS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'dick',
  'pussy',
  'rape',
  'nigger',
  'faggot',
  'sex',
  'porn',
  '씨발',
  '시발',
  '씹',
  '병신',
  '지랄',
  '좆',
  '섹스',
  '보지',
  '자지',
  '개새끼',
  '새끼',
  '창녀',
  '강간',
  '느금',
  '니애미',
];

/** 서비스 운영상 예약하는 단어 */
export const RESERVED_WORDS = ['eternia', '에테르니아', 'null', 'undefined', 'anonymous', '탈퇴'];

export const FORBIDDEN_WORDS = [
  ...IMPERSONATION_WORDS,
  ...PROFANITY_WORDS,
  ...RESERVED_WORDS,
] as const;

/**
 * 금칙어 회피 시도까지 잡기 위한 검사용 정규화.
 * 유사문자를 되돌리고(0→o, 1→i), 반복 문자를 접는다(fffuck → fuck).
 */
export function normalizeForFilter(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/(.)\1+/g, '$1');
}

export function containsForbiddenWord(raw: string): string | null {
  const normalized = normalizeForFilter(raw);
  const lower = raw.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    if (lower.includes(word) || normalized.includes(normalizeForFilter(word))) return word;
  }
  return null;
}
