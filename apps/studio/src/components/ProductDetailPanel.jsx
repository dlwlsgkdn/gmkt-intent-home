import React, { useEffect } from 'react'

/*
 * 상품 상세보기 사이드 패널 — 추천 상품 카드의 "상세보기"가 외부몰 상품 페이지를
 * iframe으로 띄운다 (데스크톱 = 우측 사이드 패널, 모바일 = 전체화면. viewer.css).
 * 외부몰이 X-Frame-Options/CSP로 삽입을 차단하면 iframe 안이 비므로,
 * "새 탭에서 열기"를 헤더에 상시 두고 하단 안내로 폴백을 알린다.
 * 지마켓 PDP는 예외로 프록시(/api/pdp — 모바일 UA로 대신 받아 프레임 차단을 우회)를
 * 경유한다: 데스크톱 iframe의 UA로는 item.gmarket(X-Frame-Options)으로 넘어가 항상
 * 비어 보였기 때문. 새 탭 링크는 언제나 원본 URL이다.
 * product = { name, mall, url } | null (null이면 닫힘)
 */

/* 프록시 오리진 — liveApi.js와 같은 규칙: vercel/localhost는 same-origin(로컬은 vite가
   /api를 운영 배포로 프록시), GitHub Pages 등 교차 오리진은 스튜디오 도메인으로 */
const SAME_ORIGIN =
  typeof location !== 'undefined' &&
  (/(^|\.)vercel\.app$/.test(location.hostname) ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
const PROXY_BASE = SAME_ORIGIN ? '' : 'https://ddak-scenario-studio.vercel.app'

/* 지마켓 PDP만 프록시 경유 — 그 외 몰은 원본 그대로 시도한다 (차단 여부는 몰마다 다르다).
   proxied면 문서가 우리 오리진으로 서빙되므로 반드시 sandbox(allow-same-origin 없이)로
   불투명 오리진 격리한다 — 지마켓 스크립트가 스튜디오 localStorage/DOM에 닿지 않게 */
function frameFor(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (/(^|\.)gmarket\.co\.kr$/.test(url.hostname)) {
      return { src: `${PROXY_BASE}/api/pdp?url=${encodeURIComponent(url.href)}`, proxied: true }
    }
  } catch {
    /* 형식 문제는 원본 그대로 — iframe이 알아서 실패를 보여준다 */
  }
  return { src: rawUrl, proxied: false }
}
export default function ProductDetailPanel({ product, onClose }) {
  useEffect(() => {
    if (!product) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [product, onClose])

  if (!product) return null
  return (
    <div className="sb-product-detail" role="dialog" aria-modal="true" aria-label={`${product.name} 상세보기`}>
      <button
        type="button"
        className="sb-product-detail__backdrop"
        aria-label="상세보기 닫기"
        onClick={onClose}
      />
      <aside className="sb-product-detail__panel">
        <div className="sb-product-detail__head">
          <div className="sb-product-detail__titles">
            <span className="sb-product-detail__mall">{product.mall}</span>
            <p className="sb-product-detail__name">{product.name}</p>
          </div>
          <a
            className="sb-product-detail__newtab"
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            title="상품 페이지를 새 탭에서 열기"
          >
            새 탭에서 열기 ↗
          </a>
          <button type="button" className="sb-product-detail__close" aria-label="닫기" onClick={onClose}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {(() => {
          const frame = frameFor(product.url)
          return (
            <iframe
              className="sb-product-detail__frame"
              src={frame.src}
              title={`${product.name} 상품 페이지`}
              referrerPolicy="no-referrer"
              sandbox={frame.proxied ? 'allow-scripts allow-popups allow-forms' : undefined}
            />
          )
        })()}
        <p className="sb-product-detail__note">
          페이지가 비어 보이면 외부몰이 삽입(iframe)을 차단한 거예요 — "새 탭에서 열기"로 확인해주세요.
        </p>
      </aside>
    </div>
  )
}
