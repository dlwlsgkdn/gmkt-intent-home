import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import {
  SearchRouteBody,
  SearchRouteResult,
  SearchSuggestBody,
  SearchSuggestResult,
  type Profile,
} from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { LlmService } from '../llm/llm.service'

/*
 * 홈 검색창 API — 검색어 하나로 두 갈래를 가르는 라우터(DDAK 설문→계획 / 검색 결과 페이지)와 입력 중 AI 검색어 추천.
 * 둘 다 짧은 구조화 LLM 호출이며, LLM 이 막히거나 실패하면 휴리스틱으로 대신 답한다(source='fallback') —
 * 검색창은 언제나 답을 받아야 하고, SRP 에서 DDAK 로 넘어가는 버튼이 있어 오판이 복구되기 때문이다.
 */

/** LLM 없이도 검색어를 가르는 휴리스틱 — 고민·상황·요청형 표현이나 긴 문장은 DDAK, 짧은 상품 종류 단어는 SRP */
export function heuristicRoute(query: string): { ddak: boolean; reason: string } {
  const q = query.trim()
  const asks = /추천|어울리|좋은|좋을까|루틴|메이크업|피부|고민|무너|찾아|해줘|어떤|비교|트러블|여드름|건조|번들|출근|데이트|결혼|여름|겨울|톤/.test(q)
  const longish = q.replace(/\s+/g, '').length >= 10
  const ddak = asks || longish
  return {
    ddak,
    reason: ddak ? '고민·상황·요청형 표현이 있어 설문으로 상황을 묻는 편이 낫다' : '상품 종류·이름 조회로 보여 검색 결과가 빠르다',
  }
}

/** LLM 없이 만드는 추천 검색어 — 프로필의 피부 타입이 있으면 한 문장에 싣는다 */
export function heuristicSuggest(query: string, profile?: Profile): string[] {
  const q = query.trim()
  const skin = profile?.find((it) => /피부/.test(it.label))?.value
  const first = skin ? `${skin} 피부에 쓰기 좋은 ${q} 추천해줘` : `지성피부에 쓰기 좋은 ${q} 추천해줘`
  return [first, `데일리로 무난하게 쓸 ${q} 추천해줘`, `오래 가는 ${q} 찾아줘`]
}

@ApiTags('search')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '서비스 토큰 없음/불일치 (BFF_SERVICE_TOKEN 설정 시)' })
@UseGuards(ServiceTokenGuard)
@Controller('api/search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name)

  constructor(private readonly llm: LlmService) {}

  @Post('route')
  @ApiOperation({
    summary: '검색 진입 분기 — DDAK(설문→맞춤 계획) / 검색 결과 페이지(SRP)',
    description:
      '검색어를 LLM 이 두 갈래로 가른다. 뷰티 카테고리 안에서 설문·계획이 가치 있는 요청이면 ddak=true, 상품 종류·이름 조회나 ' +
      '뷰티 밖이면 false. LLM 미설정·실패 시 휴리스틱(source=fallback)으로 답한다.',
  })
  @ApiBody({ schema: toOpenApi(SearchRouteBody) })
  @ApiCreatedResponse({ schema: toOpenApi(SearchRouteResult) })
  async route(@Body(new ZodValidationPipe(SearchRouteBody)) body: SearchRouteBody): Promise<SearchRouteResult> {
    try {
      const { content } = await this.llm.routeSearch(body.query, body.profile)
      return {
        ddak: content.ddak,
        normalized: content.normalized.trim() || body.query,
        reason: content.reason,
        source: 'llm',
      }
    } catch (e) {
      this.logger.warn(`검색 라우팅 LLM 실패 — 휴리스틱으로 대신: ${(e as Error).message}`)
      const h = heuristicRoute(body.query)
      return { ddak: h.ddak, normalized: body.query, reason: h.reason, source: 'fallback' }
    }
  }

  @Post('suggest')
  @ApiOperation({
    summary: 'AI 검색어 추천 — 입력 중인 검색어에 상황·피부·계절을 덧붙인 자연어 검색어 3개',
    description: '검색창 자동완성 아래 ✦ 행에 싣는 추천. LLM 미설정·실패 시 템플릿 문장(source=fallback)으로 답한다.',
  })
  @ApiBody({ schema: toOpenApi(SearchSuggestBody) })
  @ApiCreatedResponse({ schema: toOpenApi(SearchSuggestResult) })
  async suggest(@Body(new ZodValidationPipe(SearchSuggestBody)) body: SearchSuggestBody): Promise<SearchSuggestResult> {
    try {
      const { content } = await this.llm.suggestSearch(body.query, body.profile)
      const suggestions = content.suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 3)
      if (!suggestions.length) throw new Error('empty suggestions')
      return { suggestions, source: 'llm' }
    } catch (e) {
      this.logger.warn(`검색어 추천 LLM 실패 — 템플릿으로 대신: ${(e as Error).message}`)
      return { suggestions: heuristicSuggest(body.query, body.profile), source: 'fallback' }
    }
  }
}
