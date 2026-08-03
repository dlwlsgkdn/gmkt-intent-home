import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { setupDocs } from './docs'

/** 로컬 실행 엔트리 — Vercel에서는 api/index.js(serverless.ts) 경유 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  setupDocs(app)
  const port = Number(process.env.PORT ?? 8790)
  await app.listen(port)
  console.log(`[ddak-core] listening on http://localhost:${port} (docs: /docs)`)
}
void bootstrap()
