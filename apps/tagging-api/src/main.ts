import 'dotenv/config'
import { RequestMethod } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { json, urlencoded } from 'express'
import { AppModule } from './app.module'
import { bffProxy } from './bff-proxy'

async function bootstrap() {
  /* 본문 파서를 끄고 직접 단다 — BFF 프록시가 파서보다 먼저 서야 요청 본문을
     버퍼에 모으지 않고 그대로 흘려보낼 수 있다(SSE·12MB 사진). */
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  /* `/api/bff/*` → BFF. Vercel 에서는 루트 middleware.js(엣지)가 맡는 자리를,
     스튜디오를 직접 서빙하는 사내 배포에서는 이 프록시가 대신한다. BFF_URL 이 없으면 달지 않는다. */
  const proxy = bffProxy()
  if (proxy) app.use('/api/bff', proxy)
  /* 워크스페이스 상태 행은 시나리오 통째(stages·planCases)라 express 기본 100kb를 넘는다 */
  app.use(json({ limit: '8mb' }))
  app.use(urlencoded({ extended: true, limit: '1mb' }))
  /* 전역 접두사는 'api' — 태깅은 컨트롤러가 'tagging'을 붙여 외부 주소(/api/tagging/*)는
     그대로고, 새 워크스페이스 상태 API가 /api/state/* 로 나란히 붙는다. */
  /* 헬스체크만 접두사 밖(/health)에 둔다 — 퓨전(OpenShift) 콘솔의 Readiness Probe Path
     기본값이 /health 라, 앱을 거기 맞추면 배포하는 쪽이 그 칸을 손댈 일이 없다. */
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] })
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
