// Vercel 서버리스 엔트리 — 빌드된 Nest 앱을 콜드스타트당 1회 부트스트랩해 재사용한다.
const { createServer } = require('../dist/serverless')

let serverPromise

module.exports = async (req, res) => {
  serverPromise ??= createServer()
  const server = await serverPromise
  return server(req, res)
}
