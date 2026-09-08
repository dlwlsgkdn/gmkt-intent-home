/* FE가 API를 어느 오리진에서 부를지 정하는 규칙 — 한 곳에만 둔다.
   liveApi(/api/bff)·adminApi(/api/bff/admin)·remote(/api/state) 셋이 같은 규칙을 따라야 한다.

   **같은 오리진이 원칙이다.** 화면과 API를 같이 내보내는 배포가 전부 그렇다:
     - Vercel        — 루트 middleware.js(엣지)가 /api/bff/* 를 BFF로 rewrite
     - 사내 퓨전      — apps/tagging-api 가 스튜디오(STUDIO_DIST)와 /api/* 를 함께 서빙
     - vite 개발 서버 — vite.config.js 프록시

   예외는 API가 없는 순수 정적 호스팅(GitHub Pages)뿐이고, 거기서만 공개 Vercel 배포로
   교차 호출한다.

   과거에는 반대로 "vercel.app·localhost 만 같은 오리진"이라는 허용 목록이었다. 그러면
   사내 배포(*.clouz.io 등)가 목록에 없어 워크스페이스 상태·라이브 생성 요청이 통째로
   공개 Vercel 주소로 나갔다 — 동작도 안 되고 사내 데이터가 사외로 새는 길이었다.
   그래서 "정적 호스팅만 예외"인 거부 목록으로 뒤집었다: 새 배포처가 생겨도 기본이 안전하다. */

/** API가 없는 정적 호스팅 — 여기서만 교차 오리진으로 부른다 */
const STATIC_ONLY_HOST = /(^|\.)github\.io$/i

/** 그 정적 호스팅이 대신 부를 공개 배포 */
export const CROSS_ORIGIN_FALLBACK = 'https://ddak-scenario-studio.vercel.app'

/** 이 호스트에서 API를 같은 오리진으로 부를 수 있는가 */
export function isSameOriginApi(hostname) {
  return !STATIC_ONLY_HOST.test(String(hostname || ''))
}

/** `apiBase('/api/bff')` → 같은 오리진이면 '/api/bff', 정적 호스팅이면 절대 URL */
export function apiBase(path) {
  const hostname = typeof location !== 'undefined' ? location.hostname : ''
  return (isSameOriginApi(hostname) ? '' : CROSS_ORIGIN_FALLBACK) + path
}
