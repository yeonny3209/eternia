/**
 * 닉네임 검증 데모 — 기획서 4-2.
 *
 * 실서비스에서는 400ms 디바운스 후 서버에 중복 조회를 보낸다.
 * 여기서는 서버 없이 돌려야 하므로 형식 검사만 로컬로 하고,
 * 중복은 가상의 "이미 쓰는 닉네임" 목록으로 흉내낸다.
 *
 * 중요한 것은 **같은 함수**를 서버(`/api/nickname/check`)도 쓴다는 점이다.
 */
import {
  NICKNAME_ERROR_MESSAGES,
  checkNickname,
  nicknameKey,
  suggestNickname,
  type NicknameError,
} from '@eternia/shared';

/** 이미 누군가 쓰고 있다고 가정하는 닉네임 */
const TAKEN = ['Aria', '잿빛방랑자07', '무명의검객'];
const TAKEN_KEYS = new Set(TAKEN.map(nicknameKey));

const EXAMPLES = [
  '아리',
  '아',
  'Aria',
  'Ari',
  'Ar1a',
  '잿빛방랑자하나둘셋',
  'ㅋㅋㅋㅋ',
  '아리 아',
  '아리🔥검',
  '12345',
  '1아리검',
  'GM아리',
  '운영자님',
  'ADM1NUser',
];

export function renderNickname(root: HTMLElement): void {
  root.innerHTML = `
    <div class="panel">
      <h2>닉네임 검증기</h2>
      <p class="hint">
        기획서 4-2절 규칙을 그대로 구현했다. 한글 2~8자 / 영문 4~16자(혼용 시 한글 기준),
        자모 단독 금지, 전체 숫자·첫 글자 숫자 금지, 금칙어 필터,
        그리고 <strong>혼동 문자 정규화</strong>(<code>0/O</code>, <code>1/l/I</code>)로 사칭을 막는다.
      </p>

      <div class="nick-input">
        <input id="nick" type="text" placeholder="닉네임을 입력하세요" autocomplete="off" spellcheck="false" />
        <button id="suggest" type="button">추천 닉네임</button>
      </div>
      <div id="verdict" class="verdict">입력을 기다리는 중…</div>

      <h3>눌러보기</h3>
      <div class="examples">
        ${EXAMPLES.map((example) => `<button type="button" data-ex="${example}">${example}</button>`).join('')}
      </div>

      <div class="note">
        이미 사용 중이라고 가정한 닉네임: ${TAKEN.map((t) => `<code>${t}</code>`).join(', ')}<br />
        <code>Ar1a</code>를 넣어 보면 <code>Aria</code>와 같은 것으로 취급돼 중복 처리된다 — 사칭 방지.
      </div>

      <h3>변경 정책</h3>
      <p class="hint" style="margin:0">
        최초 1회 무료, 이후 '이름의 증표' 소모. 변경 후 30일 쿨다운.
        이전 닉네임은 30일간 예약 보존된다.
      </p>
    </div>`;

  const input = root.querySelector<HTMLInputElement>('#nick') as HTMLInputElement;
  const verdict = root.querySelector<HTMLDivElement>('#verdict') as HTMLDivElement;
  const suggestButton = root.querySelector<HTMLButtonElement>('#suggest') as HTMLButtonElement;

  const evaluate = (): void => {
    const raw = input.value;
    if (raw.trim().length === 0) {
      verdict.className = 'verdict';
      verdict.textContent = '입력을 기다리는 중…';
      return;
    }

    const key = nicknameKey(raw);
    const result = checkNickname(raw, TAKEN_KEYS.has(key));

    if (result.ok) {
      verdict.className = 'verdict ok';
      verdict.innerHTML = `✅ 사용할 수 있습니다 &nbsp;<code>정규화 키: ${key}</code>`;
      return;
    }

    verdict.className = 'verdict bad';
    verdict.innerHTML = `❌ ${result.message} &nbsp;<code>${result.error as NicknameError}</code>`;
  };

  // 실서비스의 400ms 디바운스를 그대로 흉내낸다
  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(evaluate, 400);
  });

  suggestButton.addEventListener('click', () => {
    let candidate = suggestNickname();
    for (let i = 0; i < 20 && TAKEN_KEYS.has(nicknameKey(candidate)); i += 1) {
      candidate = suggestNickname();
    }
    input.value = candidate;
    evaluate();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.ex as string;
      evaluate();
    });
  });

  // 오류 코드 전체 목록을 콘솔에 남겨 둔다 (개발용)
  console.debug('닉네임 오류 코드', NICKNAME_ERROR_MESSAGES);
}
