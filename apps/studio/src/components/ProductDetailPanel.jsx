import React, { useEffect } from 'react'

/*
 * 상품 상세보기 사이드 패널 — 추천 상품 카드의 "상세보기"가 외부몰 상품 페이지를
 * iframe으로 띄운다 (데스크톱 = 우측 사이드 패널, 모바일 = 전체화면. viewer.css).
 * 외부몰이 X-Frame-Options/CSP로 삽입을 차단하면 iframe 안이 비므로,
 * "새 탭에서 열기"를 헤더에 상시 두고 하단 안내로 폴백을 알린다.
 * product = { name, mall, url } | null (null이면 닫힘)
 */
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
        <iframe
          className="sb-product-detail__frame"
          src={product.url}
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
