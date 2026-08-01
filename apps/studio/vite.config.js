import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // 개발 중 /api는 Vercel 배포(서버 함수 + Neon DB)로 프록시
    proxy: {
      // secure: false — 사내망 TLS 검사(자체 서명 인증서 체인)에서 node가 핸드셰이크를 거부하는 문제 회피
      // VITE_API_PROXY — 로컬 목 API로 바꿔 운영 DB를 건드리지 않고 동기화 로직을 검증할 때
      '/api': {
        target: process.env.VITE_API_PROXY || 'https://ddak-scenario-studio.vercel.app',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // 빌드 산출물은 기본값 dist/ — 커밋하지 않는다. Vercel은 apps/studio/dist를 서빙하고,
  // GitHub Pages는 .github/workflows/pages.yml이 push마다 빌드해 배포한다.
  // (package.json build 스크립트가 legacy/ 를 dist/legacy 로 복사한다)
})
