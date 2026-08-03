import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

/*
 * API 문서 — Swagger UI(/docs) + OpenAPI JSON(/docs-json).
 * UI 정적 자산은 CDN에서 로드한다 — Vercel 서버리스 번들에 swagger-ui-dist
 * 파일이 트레이싱되지 않아 404가 나는 문제를 피하기 위함.
 * 끄려면 API_DOCS=0. (문서는 공개돼도 호출은 서비스 토큰 필요)
 */
export function setupDocs(app: INestApplication) {
  if (process.env.API_DOCS === '0') return
  const config = new DocumentBuilder()
    .setTitle('ddak-core internal API')
    .setDescription(
      '쓰레드 저장·조회 — BFF 전용. 모든 /internal 경로는 `Authorization: Bearer <CORE_SERVICE_TOKEN>` 필요. ' +
        '계약의 단일 출처는 @ddak/schema(zod)이며 이 문서는 거기서 생성된다.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'ddak-core API',
    customCssUrl: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
    customJs: [
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js',
    ],
  })
}
