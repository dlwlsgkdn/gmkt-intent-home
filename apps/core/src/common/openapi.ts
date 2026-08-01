import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodTypeAny } from 'zod'
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'

// zodToJsonSchema의 제네릭 반환 타입이 복잡한 스키마에서 TS2589(무한 추론)를 일으켜
// 시그니처를 단순화해 호출한다 — 런타임 동작은 동일.
const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, opts: { target: 'openApi3' }) => unknown

/** @ddak/schema의 zod 계약 → OpenAPI 스키마. 문서도 계약이 단일 출처다. */
export function toOpenApi(schema: ZodTypeAny): SchemaObject {
  return convert(schema, { target: 'openApi3' }) as SchemaObject
}
