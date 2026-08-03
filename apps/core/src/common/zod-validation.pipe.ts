import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

/** @ddak/schema의 zod 계약으로 본문을 검증한다 — 계약이 곧 검증기 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw new BadRequestException({
        message: '요청 본문이 계약과 다릅니다',
        issues: result.error.issues,
      })
    }
    return result.data
  }
}
