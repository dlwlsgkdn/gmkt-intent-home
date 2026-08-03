import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'

/*
 * internal API 인증 — core는 BFF만 바라본다 (외부 미노출 경계의 최소 구현).
 * BFF가 `Authorization: Bearer <CORE_SERVICE_TOKEN>` 으로 호출한다.
 * 토큰 미설정 시: 프로덕션이면 전부 거부, 로컬 개발이면 통과(편의).
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.CORE_SERVICE_TOKEN
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('CORE_SERVICE_TOKEN이 설정되지 않았습니다')
      }
      return true
    }
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>()
    const auth = String(req.headers['authorization'] ?? '')
    if (auth === `Bearer ${expected}`) return true
    throw new UnauthorizedException()
  }
}
