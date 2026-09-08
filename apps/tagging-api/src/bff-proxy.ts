import { Readable } from 'node:stream'
import type { RequestHandler } from 'express'

/*
 * `/api/bff/*` → BFF `/api/*` 프록시.
 *
 * Vercel 배포에서는 루트 middleware.js(엣지)가 같은 일을 한다. 퓨전(OpenShift)에는 엣지가
 * 없고 스튜디오 빌드를 이 서비스가 서빙하므로(main.ts STUDIO_DIST), 같은 rewrite를 여기에 둔다.
 * FE는 어느 배포에서든 same-origin `/api/bff/*` 만 부르면 된다 (lib/liveApi.js).
 *
 * 보안: 서비스 토큰은 서버에서만 읽혀 FE 번들에 실리지 않는다. 클라이언트가 보낸
 * Authorization 은 버리고 우리 토큰으로 덮는다 — 프록시를 우회한 권한 상승을 막는다.
 * 목적지는 BFF_URL 오리진으로 고정이고 경로는 언제나 '/api' 로 시작하므로 임의 호스트로
 * 새어 나가지 않는다.
 */

/** fetch 가 다시 계산하거나 커넥션 단위라 그대로 넘기면 안 되는 헤더들 */
const DROP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'authorization', // 아래에서 서비스 토큰으로 덮는다
])

const DROP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-encoding', // fetch 가 이미 풀어서 준다
  'content-length',
])

/** `/threads/x?y=1` + BFF_URL → `<BFF_URL>/api/threads/x?y=1` */
export function targetUrl(base: string, path: string): string {
  const rest = path.startsWith('/') ? path : `/${path}`
  return new URL(`/api${rest}`, base).toString()
}

export function bffProxy(): RequestHandler | null {
  const base = process.env.BFF_URL
  if (!base) return null
  const token = process.env.BFF_SERVICE_TOKEN

  return (req, res) => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (DROP_REQUEST_HEADERS.has(key) || value == null) continue
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
    if (token) headers.set('authorization', `Bearer ${token}`)

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    fetch(targetUrl(base, req.url), {
      method: req.method,
      headers,
      // 본문을 버퍼에 모으지 않고 그대로 흘린다 — 12MB 사진(정밀 렌더)도 통과한다
      body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
    } as RequestInit)
      .then((upstream) => {
        upstream.headers.forEach((value, key) => {
          if (!DROP_RESPONSE_HEADERS.has(key)) res.setHeader(key, value)
        })
        res.status(upstream.status)
        // SSE(라이브 생성 스트림)를 위해 응답도 도착하는 대로 흘려보낸다
        if (!upstream.body) return void res.end()
        res.flushHeaders?.()
        Readable.fromWeb(upstream.body as never).pipe(res)
      })
      .catch((err: unknown) => {
        if (res.headersSent) return void res.end()
        res.status(502).json({
          error: 'bff_unreachable',
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }
}
