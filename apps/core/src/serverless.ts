import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { setupDocs } from './docs'

/*
 * Vercel 서버리스 부트스트랩 — api/index.js가 콜드스타트당 1회 호출해
 * 언더라잉 Express 인스턴스를 (req, res) 핸들러로 재사용한다.
 */
export async function createServer(): Promise<(req: unknown, res: unknown) => void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] })
  // 카탈로그 일괄 upsert(≤500행, 태그·검색 텍스트 포함)는 기본 100kb 를 넘긴다 — 운영 413 (2026-09-18)
  app.useBodyParser('json', { limit: '4mb' })
  setupDocs(app)
  await app.init()
  return app.getHttpAdapter().getInstance()
}
