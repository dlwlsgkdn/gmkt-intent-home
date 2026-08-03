import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common'
import { THREAD_ID_PATTERN } from '@ddak/schema'

/** ParseUUIDPipe 대응 — threadId(스노우플레이크 숫자 문자열) 경로 파라미터 검증 */
@Injectable()
export class ParseThreadIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!THREAD_ID_PATTERN.test(value)) {
      throw new BadRequestException('threadId 형식이 아닙니다 (스노우플레이크 숫자 문자열)')
    }
    return value
  }
}
