import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { setupDocs } from './docs'

/*
 * Vercel 서버리스 부트스트랩 — api/index.js가 콜드스타트당 1회 호출해
 * 언더라잉 Express 인스턴스를 (req, res) 핸들러로 재사용한다.
 */
export async function createServer(): Promise<(req: unknown, res: unknown) => void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] })
  setupDocs(app)
  await app.init()
  return app.getHttpAdapter().getInstance()
}
