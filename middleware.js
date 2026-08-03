import { rewrite } from '@vercel/edge'

/*
 * 스튜디오 엣지 미들웨어 (Vercel Edge Middleware — 스튜디오 프로젝트 전용, 루트 고정).
 * FE의 same-origin 호출 `/api/bff/*` 를 BFF 배포(`BFF_URL`)의 `/api/*` 로 rewrite 하면서
 * `Authorization: Bearer <BFF_SERVICE_TOKEN>` 을 주입한다 — 토큰은 엣지에서만 읽히고
 * FE 번들에 노출되지 않는다. 미들웨어는 라우팅 결정만 내리고 즉시 끝나므로,
 * SSE 스트림은 엣지 프록시가 들고 있다 (함수 프록시와 달리 실행 시간 이중 과금 없음).
 *
 * 필요 환경변수 (스튜디오 Vercel 프로젝트): BFF_URL, BFF_SERVICE_TOKEN
 * 로컬 개발에는 이 파일이 관여하지 않는다 — vite.config.js 의 /api/bff 프록시가 같은 경로를 맡는다.
 */
export const config = { matcher: '/api/bff/:path*' }

export default function middleware(request) {
  const bffUrl = process.env.BFF_URL
  if (!bffUrl) {
    return new Response(JSON.stringify({ error: 'BFF_URL이 설정되지 않았습니다' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  const url = new URL(request.url)
  const destination = new URL(url.pathname.replace(/^\/api\/bff/, '/api') + url.search, bffUrl)
  const headers = new Headers(request.headers)
  const token = process.env.BFF_SERVICE_TOKEN
  if (token) headers.set('authorization', `Bearer ${token}`)
  return rewrite(destination, { request: { headers } })
}
