# 상품 태깅 데이터 계약

운영 콘솔의 **상품 태깅 검토 스튜디오**(`#ops/tagging`)가 소비·기록하는 필드 목록.
카탈로그를 채우는 쪽(`external-item-collector`)과 화면 쪽이 이 문서 하나를 기준으로 맞춘다.

- 데이터 원천: 사내망 Mongo `<MONGO_DB>.products` (`status: 'analyzed'` 문서만 화면에 뜬다)
- 변환 코드: `apps/tagging-api/src/mapping.ts` — 이 파일이 아래 표의 유일한 구현이다
- 채움률: 2026-09-01 실측, `status='analyzed'` 812건 기준

## 1. 상품 정체성 — 화면이 읽기만 한다

카탈로그가 채워야 하는 자리. 검토자가 여기서 값을 고치지 않는다.

| 화면 항목 | Mongo 필드 | 없을 때 화면 | 채움률 |
|---|---|---|---|
| 상품명 | `name` | 빈 문자열 — 목록에서 식별 불가 | 100% |
| 브랜드 | `brand`, 없으면 `inferred_brand` | 빈 문자열 | 100% |
| 썸네일 | `image_url` | 이모지 목업으로 대체 | 83% |
| 가격 | `price` (숫자) | "가격 정보 없음" | 89% |
| 옵션 표시 | `options[]` (길이만 쓴다) | "단일 옵션" | 56% |
| 상품 ID | `product_id` | — (키) | 100% |
| 원본 링크 | `url` | 링크 없음 | 89% |
| 카탈로그 원본 태그 | `sub_type` + `formulation` + `ingredient_tags[]`, 중복 제거 후 앞 5개 | 칩 없음(이모지 폴백도 실패) | 96% / 88% |
| 상세페이지 주요 문구 | `product_info['제품 주요 사양']`, 없으면 `usage_method` | 빈 칸 — 검토 근거가 사라진다 | 86% |
| 리뷰 요약 | `review_ai_summary.features[]`를 `제목 — 설명` 줄로, 끝에 `review_stats.count`·`avg_rating` | 빈 칸 | 77% |
| AI 확신도 | `confidence` (`high`\|`medium`\|`low` → 90\|70\|45%) | 0% | 100% |
| AI 판단 근거 | `rationale` (문장 하나) | 빈 칸 | 100% |

**확신도·근거는 상품당 하나뿐이다.** 그래서 화면은 상품 정보 패널에 한 번만 표시하고 필드별로
반복하지 않는다. 필드별 확신도를 보여주려면 수집 쪽 프롬프트가 필드별 값을 내야 하고, 이미 분석된
문서 전체의 재분석 비용이 든다.

## 2. 태깅 7필드 — 읽고, 사람이 고치고, 되쓴다

| 화면 필드 | Mongo 값 | 대표(★) | 개수 | 사전 키(항목 수) | 채움률 |
|---|---|---|---|---|---|
| 대분류 | `inferred_category` | — | 1 필수 | `categories` (11) | 100% |
| 세부유형 | `sub_type` | — | 1 필수 | `sub_types` (40) | 98% |
| 부위 | `body_part` | — | 1 필수 | `body_parts` (18) | 100% |
| 타입 | `skin_types[]` | `skin_types_primary` | 1~2 필수 | `skin_types` (11) | 96% / ★86% |
| 고민 | `concerns[]` | `concerns_primary` | 0~2 | `concerns` (20) | 81% / ★75% |
| 결과 | `results[]` | `results_primary` | 1~2 필수 | `results` (17) | 99% / ★94% |
| 조건 | `conditions[]` | `conditions_primary` | 0~1 | `conditions` (7) | 55% / ★49% |

규칙:

- **대표(★)는 2개 이상 골랐을 때만 필요하다.** 1개면 화면이 그 값을 자동으로 대표로 삼으므로
  `*_primary`를 비워도 된다. 대표가 선택 목록 밖을 가리키면 저장 시 비워진다.
- **값은 사전 안에 있어야 한다.** 사전의 원천은 Python 저장소(`oliveyoung-collector-poc`)의
  `taxonomy.json`이고, API가 `TAXONOMY_PATH`로 읽어 화면에 실어 보낸다. 사본을 만들지 않는다.
- **그룹 스코프가 걸린다.** `category_groups`가 대분류 → 그룹(페이스케어·색조·두피·헤어·바디·기타)을
  정하고, `sub_types_groups`·`body_parts_groups`·`skin_types_groups`·`concerns_groups`·
  `results_groups`가 그 그룹에 속한 값만 허용한다. 예: 고민 `뭉침·끼임`은 색조·두피 전용이라
  스킨케어 상품에 붙으면 "허용 목록에 없는 값" 오류가 난다.
- **전체 태그 개수는 3~10개**여야 승인된다(7필드 선택 수의 합).
- 필수 필드가 비었거나 위 규칙을 어기면 화면이 승인을 막는다.

## 3. 화면이 되쓰는 것 — 카탈로그가 만들 필요 없다

| 필드 | 내용 |
|---|---|
| `review_status` | `reviewed`(승인) · `needs_fix`(반려) · `auto_ok` · `unreviewed`. **Flask 대시보드와 공유한다** |
| `reviewed_at` | 승인일 때만 시각 |
| `review_meta` | DDAK 화면 전용 추가형 객체 — `fieldStatus`(필드별 검토 표시) · `fieldOrigin`(`ai`\|`human`) · `note`(검토 메모) · `tagRequest`(사전 추가 요청) · `aiOriginal`(첫 편집 직전 AI 원본 스냅샷, 되돌리기용) |

되쓰기는 **이 셋 + 7필드 값/대표뿐이다.** 그 밖의 키는 서버가 버린다(`toDocPatch`의 화이트리스트) —
수집 파이프라인이 채운 값을 검토 화면이 덮을 수 없게 하려는 것이다.

태그 값이 실제로 바뀐 저장은 `review_status`를 `unreviewed`로 내린다(이미 승인·반려였던 문서에 한해).
메모만 고치거나 검토 표시만 바꾼 저장은 상태를 건드리지 않는다.

## 4. 카탈로그를 새로 만든다면 — 채울 우선순위

채움률이 낮으면서 검토 품질에 직접 영향을 주는 순서.

1. **`conditions` (55%)** — 절반이 비어 있다. 0개도 허용이지만 전체 태그 3개 하한을 못 채우는
   상품이 여기서 나온다.
2. **`review_ai_summary.features` (77%)** — 없으면 "리뷰가 이 태그를 뒷받침하나"를 판단할 근거가
   화면에서 통째로 사라진다. 태깅 검토의 핵심 입력이다.
3. **`image_url` (83%)** — 없으면 이모지로 대체돼 목록에서 상품을 눈으로 찾기 어렵다.
4. **`concerns` (81%) / `concerns_primary` (75%)** — 선택 항목이지만 상품 매칭의 주력 축이다.
5. **`price` (89%)**, **`url` (89%)** — 검토자가 원본을 열어 확인하는 경로.

## 5. 알려진 어긋남

- **검증 규칙이 두 벌이다.** DDAK의 `validateUnit`(`apps/studio/src/lib/taggingCatalog.js`)과 Flask의
  `tagging_rules.py`가 같은 대상을 다른 문구·심각도로 검사하고, 태그 개수 상한도 다르다. 승인 게이트가
  갈라져 있으므로 한쪽에서 통과한 상품이 다른 쪽에서 걸릴 수 있다.
- **Mongo가 사설 IP다.** Vercel 배포본에서는 API 호출이 실패하고 화면이 예시 데이터(`TAGGING_SEED`
  14건)로 폴백한다. 실제 검토는 사내망에서만 가능하다.
