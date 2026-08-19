import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { corsOptions } from './cors'
import { setupDocs } from './docs'

/** 로컬 실행 엔트리 — Vercel에서는 api/index.js(serverless.ts) 경유 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  // 가상 메이크업 정밀 렌더는 사진(data URL)을 본문에 싣는다 — 기본 100kb로는 못 받는다
  app.useBodyParser('json', { limit: '12mb' })
  app.enableCors(corsOptions())
  setupDocs(app)
  const port = Number(process.env.PORT ?? 8788)
  await app.listen(port)
  console.log(`[ddak-bff] listening on http://localhost:${port}`)
}
void bootstrap()
