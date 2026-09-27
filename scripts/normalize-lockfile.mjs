/*
 * package-lock.json 의 resolved 주소를 공개 레지스트리(registry.npmjs.org)로 되돌린다.
 *
 * 왜: 루트 .npmrc 가 사내 미러(prm.gmarket.com)를 가리켜서, 사내망에서 npm install 로 패키지를
 * 더하면 npm 이 락파일 resolved 에 미러 tarball 주소를 그대로 적는다. npm 은 설치 때 registry
 * 설정과 무관하게 resolved 주소로 tarball 을 받으므로(replace-registry-host 는 호스트가
 * registry.npmjs.org 인 주소만 바꾼다) 미러에 못 닿는 사외 빌더는 getaddrinfo ENOTFOUND 로
 * 죽는다 — Vercel 은 api/·middleware.js 를 만드는 @vercel/node 가 루트에서 npm install 을
 * 따로 돌려 스튜디오 install 명령·NPM_CONFIG_REGISTRY 로도 못 막았다(2026-09-27, 17개 항목).
 * 반대로 npmjs 주소는 사내(퓨전)에서 npm 이 .npmrc 미러의 호스트+경로로 바꿔 받으니 양쪽에 안전하다.
 *
 * 루트 postinstall 로 걸려 있어 npm install 뒤 자동으로 돈다(락파일이 없거나 못 쓰면 조용히 넘어간다).
 * 수동 실행: node scripts/normalize-lockfile.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIRROR = /^https?:\/\/prm\.gmarket\.com\/repository\/npm-group\//
const PUBLIC = 'https://registry.npmjs.org/'

const lockPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package-lock.json')

// lockfileVersion 2 는 packages 와 (구형) dependencies 트리 양쪽에 resolved 가 있다 — 둘 다 훑는다
function normalizeTree(tree) {
  let changed = 0
  for (const entry of Object.values(tree ?? {})) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.resolved === 'string' && MIRROR.test(entry.resolved)) {
      entry.resolved = entry.resolved.replace(MIRROR, PUBLIC)
      changed++
    }
    if (entry.dependencies) changed += normalizeTree(entry.dependencies)
  }
  return changed
}

try {
  const text = fs.readFileSync(lockPath, 'utf8')
  const lock = JSON.parse(text)
  const changed = normalizeTree(lock.packages) + normalizeTree(lock.dependencies)
  if (changed) {
    // npm 과 같은 2칸 들여쓰기 + 끝 개행 — 바뀐 resolved 줄만 diff 에 남는다
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
    console.log(`[normalize-lockfile] 사내 미러 주소 ${changed}개를 공개 레지스트리로 되돌렸다`)
  }
} catch (err) {
  if (err?.code !== 'ENOENT') console.warn(`[normalize-lockfile] 건너뜀 — ${err.message}`)
}
