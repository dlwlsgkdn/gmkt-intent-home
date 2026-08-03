import { BadRequestException, Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { PutSettingBody, SETTING_KEY_PATTERN, SettingWire } from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { SettingsService } from './settings.service'

const KEY_PARAM = { name: 'key', description: '설정 키 (소문자·숫자·하이픈) — 예: llm-model' } as const

/** internal 설정 KV — BFF 전용. 관리 페이지의 런타임 설정(LLM 모델 등)이 여기 저장된다 */
@ApiTags('settings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '서비스 토큰 없음/불일치' })
@Controller('internal/settings')
@UseGuards(ServiceTokenGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  private validateKey(key: string) {
    if (!SETTING_KEY_PATTERN.test(key)) throw new BadRequestException('설정 키 형식이 아닙니다')
    return key
  }

  @Get(':key')
  @ApiOperation({ summary: '설정 조회 — 없으면 404' })
  @ApiParam(KEY_PARAM)
  @ApiOkResponse({ schema: toOpenApi(SettingWire) })
  get(@Param('key') key: string) {
    return this.settings.get(this.validateKey(key))
  }

  @Put(':key')
  @ApiOperation({ summary: '설정 저장 (멱등 upsert)' })
  @ApiParam(KEY_PARAM)
  @ApiBody({ schema: toOpenApi(PutSettingBody) })
  @ApiOkResponse({ schema: toOpenApi(SettingWire) })
  put(@Param('key') key: string, @Body(new ZodValidationPipe(PutSettingBody)) body: PutSettingBody) {
    return this.settings.put(this.validateKey(key), body.value)
  }

  @Delete(':key')
  @ApiOperation({ summary: '설정 제거 (멱등) — 기본값으로 되돌릴 때' })
  @ApiParam(KEY_PARAM)
  remove(@Param('key') key: string) {
    return this.settings.remove(this.validateKey(key))
  }
}
