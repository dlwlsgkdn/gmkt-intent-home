import { createHash, timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'

/*
 * threads API 인증 — bff는 스튜디오 프록시(루트 middleware.js)만 바라본다.
 * 프록시가 `Authorization: Bearer <BFF_SERVICE_TOKEN>` 을 주입해 호출한다.
 * 토큰 미설정 시: 프로덕션이면 전부 거부, 로컬 개발이면 통과(편의 — Vite 프록시는 토큰이 없다).
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.BFF_SERVICE_TOKEN
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('BFF_SERVICE_TOKEN이 설정되지 않았습니다')
      }
      return true
    }
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>()
    const auth = String(req.headers['authorization'] ?? '')
    if (safeEqual(auth, `Bearer ${expected}`)) return true
    throw new UnauthorizedException()
  }
}

/** 문자열 === 는 앞에서부터 비교해 타이밍이 새므로, 해시로 길이를 맞춰 timingSafeEqual */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
