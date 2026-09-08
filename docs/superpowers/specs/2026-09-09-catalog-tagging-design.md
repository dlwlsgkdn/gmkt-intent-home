# 상품 태깅 검토 스튜디오 — 검토 단위를 카탈로그로

2026-09-09 · 선행: [2026-09-01-tagging-studio-mongo-design.md](2026-09-01-tagging-studio-mongo-design.md)

## 1. 문제

태깅 스튜디오는 `eevee.products`(몰 리스팅)를 읽고 되쓴다. 그런데 같은 상품이 여러 몰에
걸려 있으면 **리스팅마다 따로 검토**하게 된다.

실측(2026-09-09):

```
catalog   960건  ← 몰 중립 상품 실체
   ↑ catalog_ids
products 1020건  ← 몰 리스팅 (올리브영 720 · 지마켓 300)
```

카탈로그 1건에 묶인 리스팅 조합: **올리브영만 705 · 지마켓만 227 · 둘 다 14**.

`catalog.review_status`는 검토 결과가 아니라 **리스팅에서 복사된 값**이다 — 946건 중
934건이 묶인 리스팅과 일치한다. 카탈로그는 2026-09-03 02:01에 리스팅으로부터 생성되며
상태를 물려받았다. 불일치 12건이 문제의 정체다:

```
c-000050  catalog=unreviewed  listings=[올리브영:reviewed, 지마켓:unreviewed, 지마켓:unreviewed]
c-000099  catalog=unreviewed  listings=[올리브영:reviewed, 올리브영:reviewed, 지마켓:unreviewed]
```

**카탈로그 태그를 검토하는 도구는 지금 없다.** Flask `/catalog/*`는 묶기·병합 전용이고
(`_merge_cross_source`·`catalog_pending`·`name_variants`), Flask `/studio`는 우리와
똑같이 리스팅 단위다. 그 자리가 비어 있다.

## 2. 목표

- 검토 단위를 **카탈로그 1건 = 작업 1건**으로 옮긴다. 같은 상품을 몰마다 다시 만나지 않는다.
- 몰 리스팅은 **판단 근거**로 화면에 붙인다 — 카탈로그에 없는 가격·PDP·리뷰가 거기 있다.
- 필드별 확신도를 쓴다. 카탈로그에는 이미 `field_confidence`가 있다.

### 비목표

- Flask 대시보드의 묶기·병합 기능을 가져오지 않는다. 그건 거기 남는다.
- 리스팅 단위 검토를 우리 화면에서 계속 제공하지 않는다 (Flask `/studio`에 남는다).
- 라이브 생성 카탈로그(`packages/pipeline/src/catalog.ts`, 코드에 박힌 14개)와의 연결은
  이 작업 밖이다. 별개 과제다.

## 3. 데이터

### 3-1. 어느 쪽이 무엇을 갖는가

| | `catalog` (960) | `products` (1020) |
|---|---|---|
| 태그 7필드 | ✅ | ✅ |
| `field_confidence` (필드별 확신도+근거) | ✅ 901 | ✗ |
| 성분 (`ingredients_from_spec`·`full_ingredients`) | ✅ | 올리브영만 |
| 가격 | **0** | ✅ |
| PDP url | **0** | 올리브영 719/720 · 지마켓 0/291 |
| 리뷰 요약 (`review_ai_summary`·`review_stats`) | **0** | 올리브영만 |
| 옵션 | **0** | ✅ |

가격·PDP·리뷰·옵션이 카탈로그에 하나도 없다. 리스팅에서 가져와야 한다.

### 3-2. 7필드는 그대로 옮겨진다

`FIELD_SLOTS`의 문서 필드가 카탈로그에도 같은 이름으로 있다 (건수는 채움률):

```
inferred_category 902 · sub_type 865 · body_part 898
skin_types 831 (primary 744) · concerns 747 (primary 704)
results 889 (primary 851) · conditions 457 (primary 401)
```

`conditions`가 457/946으로 낮다. 화면에서 "미검토"로 뜨는 게 정상이며 검토자가 채울 자리다.

### 3-3. `field_confidence`

화면 필드 키와 **같은 7개 키**를 쓴다. 값은 `{level, rationale}`:

```json
{ "category": { "level": "medium", "rationale": "상품명과 크림 형태의 스킨케어 성분으로 …" },
  "subtype":  { "level": "high",   "rationale": "상품명에 '크림'이 명시됨" },
  "area":     { "level": "low",    "rationale": "근거 없음" } }
```

키별 등장: category 899 · subtype 863 · area 896 · type 823 · concern 742 · result 883 ·
condition 452. 없는 필드는 문서 단위 `confidence`로 떨어진다.

### 3-4. 제외 대상

- **`merged_into` 있는 14건** — 병합으로 흡수된 묘비 문서. 목록에서 뺀다.
  검토 대상은 **946건**.
- **카탈로그에 안 묶인 analyzed 리스팅 82건** — §4-4 참고.

## 4. 설계

### 4-1. 검토 단위와 되쓰기

- 목록 = `catalog` 946건 (`merged_into` 없는 것)
- 되쓰기 = `catalog` 문서, 키는 `catalog_id`
- `review_status`(`reviewed`/`needs_fix`)·`review_meta` 형식은 **지금과 동일**하다.
  카탈로그 3건에 이미 우리 형식의 `review_meta`가 들어 있다 (스모크 테스트가 리스팅에
  쓴 값이 카탈로그 생성 때 복사된 것).
- `review_meta`가 없는 기존 `reviewed` 문서는 `toUnit`의 기존 규칙대로 전 필드가 `done`으로
  보인다 — 사람이 이미 본 것으로 취급하는 게 맞다.

**마이그레이션은 없다.** 카탈로그가 리스팅에서 상태를 물려받은 상태라 그대로 이어서 쓴다.

### 4-2. 묶인 리스팅을 근거로 붙인다

좌측 상품 정보 패널에 몰별 카드를 세운다. 카드 하나 = 리스팅 하나:

```
[올리브영]  18,200원   리뷰 ★4.6 (1,204)   [PDP 열기]
[지마켓]    17,900원   리뷰 없음            (PDP 없음)
```

- 몰 배지는 `source` 필드 (`gmarket` / 없으면 `oliveyoung`)
- 브랜드는 **`brand_name` 우선** — 지마켓 리스팅 89건의 `brand`가 `"68851"` 같은 숫자다
- 지마켓은 `url`이 전부 없다. PDP 버튼을 감춘다 (지금은 링크가 죽어 있다)
- 리뷰·상세 문구는 올리브영 리스팅에만 있다. 없으면 그 줄을 감춘다

### 4-3. 확신도를 필드별로

지금 화면은 문서 단위 확신도 바 하나(`confidence` → 90/70/45%)를 상단에 둔다.
이걸 **필드마다** 옮긴다 — 각 필드 카드에 `level` 바와 `rationale` 한 줄.

검토자가 "어느 태그가 미심쩍은지"를 목록에서 바로 고를 수 있게 되는 게 이 작업의
부수적이지만 큰 이득이다.

### 4-4. 안 묶인 리스팅 82건

카탈로그가 없는 analyzed 리스팅이다. 목록에서 그냥 사라지면 검토자가 존재를 모른다.

**「카탈로그 미연결」 필터 알약**을 헤더에 추가해 읽기 전용으로 보여준다. 태깅은 하지
않는다 — 묶는 일은 Flask `/catalog/pending`의 몫이고, 우리가 리스팅에 태그를 쓰면
빌더가 다음 카탈로그를 만들 때 어느 쪽이 정본인지 다시 흐려진다.

카드에는 이름·몰·썸네일과 "Flask 대시보드에서 카탈로그에 연결하세요" 안내만 둔다.

### 4-5. API 계약

경로는 그대로 두고 의미만 바꾼다 — FE가 부르는 자리가 세 곳뿐이다.

```
GET   /api/tagging/bootstrap            units[] = 카탈로그 946건 (+ listings[], + unlinked[])
GET   /api/tagging/summary              카탈로그 기준 집계
PATCH /api/tagging/units/:catalogId     필드 되쓰기
POST  /api/tagging/units/:catalogId/review   승인·반려
```

`unit.id`가 `product_id`에서 `catalog_id`로 바뀐다. FE는 `unit.id`를 불투명 키로만
쓰므로 그 자체는 문제없다.

**응답 크기**: 카탈로그 946건 2.89MB + 리스팅 요약 1.21MB ≈ 4.1MB. 지금(1~3MB)보다
크지만 한 번에 보내는 방식은 유지한다. 리스팅은 패널에 필요한 필드만 투영한다
(`product_id·source·price·url·image_url·options·review_stats·review_ai_summary·brand_name`).
느려지면 그때 목록/상세를 나눈다 — 지금 규모에서 미리 쪼갤 이유가 없다.

**조인은 메모리에서 한다.** `products.catalog_ids`에 인덱스가 없어(현재 인덱스:
`_id_`·`product_id_1`·`status_1`) 946번 질의하면 느리다. 두 컬렉션을 한 번씩 읽어
`catalog_id` 기준으로 맞춘다.

### 4-6. 환경변수

```
CATALOG_COLL=catalog     # 새로 추가. 기본값 'catalog'
MONGO_COLL=products      # 그대로 — 리스팅 근거를 읽는 데 계속 쓴다
```

## 5. 상호운용 — 다른 저장소와 조율할 것

### 5-1. 빌더가 우리 검토 결과를 덮는다 ⚠️

카탈로그 빌더(`oliveyoung-collector-poc` 또는 수집 파이프라인 쪽)가 재빌드 때
`review_status`를 리스팅에서 다시 복사한다. 그대로 두면 **다음 빌드가 우리 검토를 덮는다.**

필요한 변경은 한 줄 수준이다:

> 이미 `review_meta`가 있는(= 사람이 검토한) 카탈로그 문서는 `review_status`를 덮지 않는다.

**이 저장소 밖이라 여기서 고치지 않는다.** 해당 저장소 담당에게 전달한다. 그 전까지는
우리 검토 결과가 재빌드에 취약하다는 것을 알고 쓴다.

### 5-2. Flask `/studio`와의 관계

Flask `/studio`는 리스팅 단위로 남는다. 두 화면이 서로 다른 컬렉션을 보게 되므로 충돌은
없지만, 같은 상품을 양쪽에서 검토하면 카탈로그와 리스팅의 상태가 갈린다. 이건 운영 규칙으로
정리할 문제이며 코드로 막지 않는다.

## 6. 테스트

`apps/tagging-api/test/mapping.test.mjs` 방식(순수 함수, `node --test`, Mongo 불필요)을 유지한다.

- `toUnit`이 카탈로그 문서에서 7필드를 뽑는다 — `conditions` 없는 문서 포함
- `field_confidence`가 있으면 필드별로, 없으면 문서 `confidence`로 떨어진다
- `toDocPatch` 화이트리스트가 카탈로그에서도 7슬롯 밖을 쓰지 않는다
- 리스팅 조인: 몰 배지·`brand_name` 우선·`url` 없는 지마켓 리스팅
- `merged_into` 있는 문서가 목록에서 빠진다
- 안 묶인 리스팅이 `unlinked`로만 나오고 `units`에 섞이지 않는다

## 7. 미결

- **빌더 수정** (§5-1) — 다른 저장소. 전달 후 반영 여부를 확인해야 한다.
- **`conditions` 채움률 457/946** — 검토자가 채워야 할 양이 많다. 화면이 이걸
  "할 일"로 드러내는지 실사용에서 확인한다.
- 라이브 생성 카탈로그(코드의 14개)와의 연결은 별개 과제다.
