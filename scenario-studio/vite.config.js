import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // 개발 중 /api는 Vercel 배포(서버 함수 + Neon DB)로 프록시
    proxy: {
      '/api': { target: 'https://ddak-scenario-studio.vercel.app', changeOrigin: true },
    },
  },
  build: {
    // 표준 GitHub Pages 컨벤션: 빌드 산출물은 저장소 루트의 docs/ 로 내보낸다.
    // (package.json build 스크립트가 legacy/ 도 docs/legacy 로 복사한다)
    outDir: '../docs',
    emptyOutDir: true,
  },
})
