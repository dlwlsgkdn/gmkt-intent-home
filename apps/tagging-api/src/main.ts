import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  /* 전역 접두사는 'api' — 태깅은 컨트롤러가 'tagging'을 붙여 외부 주소(/api/tagging/*)는
     그대로고, 새 워크스페이스 상태 API가 /api/state/* 로 나란히 붙는다. */
  app.setGlobalPrefix('api')
  /* 운영 배치: FE와 API가 같은 오리진이어야 한다(https 페이지에서 http 사내 API를
     부르면 mixed content로 막힌다). 그래서 이 서비스가 스튜디오 빌드를 함께 서빙한다. */
  const dist = process.env.STUDIO_DIST
  if (dist) app.useStaticAssets(dist)
  /* 보안: 이 API는 인증 게이트가 없고 공유 운영 데이터(Mongo 카탈로그)에 쓰기가 가능하다.
     기본값은 같은 기계에서만 닿는 루프백 주소(127.0.0.1)로 제한하고, 사내 서버 배포 시에만
     HOST=0.0.0.0을 명시적으로 설정하게 한다. 그 경우 앞단에 인증(사내 SSO 프록시 등)을 반드시 둬야 한다. */
  const port = Number(process.env.PORT || 8790)
  const host = process.env.HOST || '127.0.0.1'
  await app.listen(port, host)
}
bootstrap()
