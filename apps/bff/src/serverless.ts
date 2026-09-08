import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { corsOptions } from './cors'
import { setupDocs } from './docs'

/** Vercel 서버리스 부트스트랩 — api/index.js가 콜드스타트당 1회 호출.
 *  반환값은 express 앱 자체다 — Vercel 이 넘기는 Node 의 req/res 를 그대로 받는다. */
export async function createServer(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] })
  // 가상 메이크업 정밀 렌더는 사진(data URL)을 본문에 싣는다 — 기본 100kb로는 못 받는다
  app.useBodyParser('json', { limit: '12mb' })
  app.enableCors(corsOptions())
  setupDocs(app)
  await app.init()
  return app.getHttpAdapter().getInstance()
}
