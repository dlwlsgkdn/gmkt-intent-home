import { z } from 'zod'
import type { ZodType } from 'zod'
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'

/** @ddak/schema의 zod 계약 → OpenAPI 스키마 (zod v4 내장 변환). 문서도 계약이 단일 출처다. */
export function toOpenApi(schema: ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as SchemaObject
}
