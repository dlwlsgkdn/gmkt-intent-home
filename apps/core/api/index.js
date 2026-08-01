// Vercel 서버리스 엔트리 — 빌드된 Nest 앱을 콜드스타트당 1회 부트스트랩해 재사용한다.
// (apps/core/vercel.json의 rewrite가 모든 경로를 이 함수로 보낸다)
const { createServer } = require('../dist/serverless')

let serverPromise

module.exports = async (req, res) => {
  serverPromise ??= createServer()
  const server = await serverPromise
  return server(req, res)
}
