# 상품 태깅 스튜디오 — 실데이터(Mongo) 연결 설계

- 날짜: 2026-09-01
- 상태: 승인됨(구현 계획 대기)
- 범위: DDAK 운영 콘솔의 상품 태깅 화면(`#ops/tagging`)을 목업 14건에서 실제 수집 데이터
  719건으로 전환하고, 검토 결과를 Mongo에 되쓴다.

## 배경

상품 태깅 화면([TaggingStudio.jsx](../../../apps/studio/src/components/TaggingStudio.jsx))은
지금 `TAGGING_SEED`(코드 상수 14건)를 그리고, 검토 상태를 localStorage에만 남긴다.

같은 일을 하는 도구가 이미 하나 더 있다. `~/oliveyoung-collector-poc`의 Flask 대시보드
`/studio` — 규칙 위반 큐 → 상품별 태그 편집 → 승인(`review_status='reviewed'`)/반려
(`'needs_fix'`)를 Mongo에 기록한다. DDAK 화면은 이 화면을 다시 그린 것이라 3컬럼 구성·필드
7종·대표(★)·검증 패널이 모두 대응된다.

데이터는 `external-item-collector`가 채운다(Mongo `oliveyoung.products`). 2026-09-01 실측으로
720건 중 719건이 `status='analyzed'`이고 전부 올리브영이다(`source` 필드 없음 = 올리브영).
확신도 분포는 high 682 / medium 13 / low 24, 검토 상태는 reviewed 316 / auto_ok 140 /
unreviewed 1 / 없음 263.

## 목표와 비목표

**목표**
1. DDAK 태깅 화면이 Mongo의 실제 719건을 그린다.
2. 태그 수정·승인·반려가 Mongo에 저장되어 Flask 대시보드에서도 같은 상태로 보인다.
3. 지금은 로컬에서 돌지만, 최종 배치처(사내 서버)로 옮길 때 구조를 다시 짜지 않는다.

**비목표 (이번에 하지 않는다)**
- 성분(`ingredient_tags`)·제형(`formulation`)·옵션별 태그(`option_tags`) 편집 — Flask에 남는다.
- 사전 밖 값의 pending 적재·승격(`/taxonomy` 화면) — Flask에 남는다.
- 검증 규칙 통합 — 아래 "알려진 위험" 참고.
- 지마켓 상품 — 수집이 끝나면 `source` 필터만 풀면 된다.
- Flask 대시보드 은퇴.

## 제약

**Mongo는 사내망이다** (사내망 사설 IP 대역(RFC1918)의 replica set). 여기서 두 가지가
따라 나온다.

1. Vercel 서버리스(`api/`, `apps/core`, `apps/bff`)에 Mongo 접근을 두면 안 된다 — 배포되는
   순간 사설 IP에 닿지 못해 죽은 라우트가 된다.
2. Vercel에 올라간 스튜디오(https)에서 사내 API(http)를 브라우저로 직접 부르는 것도 막힌다
   (mixed content). 노트북이 사내 와이파이에 있어도 마찬가지다. 따라서 **FE와 API는 같은
   오리진에서 서빙**해야 한다.

## 구조

새 서비스 하나와 FE 데이터 출처 교체, 둘뿐이다.

```
[브라우저]  DDAK 스튜디오 (apps/studio)
     │  /api/tagging/*  (개발: vite 프록시 / 운영: 같은 오리진)
     ▼
[apps/tagging-api]  NestJS — Mongo에 닿는 곳에서만 실행
     │                └ taxonomy.json 읽기 (TAXONOMY_PATH)
     ▼
[Mongo] oliveyoung.products  ← Flask 대시보드도 같은 컬렉션을 본다
```

### apps/tagging-api (신규)

`apps/bff`와 같은 NestJS 구성을 따른다(모노레포에 이미 두 개 있고, Dockerfile 패턴도 재사용).
포트 8790(bff 8788과 충돌 회피). 환경변수: `MONGO_URI`, `MONGO_DB`(기본 `oliveyoung`),
`MONGO_COLL`(기본 `products`), `TAXONOMY_PATH`, `PORT`.

| 엔드포인트 | 동작 |
|---|---|
| `GET /api/tagging/bootstrap` | `{ taxonomy, units[] }` — `status='analyzed'` 문서를 태깅 단위로 변환해 전부. 719건 기준 응답 1~3MB로 한 번에 보낸다 |
| `PATCH /api/tagging/units/:productId` | 태그 선택·대표(★)·검토 메모·필드별 검토 표시 저장 |
| `POST /api/tagging/units/:productId/review` | `{decision: 'approved'\|'rejected'\|null}` → `review_status` 기록 |

운영 배치 시 이 서비스가 `apps/studio/dist`를 정적 서빙한다 — 그러면 FE와 API가 같은
오리진이 되어 위 제약 2가 해소된다. 개발 중에는 vite 프록시(`/api/tagging` → `:8790`)가
같은 역할을 한다.

### 문서 ↔ 태깅 단위 변환

변환은 API가 소유한다(순수 함수 `toUnit` / `toDocPatch`). FE에 Mongo 필드명이 새어 나가지
않게 하고, 되쓰기 화이트리스트를 한 곳에 모으기 위해서다.

| 태깅 화면 | Mongo 문서 |
|---|---|
| `id` | `product_id` |
| `brand` / `name` / `price` / `imageUrl` | `brand` / `name` / `price` / `image_url` |
| `option` | `options[]`가 비면 `'단일 옵션'` |
| `catalogTags` | `formulation` + `ingredient_tags` + `category_path` 말단 |
| `copy` | `product_info['제품 주요 사양']` 우선, 없으면 `usage_method` |
| `review` | `review_ai_summary.features[]`를 문장으로 + `review_stats`(건수·평점) |
| `fields.category` | `inferred_category` |
| `fields.subtype` | `sub_type` |
| `fields.area` | `body_part` |
| `fields.type` | `skin_types[]` / 대표 `skin_types_primary` |
| `fields.concern` | `concerns[]` / `concerns_primary` |
| `fields.result` | `results[]` / `results_primary` |
| `fields.condition` | `conditions[]` / `conditions_primary` |

**되쓰기 화이트리스트**: `sub_type`, `inferred_category`, `body_part`, `skin_types`,
`concerns`, `results`, `conditions`와 각 `*_primary`, 그리고 `review_meta`뿐이다. 그 밖의
필드는 PATCH가 받아도 무시한다 — 수집 파이프라인이 채운 값을 검토 화면이 덮는 사고를 막는다.

### 확신도·근거

Mongo는 문서당 `confidence`(`high|medium|low`) 하나와 `rationale` 한 문장만 갖는다. 화면의
필드별 확신도 바 대신 **상품 정보 패널에 한 번** 표기한다(Flask 화면도 같다). 필드별 확신도가
필요해지면 collector의 프롬프트를 확장하는 별도 작업이며, 719건 재분석 비용이 든다.

### 검토 상태

`review_status`가 진실의 원천이고 Flask와 공유한다.

| Mongo `review_status` | 화면 상태 |
|---|---|
| `reviewed` | 승인됨 |
| `needs_fix` | 반려됨 |
| `auto_ok` | 검토 완료 |
| `unreviewed` / 없음 | 미검토 |

화면에만 있는 부속 상태(필드별 검토 표시 `done|unreviewed|fix`, 값의 출처 `ai|human`, 검토
메모, 태그 추가 요청)는 Mongo 문서에 **`review_meta` 객체 하나**로 모아 담는다. 기존 필드를
건드리지 않는 추가형이라 Flask·재분석과 충돌하지 않는다(`update_fields`/재분석은 각자 지정한
필드만 `$set` 한다).

`review_meta.tagRequest`는 기록일 뿐 Flask의 pending 목록에 들어가지 않는다 — 사전 승격은
이번 범위 밖이다.

### 사전(taxonomy)

원천은 Python 저장소의 `taxonomy.json`이다(`/taxonomy` 승격이 그 파일에 쓴다). API가
`TAXONOMY_PATH`로 그 파일을 읽어 bootstrap 응답에 실어 보낸다. 사본을 만들지 않는다 — 세
저장소에 사전이 흩어지면 조용히 갈라진다.

FE의 손으로 적은 사전(`CATEGORIES`/`SUBTYPES`/…)과 `optionsFor()`는 응답의 taxonomy를 쓰도록
바꾼다. `category_groups`·`sub_types_groups` 등 그룹 정보가 들어 있어, 지금 하드코딩된
카테고리별 세부유형 중첩 맵을 대체할 수 있다(세부유형 40종·부위 18종이 살아난다).

### FE 변경

- [taggingCatalog.js](../../../apps/studio/src/lib/taggingCatalog.js): `TAGGING_SEED` 로드를
  bootstrap 호출로 교체하고, 사전을 응답에서 받는다. 저장은 localStorage 대신 API.
  **API가 없거나 실패하면 지금의 목업 시드 + 하드코딩 사전으로 폴백한다** — Vercel 배포본과
  사내망 밖에서도 화면이 깨지지 않아야 한다(읽기 전용 목업임을 배너로 알린다).
- [TaggingStudio.jsx](../../../apps/studio/src/components/TaggingStudio.jsx): 719건을 다루기
  위한 **검색창 하나**만 추가(브랜드·상품명). 나머지 UI·3컬럼 구성은 그대로 둔다.
- 저장 실패를 토스트로 알린다. 지금은 localStorage라 조용히 실패해도 무방했지만, 네트워크
  너머로 가면 침묵이 곧 유실이다.

## 테스트

모노레포에 테스트 러너가 없다. 의존성을 늘리지 않기 위해 Node 내장 `node --test`를 쓴다
(bff의 `e2e:mock`이 취한 방식과 같은 결).

1. `toUnit` — 실제 문서 모양의 픽스처 하나로 7필드·대표★·리뷰 요약·확신도 변환을 검증.
2. `toDocPatch` — 화이트리스트 밖 필드가 걸러지는지, 대표(★)가 선택 목록 밖이면 비는지.
3. 검토 상태 매핑 4종(`reviewed`/`needs_fix`/`auto_ok`/없음) 왕복.
4. 통합 스모크: 로컬 API에 bootstrap 호출 → 719건 로드, 사전 밖 값 0건 확인.
5. 손 검증: 상품 하나를 DDAK 화면에서 승인 → Mongo에서 `review_status='reviewed'` 확인 →
   Flask `/studio`에서도 같은 상태로 보이는지 교차 확인.

## 알려진 위험

- **검증 규칙이 두 벌이 된다.** DDAK `validateUnit`(필드별 min/max + 총합 3~10)과 Flask
  `tagging_rules.py`(+ 분야 불일치·택소노미 밖 값·상충 타입)가 다르다. Flask에서 "분야
  불일치 11건"으로 잡히는 상품이 DDAK에선 통과할 수 있다. 이번엔 DDAK 규칙을 쓰고, 규칙
  통합은 별도 작업으로 둔다. `tagging_rules.py`의 주석이 경고하듯 승인 게이트가 갈라지면
  한쪽으로 우회가 생긴다 — 오래 방치하지 않는다.
- **사전 파일 경로 결합.** `TAXONOMY_PATH`가 Python 저장소 체크아웃을 가리킨다. 사내 서버
  배포 시 두 저장소를 같이 두거나 사전을 공유 위치로 옮겨야 한다.
- **두 도구가 같은 문서를 동시에 쓴다.** 낙관적 잠금은 두지 않는다(검토자가 한둘이고, 마지막
  저장이 이긴다). 문제가 되면 `updated_at` 기반 충돌 감지를 추가한다.

## 열린 결정

없음. 진행 승인 완료(2026-09-01).
