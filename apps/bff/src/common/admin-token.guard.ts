import { createHash, timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'

/*
 * admin API 인증 — 서비스 토큰(프록시 주입)과 별개로, 사람이 아는 관리 토큰을 요구한다.
 * FE 관리 페이지가 입력받은 토큰을 `x-admin-token` 헤더로 보낸다 (엣지 미들웨어를 그대로 통과).
 * ADMIN_TOKEN 미설정 시: 프로덕션이면 전부 거부(fail closed), 로컬 개발이면 통과.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('ADMIN_TOKEN이 설정되지 않았습니다')
      }
      return true
    }
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>()
    const given = String(req.headers['x-admin-token'] ?? '')
    if (given && safeEqual(given, expected)) return true
    throw new UnauthorizedException('관리 토큰이 없거나 일치하지 않습니다')
  }
}

/** 문자열 === 는 앞에서부터 비교해 타이밍이 새므로, 해시로 길이를 맞춰 timingSafeEqual */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
