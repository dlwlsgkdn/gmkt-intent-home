import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // 표준 GitHub Pages 컨벤션: 빌드 산출물은 저장소 루트의 docs/ 로 내보낸다.
    // (package.json build 스크립트가 legacy/ 도 docs/legacy 로 복사한다)
    outDir: '../docs',
    emptyOutDir: true,
  },
})
