/**
 * REST 라우트 — 기획서 M0 범위.
 *
 * 회원가입 / 로그인 / 닉네임 검사 / 캐릭터 생성.
 * 기획서 2-2 원칙대로 모든 검증은 서버에서 다시 한다.
 * 클라이언트의 검사는 UX용일 뿐 신뢰하지 않는다.
 */
import { Router } from 'express';
import {
  BACKGROUND_BONUSES,
  buildStartingCharacter,
} from '../services/character.js';
import {
  checkNickname,
  dataSummary,
  nicknameKey,
  suggestNickname,
  CLASSES,
  HIDDEN_CLASSES,
  MAPS,
  QUESTS,
  DUNGEONS,
  RAIDS,
} from '@eternia/shared';
import type { Repository } from '../db/repository.js';
import {
  hashPassword,
  isValidEmail,
  issueToken,
  passwordIssue,
  requireAuth,
  verifyPassword,
  type AuthedRequest,
} from '../services/auth.js';

export function createRoutes(repo: Repository): Router {
  const router = Router();

  /* ------------------------------ 상태 ------------------------------ */

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'eternia-server', data: dataSummary() });
  });

  /* ------------------------------ 인증 ------------------------------ */

  router.post('/auth/register', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'BAD_REQUEST', message: '이메일과 비밀번호가 필요합니다.' });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'INVALID_EMAIL', message: '이메일 형식이 올바르지 않습니다.' });
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      res.status(400).json({ error: 'WEAK_PASSWORD', message: issue });
      return;
    }
    if (await repo.findAccountByEmail(email)) {
      res.status(409).json({ error: 'EMAIL_TAKEN', message: '이미 가입된 이메일입니다.' });
      return;
    }

    const account = await repo.createAccount(email, await hashPassword(password));
    res.status(201).json({
      token: issueToken({ accountId: account.id, email: account.email }),
      account: { id: account.id, email: account.email },
    });
  });

  router.post('/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'BAD_REQUEST', message: '이메일과 비밀번호가 필요합니다.' });
      return;
    }
    const account = await repo.findAccountByEmail(email);
    // 계정 존재 여부를 응답으로 흘리지 않는다
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    res.json({
      token: issueToken({ accountId: account.id, email: account.email }),
      account: { id: account.id, email: account.email },
    });
  });

  /* ---------------------------- 닉네임 ------------------------------ */

  // 기획서 4-2 UX: 입력 즉시 디바운스 400ms로 중복 검사 → 실시간 ✅/❌
  router.get('/nickname/check', async (req, res) => {
    const name = String(req.query.name ?? '');
    const key = nicknameKey(name);
    const taken = key.length > 0 ? await repo.isNicknameTaken(key) : false;
    const result = checkNickname(name, taken);
    res.json(result);
  });

  router.get('/nickname/suggest', async (_req, res) => {
    // 중복이 아닌 것이 나올 때까지 몇 번 시도한다
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = suggestNickname();
      if (!(await repo.isNicknameTaken(nicknameKey(candidate)))) {
        res.json({ nickname: candidate });
        return;
      }
    }
    res.status(503).json({ error: 'SUGGEST_FAILED', message: '추천 닉네임 생성에 실패했습니다.' });
  });

  /* ---------------------------- 캐릭터 ------------------------------ */

  router.get('/characters', requireAuth, async (req: AuthedRequest, res) => {
    const characters = await repo.listCharacters(req.auth?.accountId as string);
    res.json({ characters });
  });

  router.post('/characters', requireAuth, async (req: AuthedRequest, res) => {
    const { nickname, background } = req.body ?? {};
    if (typeof nickname !== 'string' || typeof background !== 'string') {
      res.status(400).json({ error: 'BAD_REQUEST', message: '닉네임과 시작 배경이 필요합니다.' });
      return;
    }
    if (!(background in BACKGROUND_BONUSES)) {
      res.status(400).json({ error: 'INVALID_BACKGROUND', message: '알 수 없는 시작 배경입니다.' });
      return;
    }

    const key = nicknameKey(nickname);
    const taken = await repo.isNicknameTaken(key);
    const check = checkNickname(nickname, taken);
    if (!check.ok) {
      res.status(400).json({ error: check.error, message: check.message });
      return;
    }

    const character = await repo.createCharacter(
      buildStartingCharacter({
        accountId: req.auth?.accountId as string,
        nickname: nickname.trim(),
        nicknameKey: key,
        background: background as never,
      }),
    );
    res.status(201).json({ character });
  });

  /* ----------------------------- 데이터 ------------------------------ */
  // 클라이언트가 도감·직업 선택 UI에 쓰는 읽기 전용 데이터.
  // 히든 퀘스트는 여기에 절대 포함하지 않는다(기획서 9-3).

  router.get('/data/summary', (_req, res) => res.json(dataSummary()));

  router.get('/data/classes', (_req, res) => {
    res.json({
      classes: CLASSES,
      // 히든 직업은 존재 자체가 힌트이므로 이름만 준다. 해금 조건은 서버에만 있다.
      hiddenCount: HIDDEN_CLASSES.length,
    });
  });

  router.get('/data/maps', (_req, res) => {
    // 지도에 없는 히든 맵은 목록에서 뺀다
    res.json({ maps: MAPS.filter((m) => !m.hidden) });
  });

  router.get('/data/quests', (req, res) => {
    const mapId = req.query.map ? String(req.query.map) : null;
    const visible = QUESTS.filter((q) => q.type !== 'HIDDEN');
    res.json({ quests: mapId ? visible.filter((q) => q.map === mapId) : visible });
  });

  router.get('/data/content', (_req, res) => res.json({ dungeons: DUNGEONS, raids: RAIDS }));

  return router;
}
