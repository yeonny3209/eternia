/**
 * 에테르니아 게이트웨이 서버 (기획서 2-2).
 *
 * 지금은 REST(M0 범위)만 올라간다. Colyseus 기반 WorldRoom/DungeonRoom은
 * 기획서 M4에서 이 프로세스에 붙인다 — rooms/ 디렉터리가 그 자리다.
 *
 *   npm run dev:server
 */
import cors from 'cors';
import express from 'express';
import { InMemoryRepository } from './db/repository.js';
import { createRoutes } from './routes/index.js';

const PORT = Number(process.env.PORT ?? 4000);

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  const repo = new InMemoryRepository();
  app.use('/api', createRoutes(repo));

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  return { app, repo };
}

// 직접 실행됐을 때만 리슨한다 (테스트에서는 app만 가져다 쓴다)
const isMain = process.argv[1]?.includes('server');
if (isMain) {
  const { app } = createServer();
  app.listen(PORT, () => {
    console.log(`에테르니아 서버가 http://localhost:${PORT} 에서 대기 중`);
    console.log(`  상태 확인: http://localhost:${PORT}/api/health`);
  });
}
