import type { PlanPageWire, PlanQuality } from '@ddak/schema'
import { isInfoDrop } from './guards/grounding'

/*
 * 계획 품질 요약 — 기록 시점(7단계)에 최종 페이지·드롭 로그에서 결정적으로 센다. llmMeta.quality 로 plan 스텝에 남아
 * 전환 판정 계기판이 최근 N개를 평균낸다 (섹션당 상품 수·1개짜리 섹션·PDP 비율·썸네일 비율·가격 미확인·콘텐츠 누락·드롭).
 * 2026-09 운영 기록 분석에서 손으로 세던 지표를 상시 노출하기 위한 것 — 개선의 측정 기준.
 */
export function planQualityOf(page: PlanPageWire, dropLog: { code: string }[] = []): PlanQuality {
  const q: PlanQuality = {
    sections: page.sections.length,
    productSections: 0,
    singleProductSections: 0,
    products: 0,
    webProducts: 0,
    pdpProducts: 0,
    productThumbnails: 0,
    priceUnknown: 0,
    contentSections: 0,
    contentItems: 0,
    contentThumbnails: 0,
    // 정보 기록(contents-empty-retry·catalog-fallback)은 드롭이 아니다 — KPI 에서 뺀다
    drops: dropLog.filter((d) => !isInfoDrop(d)).length,
  }
  for (const s of page.sections) {
    if (s.kind === 'products') {
      q.productSections += 1
      if (s.products.length === 1) q.singleProductSections += 1
      for (const p of s.products) {
        q.products += 1
        // 웹 검색 상품은 id 접두 `web-` — 내부 카탈로그 후보(gm-·oy-·p-)는 mall 이 있어도 웹 상품이 아니다 (v29)
        if (p.id.startsWith('web-')) {
          q.webProducts += 1
          if (p.urlKind !== 'search') q.pdpProducts += 1
        }
        if (p.imageUrl) q.productThumbnails += 1
        if (p.priceUnknown || !(p.price > 0)) q.priceUnknown += 1
      }
    } else if (s.kind === 'contents') {
      q.contentSections += 1
      for (const c of s.items) {
        q.contentItems += 1
        if (c.imageUrl) q.contentThumbnails += 1
      }
    }
  }
  return q
}
