import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // 빌드 결과물을 저장소 루트의 studio/ 로 내보낸다.
    // GitHub Pages(main 브랜치 서빙)에서 /gmkt-intent-home/studio/ 주소로 열린다.
    outDir: '../studio',
    emptyOutDir: true,
  },
})
