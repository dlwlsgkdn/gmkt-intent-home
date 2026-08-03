import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { corsOptions } from './cors'
import { setupDocs } from './docs'

/** Vercel 서버리스 부트스트랩 — api/index.js가 콜드스타트당 1회 호출 */
export async function createServer(): Promise<(req: unknown, res: unknown) => void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })
  app.enableCors(corsOptions())
  setupDocs(app)
  await app.init()
  return app.getHttpAdapter().getInstance()
}
