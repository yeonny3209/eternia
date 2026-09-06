/**
 * 기획서 4-2 닉네임 규칙 검증.
 * 기획서 16부 프롬프트 예시가 요구한 20케이스(한글/영문/금칙어/중복/유사문자 정규화)를 포함한다.
 */
import { describe, expect, it } from 'vitest';
import {
  canChangeNickname,
  checkNickname,
  isConfusable,
  nicknameKey,
  suggestNickname,
  validateNickname,
} from './nickname.js';

describe('validateNickname — 길이 (한글 2~8 / 영문 4~16, 혼용 시 한글 기준)', () => {
  it('01. 한글 2자는 통과', () => {
    expect(validateNickname('아리')).toBeNull();
  });

  it('02. 한글 1자는 TOO_SHORT', () => {
    expect(validateNickname('아')).toBe('TOO_SHORT');
  });

  it('03. 한글 8자는 통과', () => {
    expect(validateNickname('잿빛방랑자하나둘')).toBeNull();
  });

  it('04. 한글 9자는 TOO_LONG', () => {
    expect(validateNickname('잿빛방랑자하나둘셋')).toBe('TOO_LONG');
  });

  it('05. 영문 4자는 통과, 3자는 TOO_SHORT', () => {
    expect(validateNickname('Aria')).toBeNull();
    expect(validateNickname('Ari')).toBe('TOO_SHORT');
  });

  it('06. 영문 16자는 통과, 17자는 TOO_LONG', () => {
    expect(validateNickname('AbcdefghijKlmnop')).toBeNull();
    expect(validateNickname('AbcdefghijKlmnopq')).toBe('TOO_LONG');
  });

  it('07. 혼용은 한글 기준(2~8)을 적용한다 — 영문 5자+한글 1자=6자 통과', () => {
    expect(validateNickname('Aria검')).toBeNull();
  });

  it('08. 혼용이 9자면 TOO_LONG (영문 기준이었다면 통과했을 길이)', () => {
    expect(validateNickname('Aria검사입니다')).toBe('TOO_LONG');
  });
});

describe('validateNickname — 문자 종류', () => {
  it('09. 공백은 INVALID_CHAR', () => {
    expect(validateNickname('아리 아')).toBe('INVALID_CHAR');
  });

  it('10. 특수문자는 INVALID_CHAR', () => {
    expect(validateNickname('아리@검')).toBe('INVALID_CHAR');
  });

  it('11. 이모지는 INVALID_CHAR', () => {
    expect(validateNickname('아리🔥검')).toBe('INVALID_CHAR');
  });

  it('12. 자음 단독(ㅋㅋㅋ)은 INCOMPLETE_HANGUL', () => {
    expect(validateNickname('ㅋㅋㅋㅋ')).toBe('INCOMPLETE_HANGUL');
  });

  it('13. 모음 단독(ㅏㅏㅏ)은 INCOMPLETE_HANGUL', () => {
    expect(validateNickname('ㅏㅏㅏㅏ')).toBe('INCOMPLETE_HANGUL');
  });

  it('14. 완성형 사이에 자모가 섞여도 INCOMPLETE_HANGUL', () => {
    expect(validateNickname('아리ㅋ검')).toBe('INCOMPLETE_HANGUL');
  });
});

describe('validateNickname — 숫자 규칙', () => {
  it('15. 전체가 숫자면 ALL_DIGITS', () => {
    expect(validateNickname('12345')).toBe('ALL_DIGITS');
  });

  it('16. 첫 글자가 숫자면 LEADING_DIGIT', () => {
    expect(validateNickname('1아리검')).toBe('LEADING_DIGIT');
  });

  it('17. 숫자가 뒤에 붙는 것은 허용', () => {
    expect(validateNickname('잿빛방랑자07')).toBeNull();
  });
});

describe('validateNickname — 금칙어', () => {
  it('18. 운영자 사칭(GM/운영자/Admin/공지)은 FORBIDDEN_WORD', () => {
    expect(validateNickname('GM아리')).toBe('FORBIDDEN_WORD');
    expect(validateNickname('운영자님')).toBe('FORBIDDEN_WORD');
    expect(validateNickname('AdminUser')).toBe('FORBIDDEN_WORD');
    expect(validateNickname('공지사항')).toBe('FORBIDDEN_WORD');
  });

  it('19. 욕설은 FORBIDDEN_WORD', () => {
    expect(validateNickname('씨발놈')).toBe('FORBIDDEN_WORD');
    expect(validateNickname('FuckYou')).toBe('FORBIDDEN_WORD');
  });

  it('20. 유사문자·반복문자로 금칙어를 우회해도 잡는다', () => {
    // A4dmin → aadmin → admin, ADM1N → admin, GGGM → gm
    expect(validateNickname('A4dminUser')).toBe('FORBIDDEN_WORD');
    expect(validateNickname('ADM1NUser')).toBe('FORBIDDEN_WORD');
    expect(validateNickname('GGGMaria')).toBe('FORBIDDEN_WORD');
  });

  it('20-b. 첫 글자 숫자 검사가 금칙어 검사보다 먼저 보고된다', () => {
    // 순서가 바뀌면 유저는 "숫자로 시작할 수 없다"는 더 구체적인 안내를 못 받는다
    expect(validateNickname('4dminUser')).toBe('LEADING_DIGIT');
  });
});

describe('nicknameKey — 정규화와 중복/사칭 판정', () => {
  it('21. 대소문자를 무시한다 (Aria == aria)', () => {
    expect(nicknameKey('Aria')).toBe(nicknameKey('aria'));
    expect(isConfusable('Aria', 'aria')).toBe(true);
  });

  it('22. 혼동 문자 0/O, 1/l/I를 접는다', () => {
    expect(isConfusable('Ar1a', 'Arla')).toBe(true);
    expect(isConfusable('B0RON', 'boron')).toBe(true);
  });

  it('23. 서로 다른 이름은 사칭으로 보지 않는다', () => {
    expect(isConfusable('Aria', 'Arya')).toBe(false);
  });

  it('24. 앞뒤 공백은 trim 후 판정한다', () => {
    expect(nicknameKey('  Aria  ')).toBe('aria');
  });
});

describe('checkNickname — 형식 + 중복', () => {
  it('25. 형식이 맞고 중복이 없으면 ok', () => {
    const result = checkNickname('잿빛방랑자07', false);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it('26. 중복이면 DUPLICATE와 안내 문구를 반환한다', () => {
    const result = checkNickname('잿빛방랑자07', true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('DUPLICATE');
    expect(result.message).toContain('이미 사용');
  });

  it('27. 형식 오류가 중복보다 먼저 보고된다', () => {
    expect(checkNickname('ㅋㅋㅋㅋ', true).error).toBe('INCOMPLETE_HANGUL');
  });
});

describe('suggestNickname — 추천 닉네임', () => {
  it('28. 생성된 추천 닉네임은 항상 검증을 통과한다', () => {
    let seed = 0;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i += 1) {
      const name = suggestNickname(rng);
      expect(validateNickname(name), `실패한 추천 닉네임: ${name}`).toBeNull();
    }
  });
});

describe('canChangeNickname — 변경 정책 (최초 무료 1회, 30일 쿨다운)', () => {
  const now = Date.UTC(2026, 0, 31);

  it('29. 이력이 없으면 무료 변경', () => {
    const verdict = canChangeNickname({ usedFreeChange: false, lastChangedAt: null }, now);
    expect(verdict).toEqual({ allowed: true, cost: 'FREE' });
  });

  it('30. 무료 변경을 썼고 30일이 지났으면 아이템 소모로 가능', () => {
    const verdict = canChangeNickname(
      { usedFreeChange: true, lastChangedAt: now - 31 * 86_400_000 },
      now,
    );
    expect(verdict).toEqual({ allowed: true, cost: 'ITEM' });
  });

  it('31. 30일 쿨다운 중이면 거부하고 가능 시각을 알려준다', () => {
    const lastChangedAt = now - 10 * 86_400_000;
    const verdict = canChangeNickname({ usedFreeChange: true, lastChangedAt }, now);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('COOLDOWN');
      expect(verdict.availableAt).toBe(lastChangedAt + 30 * 86_400_000);
    }
  });
});
