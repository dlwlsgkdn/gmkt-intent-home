import React, { useEffect } from 'react'

/*
 * 상품 상세보기 사이드 패널 — 추천 상품 카드의 "상세보기"가 외부몰 상품 페이지를
 * iframe으로 띄운다 (데스크톱 = 우측 사이드 패널, 모바일 = 전체화면. viewer.css).
 * iframe에는 **모바일 PDP 원본 URL을 그대로** 싣는다 (2026-08 프록시 제거):
 * 구 프록시(/api/pdp — 모바일 UA 대리 수신 + base 주입)는 본문은 받아와도 스크립트·
 * 서브리소스가 깨져 실제로는 빈 화면이 대부분이었다. 모바일 PDP는 프레임 차단이 없거나
 * 약해서(올리브영은 데스크톱 www도 X-Frame-Options 없음) 원본 직접 삽입이 가장 잘 뜬다.
 * 한계: 데스크톱 브라우저의 iframe은 데스크톱 UA라, 몰이 데스크톱 페이지로 되돌리며
 * 차단할 수 있다(지마켓 m.gmarket → item.gmarket X-Frame-Options: SAMEORIGIN) —
 * 그 경우는 하단 안내 + "새 탭에서 열기"(항상 원본 URL) 폴백이 받는다.
 * product = { name, mall, url } | null (null이면 닫힘)
 */

/* 알려진 몰의 PDP를 모바일 URL로 정규화 — 상품 키만 뽑아 모바일 경로에 다시 매단다.
   못 알아보는 URL은 원본 그대로 시도한다 (차단 여부는 몰마다 다르다) */
function frameFor(rawUrl, urlKind) {
  try {
    const url = new URL(rawUrl)
    // 검색 링크 상품(urlKind=search) — 몰 검색 결과를 모바일 검색 경로로 (PDP 를 못 찾은 상품의 대체 링크)
    if (urlKind === 'search') {
      const q = url.searchParams.get('query') || url.searchParams.get('keyword') || url.searchParams.get('q') || ''
      if (q) {
        if (/(^|\.)oliveyoung\.co\.kr$/.test(url.hostname)) return { src: `https://m.oliveyoung.co.kr/m/search/searchList?query=${encodeURIComponent(q)}` }
        if (/(^|\.)gmarket\.co\.kr$/.test(url.hostname)) return { src: `https://m.gmarket.co.kr/n/search?keyword=${encodeURIComponent(q)}` }
        if (/(^|\.)coupang\.com$/.test(url.hostname)) return { src: `https://m.coupang.com/nm/search?q=${encodeURIComponent(q)}` }
      }
      return { src: rawUrl }
    }
    // 지마켓: item.gmarket.co.kr/Item?goodsCode=… ·구/신 모바일 경로 → m.gmarket.co.kr/vi/product/{code}
    if (/(^|\.)gmarket\.co\.kr$/.test(url.hostname)) {
      const code =
        url.searchParams.get('goodsCode') ||
        url.searchParams.get('goodscode') ||
        (url.pathname.match(/\/vi\/product\/(\d+)/) || [])[1]
      if (code) return { src: `https://m.gmarket.co.kr/vi/product/${code}` }
    }
    // 올리브영: getGoodsDetail.do?goodsNo=… → m.oliveyoung.co.kr 모바일 경로
    if (/(^|\.)oliveyoung\.co\.kr$/.test(url.hostname)) {
      const goodsNo = url.searchParams.get('goodsNo')
      if (goodsNo) {
        return { src: `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${encodeURIComponent(goodsNo)}` }
      }
    }
  } catch {
    /* 형식 문제는 원본 그대로 — iframe이 알아서 실패를 보여준다 */
  }
  return { src: rawUrl }
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
        {product.urlKind === 'search' && (
          <p className="sb-product-detail__note">
            상세 페이지를 찾지 못해 {product.mall || '외부몰'} 검색 결과를 열었어요 — 같은 이름의 상품을 골라 보세요.
          </p>
        )}
        <iframe
          className="sb-product-detail__frame"
          src={frameFor(product.url, product.urlKind).src}
          title={`${product.name} 상품 페이지`}
          referrerPolicy="no-referrer"
        />
        <p className="sb-product-detail__note">
          페이지가 비어 보이면 외부몰이 삽입(iframe)을 차단한 거예요 — "새 탭에서 열기"로 확인해주세요.
        </p>
      </aside>
    </div>
  )
}
