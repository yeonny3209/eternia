import { defineConfig } from 'vite';

/**
 * GitHub Pages는 https://<user>.github.io/<repo>/ 아래로 서빙되므로
 * base 경로를 저장소 이름에 맞춰야 한다. 로컬 개발에서는 '/'.
 */
const base = process.env.PAGES_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
});
