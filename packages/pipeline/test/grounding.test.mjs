// 검증 게이트 보조 규칙 — 판매처 이름 정규화·지마켓 썸네일 파생 (2026-09-14, 지마켓 50 : 외부몰 50 + 썸네일 보강)
import test from 'node:test'
import assert from 'node:assert/strict'
import { gmarketGoodsCodeOf, gmarketThumbnailOf, groundProductsSection, normalizeMallName } from '../dist/guards/grounding.js'

test('지마켓 상품 번호 — item/goodscode 쿼리·모바일 /vi/product 경로, 대소문자 무관, 다른 몰은 null', () => {
  assert.equal(gmarketGoodsCodeOf('https://item.gmarket.co.kr/Item?goodscode=4314605095'), '4314605095')
  assert.equal(gmarketGoodsCodeOf('https://item.gmarket.co.kr/Item?goodsCode=3694639295&ver=1'), '3694639295')
  assert.equal(gmarketGoodsCodeOf('https://m.gmarket.co.kr/vi/product/4075320386'), '4075320386')
  assert.equal(gmarketGoodsCodeOf('https://browse.gmarket.co.kr/search?keyword=토너'), null)
  assert.equal(gmarketGoodsCodeOf('https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358'), null)
  assert.equal(gmarketThumbnailOf('https://item.gmarket.co.kr/Item?goodscode=4314605095'), 'https://gdimg.gmarket.co.kr/4314605095/still/280')
})

test('판매처 이름 — 주소 호스트가 말해 주는 몰은 통일, 그 밖은 모델이 적은 이름', () => {
  assert.equal(normalizeMallName('G마켓', new URL('https://item.gmarket.co.kr/Item?goodscode=1')), '지마켓')
  assert.equal(normalizeMallName('올영', new URL('https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=A1')), '올리브영')
  assert.equal(normalizeMallName('', new URL('https://www.coupang.com/vp/products/1')), '쿠팡')
  assert.equal(normalizeMallName('화해 몰', new URL('https://shop.example.com/p/1')), '화해 몰')
  assert.equal(normalizeMallName('  ', new URL('https://shop.example.com/p/1')), '외부몰')
})

test('상품 섹션 그라운딩 — 지마켓 웹 상품은 썸네일이 비어도 gdimg 로 채우고, 프로토콜 생략 이미지는 https 로 받는다', () => {
  const web = (over) => ({
    name: '상품', brand: '브랜드', price: 10000, tags: [], mall: 'G마켓', url: 'https://item.gmarket.co.kr/Item?goodscode=4314605095', imageUrl: '', urlKind: 'pdp',
    ...over,
  })
  const { section, drops } = groundProductsSection(
    {
      kind: 'products', title: '테스트', reason: '', productIds: [],
      webProducts: [
        web({}),
        web({ name: '올영 상품', mall: '올리브영', url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358', imageUrl: '//image.oliveyoung.co.kr/x.jpg' }),
      ],
    },
    0,
  )
  assert.equal(drops.length, 0)
  assert.equal(section.products[0].mall, '지마켓')
  assert.equal(section.products[0].imageUrl, 'https://gdimg.gmarket.co.kr/4314605095/still/280')
  assert.equal(section.products[1].mall, '올리브영')
  assert.equal(section.products[1].imageUrl, 'https://image.oliveyoung.co.kr/x.jpg')
})
