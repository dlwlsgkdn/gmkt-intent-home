/* 지마켓 PDP iframe 프록시 — 상세보기 사이드 패널용 (GET /api/pdp?url=<PDP url>).
   왜 필요한가: 데스크톱 브라우저의 iframe은 데스크톱 UA를 보내는데, m.gmarket.co.kr PDP는
   데스크톱 UA를 item.gmarket.co.kr(데스크톱)로 302시키고 그쪽은 X-Frame-Options: SAMEORIGIN이라
   프레임이 차단된다. 모바일 UA로 받은 m.gmarket PDP는 프레임 차단 헤더가 없다(2026-08 확인) —
   그래서 서버가 모바일 UA로 대신 받아 우리 오리진으로 돌려준다(우리 응답엔 차단 헤더가 없다).
   <base href> 주입으로 에셋(/vi/_next/…)은 지마켓에서 직접 로드된다. 페이지 JS의 동적 데이터
   호출은 CORS로 일부 막힐 수 있지만 SSR 본문(상품 정보)은 온전히 보인다 — 완전한 인터랙션은
   패널의 "새 탭에서 열기"가 맡는다(원본 URL).
   SSRF 가드: https + 지마켓 호스트 allowlist만, 쿠키 미전달, 원본 응답 헤더 미복사. */

const ALLOWED_HOSTS = new Set(['m.gmarket.co.kr', 'item.gmarket.co.kr', 'www.gmarket.co.kr', 'gmarket.co.kr'])
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const FETCH_TIMEOUT_MS = 10_000

/* 데스크톱 PDP(item.gmarket.co.kr/Item?goodsCode=X)는 모바일 PDP로 정규화해 받는다 —
   모바일 페이지만 프레임 차단 헤더가 없다. goodsCode 없으면 원본 그대로 시도 */
function normalizeToMobile(url) {
  if (url.hostname === 'm.gmarket.co.kr') return url
  const goodsCode = url.searchParams.get('goodsCode') || url.searchParams.get('goodscode')
  if (goodsCode && /^\d{1,16}$/.test(goodsCode)) {
    return new URL(`https://m.gmarket.co.kr/vi/product/${goodsCode}`)
  }
  return url
}

/* iframe 안에 뜨는 정직한 폴백 — 프록시가 페이지를 못 받아온 경우 */
function fallbackHtml(message, originalUrl) {
  const safeUrl = String(originalUrl || '').replace(/"/g, '&quot;')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,sans-serif;background:#fafafa;color:#444">
<div style="text-align:center;padding:24px;font-weight:300">
<p style="margin:0 0 12px">${message}</p>
${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:#082da9">새 탭에서 열기 ↗</a>` : ''}
</div></body></html>`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 지원해요' })
    return
  }
  let target
  try {
    target = new URL(String(req.query.url || ''))
  } catch {
    res.status(400).json({ error: 'url 파라미터가 올바른 주소가 아니에요' })
    return
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    res.status(400).json({ error: '지마켓 상품 페이지만 프록시할 수 있어요' })
    return
  }

  const mobileUrl = normalizeToMobile(target)
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const upstream = await fetch(mobileUrl.href, {
      headers: { 'user-agent': MOBILE_UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timer)
    const contentType = upstream.headers.get('content-type') || ''
    if (!upstream.ok || !contentType.includes('text/html')) {
      res.status(200).send(fallbackHtml('상품 페이지를 불러오지 못했어요.', target.href))
      return
    }
    let html = await upstream.text()
    // 내려간 상품은 alert+뒤로가기 스텁이 온다 — 구(데스크톱) 스텁은 inline alert, 모바일은
    // __NEXT_DATA__의 alertMessage로 하이드레이션 시 alert가 튄다. 둘 다 정직한 안내로 대체
    if (html.includes('상품정보를 가져올 수 없습니다') || /"alertMessage"\s*:\s*"[^"]+"/.test(html)) {
      res.status(200).send(fallbackHtml('지금은 판매하지 않는 상품이에요.', target.href))
      return
    }
    // 상대 경로 에셋이 지마켓에서 직접 로드되도록 base 주입 (첫 base가 이긴다)
    const baseTag = `<base href="https://${mobileUrl.hostname}/">`
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`) : baseTag + html
    // 성공 응답만 짧게 캐시 — 가격·재고가 있는 페이지라 길게 들지 않는다
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    res.status(200).send(html)
  } catch {
    res.status(200).send(fallbackHtml('상품 페이지 응답이 늦거나 실패했어요.', target.href))
  }
}
