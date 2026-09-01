import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.setGlobalPrefix('api/tagging')
  /* 운영 배치: FE와 API가 같은 오리진이어야 한다(https 페이지에서 http 사내 API를
     부르면 mixed content로 막힌다). 그래서 이 서비스가 스튜디오 빌드를 함께 서빙한다. */
  const dist = process.env.STUDIO_DIST
  if (dist) app.useStaticAssets(dist)
  await app.listen(Number(process.env.PORT || 8790))
}
bootstrap()
