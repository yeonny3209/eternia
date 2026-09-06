/** M0 API 통합 테스트 — 회원가입 / 로그인 / 닉네임 / 캐릭터 생성 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from '../index.js';

function app() {
  return createServer().app;
}

async function registerAndLogin(server: ReturnType<typeof app>, email = 'test@eternia.gg') {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'password123' });
  return res.body.token as string;
}

describe('GET /api/health', () => {
  it('데이터 규모와 함께 살아 있다고 답한다', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.maps).toBe(19);
    expect(res.body.data.classes).toBe(10);
  });
});

describe('POST /api/auth/register', () => {
  it('정상 가입 시 토큰을 준다', async () => {
    const res = await request(app())
      .post('/api/auth/register')
      .send({ email: 'a@eternia.gg', password: 'password123' });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
  });

  it('이메일 형식이 틀리면 400', async () => {
    const res = await request(app())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_EMAIL');
  });

  it('약한 비밀번호는 400', async () => {
    const res = await request(app())
      .post('/api/auth/register')
      .send({ email: 'b@eternia.gg', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('WEAK_PASSWORD');
  });

  it('중복 이메일은 409', async () => {
    const server = app();
    await request(server).post('/api/auth/register').send({ email: 'c@eternia.gg', password: 'password123' });
    const res = await request(server)
      .post('/api/auth/register')
      .send({ email: 'c@eternia.gg', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('비밀번호는 평문으로 저장되지 않는다', async () => {
    const { app: server, repo } = createServer();
    await request(server).post('/api/auth/register').send({ email: 'd@eternia.gg', password: 'password123' });
    const account = await repo.findAccountByEmail('d@eternia.gg');
    expect(account?.passwordHash).not.toBe('password123');
    expect(account?.passwordHash.length).toBeGreaterThan(20);
  });
});

describe('POST /api/auth/login', () => {
  it('올바른 자격이면 토큰을 준다', async () => {
    const server = app();
    await request(server).post('/api/auth/register').send({ email: 'e@eternia.gg', password: 'password123' });
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'e@eternia.gg', password: 'password123' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('틀린 비밀번호는 401이고, 계정 존재 여부를 흘리지 않는다', async () => {
    const server = app();
    await request(server).post('/api/auth/register').send({ email: 'f@eternia.gg', password: 'password123' });

    const wrongPassword = await request(server)
      .post('/api/auth/login')
      .send({ email: 'f@eternia.gg', password: 'wrongpassword1' });
    const noSuchAccount = await request(server)
      .post('/api/auth/login')
      .send({ email: 'nobody@eternia.gg', password: 'password123' });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);
    // 두 응답이 구별되면 계정 존재 여부가 새어 나간다
    expect(wrongPassword.body).toEqual(noSuchAccount.body);
  });
});

describe('GET /api/nickname/check — 기획서 4-2', () => {
  it('정상 닉네임은 ok', async () => {
    const res = await request(app()).get('/api/nickname/check').query({ name: '잿빛방랑자07' });
    expect(res.body.ok).toBe(true);
  });

  it('자음 단독은 거부', async () => {
    const res = await request(app()).get('/api/nickname/check').query({ name: 'ㅋㅋㅋㅋ' });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('INCOMPLETE_HANGUL');
  });

  it('운영자 사칭은 거부', async () => {
    const res = await request(app()).get('/api/nickname/check').query({ name: '운영자아리' });
    expect(res.body.error).toBe('FORBIDDEN_WORD');
  });

  it('이미 쓰는 닉네임은 DUPLICATE', async () => {
    const server = app();
    const token = await registerAndLogin(server, 'g@eternia.gg');
    await request(server)
      .post('/api/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '잿빛방랑자07', background: 'rift_survivor' });

    const res = await request(server).get('/api/nickname/check').query({ name: '잿빛방랑자07' });
    expect(res.body.error).toBe('DUPLICATE');
  });

  it('혼동 문자로 사칭하려 해도 중복으로 잡힌다 (Aria vs Ar1a)', async () => {
    const server = app();
    const token = await registerAndLogin(server, 'h@eternia.gg');
    await request(server)
      .post('/api/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'Aria', background: 'fallen_noble' });

    const res = await request(server).get('/api/nickname/check').query({ name: 'Ar1a' });
    expect(res.body.error).toBe('DUPLICATE');
  });
});

describe('GET /api/nickname/suggest', () => {
  it('추천 닉네임은 항상 유효하다', async () => {
    const server = app();
    for (let i = 0; i < 10; i += 1) {
      const suggested = await request(server).get('/api/nickname/suggest');
      expect(suggested.status).toBe(200);
      const check = await request(server)
        .get('/api/nickname/check')
        .query({ name: suggested.body.nickname });
      expect(check.body.ok, `${suggested.body.nickname}`).toBe(true);
    }
  });
});

describe('POST /api/characters', () => {
  it('인증이 없으면 401', async () => {
    const res = await request(app())
      .post('/api/characters')
      .send({ nickname: '아리아', background: 'fallen_noble' });
    expect(res.status).toBe(401);
  });

  it('생성된 캐릭터는 직업이 없다 — 5레벨에 정한다 (기획서 4-1)', async () => {
    const server = app();
    const token = await registerAndLogin(server, 'i@eternia.gg');
    const res = await request(server)
      .post('/api/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '아리아', background: 'fallen_noble' });

    expect(res.status).toBe(201);
    expect(res.body.character.classId).toBeNull();
    expect(res.body.character.level).toBe(1);
  });

  it('시작 배경 보너스가 반영된다 — 몰락 귀족은 INT+2, 골드 3배', async () => {
    const server = app();
    const token = await registerAndLogin(server, 'j@eternia.gg');
    const res = await request(server)
      .post('/api/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '귀족아리', background: 'fallen_noble' });

    expect(res.body.character.stats.int).toBe(7);
    expect(res.body.character.gold).toBe(900);
  });

  it('알 수 없는 시작 배경은 400', async () => {
    const server = app();
    const token = await registerAndLogin(server, 'k@eternia.gg');
    const res = await request(server)
      .post('/api/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '아리아', background: 'not_a_background' });
    expect(res.status).toBe(400);
  });

  it('클라이언트를 신뢰하지 않는다 — 서버가 닉네임을 다시 검증한다', async () => {
    const server = app();
    const token = await registerAndLogin(server, 'l@eternia.gg');
    const res = await request(server)
      .post('/api/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'GM운영자', background: 'fallen_noble' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FORBIDDEN_WORD');
  });
});

describe('GET /api/data/* — 히든은 노출하지 않는다', () => {
  it('맵 목록에 히든 맵이 없다', async () => {
    const res = await request(app()).get('/api/data/maps');
    expect(res.body.maps.some((m: { hidden: boolean }) => m.hidden)).toBe(false);
    expect(res.body.maps).toHaveLength(17); // 19 - 히든 2
  });

  it('퀘스트 목록에 히든 퀘스트가 없다', async () => {
    const res = await request(app()).get('/api/data/quests');
    expect(res.body.quests.some((q: { type: string }) => q.type === 'HIDDEN')).toBe(false);
  });

  it('직업 목록에 히든 직업의 해금 조건이 없다', async () => {
    const res = await request(app()).get('/api/data/classes');
    expect(res.body.hiddenCount).toBe(7);
    expect(JSON.stringify(res.body)).not.toContain('unlockSteps');
  });
});
