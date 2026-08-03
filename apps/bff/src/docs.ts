import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

/*
 * API 문서 — Swagger UI(/docs) + OpenAPI JSON(/docs-json).
 * UI 정적 자산은 CDN 로드 (Vercel 서버리스 번들 트레이싱 404 회피). 끄려면 API_DOCS=0.
 * 계약의 단일 출처는 @ddak/schema(zod) — 컨트롤러 데코레이터가 toOpenApi로 변환해 싣는다.
 */
export function setupDocs(app: INestApplication) {
  if (process.env.API_DOCS === '0') return
  const config = new DocumentBuilder()
    .setTitle('ddak-bff threads API')
    .setDescription(
      'DDAK 저니 오케스트레이션 — FE 대상 API. FE는 스튜디오 same-origin 경로(`/api/bff/*`)로 호출하고 ' +
        '엣지 미들웨어가 `Authorization: Bearer <BFF_SERVICE_TOKEN>` 을 주입한다(토큰 설정 시 직접 호출은 401). ' +
        '사용자 식별은 `x-device-id` 헤더(익명 디바이스 id). ' +
        '설문·계획 생성은 SSE(`event: status → result | error`)로 응답한다. ' +
        'LLM 실패 시 가짜 콘텐츠 대신 실패 안내(`error { code, message, retryable }`)를 보낸다.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'ddak-bff API',
    customCssUrl: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
    customJs: [
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js',
    ],
  })
}
