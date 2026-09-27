import type { Abstract, ClassProvider, Type } from '@nestjs/common'

/*
 * 저장소 선택 — 이 저장소(github.com → Vercel)는 Neon Postgres 를, 커밋을 이관받는 사내 저장소
 * (github.gmarket.com eevee-labatory → 퓨전)는 사내 MongoDB 를 쓴다. 커밋 이관이 충돌 없이 흐르려면
 * 코드는 두 곳이 완전히 같아야 하므로, 어느 구현을 꽂을지는 코드가 아니라 **배포 환경**이 정한다:
 *   CORE_STORE=neon|mongo 가 있으면 그것 → 없으면 MONGO_URI → mongo, DATABASE_URL → neon → 둘 다 없으면 none
 * none 이어도 부팅은 되고(healthz 200, store 필드로 보인다) DB 라우트만 503 을 낸다. 접속 문자열이 둘 다 있으면
 * CORE_STORE 로 명시할 것 — 자동 판정은 mongo 를 먼저 본다(퓨전은 MONGO_URI 가 시크릿으로 실린다).
 * 값이 잘못되면 import 시점에 던져 부팅에서 바로 죽는다 — 조용히 다른 저장소로 가는 것보다 낫다.
 *
 * 배포별 설정: Vercel 프로젝트 env `CORE_STORE=neon`(+Neon 통합의 DATABASE_URL), 퓨전 `.s2i/environment`
 * `CORE_STORE=mongo`(+시크릿 MONGO_URI). 규칙 테스트는 test/store.test.mjs.
 */
export type StoreKind = 'neon' | 'mongo' | 'none'

export function resolveStore(env: Record<string, string | undefined>): StoreKind {
  const explicit = env.CORE_STORE?.trim().toLowerCase()
  if (explicit === 'neon' || explicit === 'mongo') return explicit
  if (explicit) throw new Error(`CORE_STORE 값이 잘못됐습니다: "${env.CORE_STORE}" — neon 또는 mongo`)
  if (env.MONGO_URI) return 'mongo'
  if (env.DATABASE_URL) return 'neon'
  return 'none'
}

/** 이 프로세스가 고른 저장소 — 모듈 정의(데코레이터 평가) 시점에 정해져 있어야 하므로 import 때 한 번 계산한다 */
export const STORE: StoreKind = resolveStore(process.env)

/** 도메인 모듈의 provider 한 줄 — 계약(추상 클래스)을 토큰으로, 이 프로세스의 저장소에 맞는 구현을 useClass 로.
 * none 이면 Neon 구현이 들어가 DB 라우트에서 503 을 낸다(어느 쪽이든 결과는 같다). NoInfer 로 T 는 토큰에서만 추론된다 */
export function storeProvider<T>(token: Abstract<T> | Type<T>, neon: Type<NoInfer<T>>, mongo: Type<NoInfer<T>>): ClassProvider<T> {
  return { provide: token, useClass: STORE === 'mongo' ? mongo : neon }
}

/** DB 라우트가 저장소 없이 불렸을 때의 503 문구 — 어느 설정이 빠졌는지 바로 읽히게 */
export function notConnectedMessage(kind: StoreKind = STORE): string {
  if (kind === 'mongo') return 'Mongo에 연결되지 않았습니다'
  if (kind === 'neon') return 'DATABASE_URL이 설정되지 않았습니다'
  return '저장소가 설정되지 않았습니다 — CORE_STORE 와 DATABASE_URL(Neon) 또는 MONGO_URI(Mongo) 를 주세요'
}
