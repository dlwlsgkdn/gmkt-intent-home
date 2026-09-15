import { Body, Controller, Get, Logger, Post, Query, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  HomePersonalizeBody,
  HomePersonalizeResult,
  PopularSearchesResult,
  SearchRouteBody,
  SearchRouteResult,
  SearchSuggestBody,
  SearchSuggestResult,
  type Profile,
} from '@ddak/schema'
import { heuristicHomeGreeting, heuristicHomeSuggestions, heuristicHomeThreadIndex } from '@ddak/pipeline'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { LlmService } from '../llm/llm.service'
import { PopularSearchesService } from './popular-searches.service'
import { WeatherService } from './weather.service'

/*
 * 홈 검색창 API — 검색어 하나로 두 갈래를 가르는 라우터(DDAK 설문→계획 / 검색 결과 페이지)와 입력 중 AI 검색어 추천,
 * 그리고 홈 첫 화면 재료(개인화 인사말·개인화 추천 검색어 / 인기 검색어).
 * LLM 호출은 전부 짧은 구조화 호출(effort low)이며, LLM 이 막히거나 실패하면 휴리스틱으로 대신 답한다(source='fallback') —
 * 검색창은 언제나 답을 받아야 하고, SRP 에서 DDAK 로 넘어가는 버튼이 있어 오판이 복구되기 때문이다. 홈 인사말도 같다:
 * FE 가 기본 인사말을 먼저 보이고 이 응답을 페이드인으로 얹으므로 늦거나 없어도 화면이 비지 않는다.
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

  constructor(
    private readonly llm: LlmService,
    private readonly weather: WeatherService,
    private readonly popular: PopularSearchesService,
  ) {}

  @Post('route')
  @ApiOperation({
    summary: '검색 진입 분기 — DDAK(설문→맞춤 계획) / 검색 결과 페이지(SRP)',
    description:
      '검색어를 LLM 이 두 갈래로 가른다. 뷰티 카테고리 안에서 설문·계획이 가치 있는 요청이면 ddak=true, 상품 종류·이름 조회나 ' +
      '뷰티 밖이면 false. LLM 미설정·실패 시 휴리스틱(source=fallback)으로 답한다. 검색어가 인기 검색어 후보 표에 있으면 그 count 를 1 올린다.',
  })
  @ApiBody({ schema: toOpenApi(SearchRouteBody) })
  @ApiCreatedResponse({ schema: toOpenApi(SearchRouteResult) })
  async route(@Body(new ZodValidationPipe(SearchRouteBody)) body: SearchRouteBody): Promise<SearchRouteResult> {
    this.popular.bump(body.query) // fire-and-forget — 후보 표에 있는 검색어만 반영된다
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

  @Post('home')
  @ApiOperation({
    summary: '홈 개인화 — 상태 인사말 + 개인화 추천 검색어(보라 칩)',
    description:
      '이름·프로필·기기 현지 시각·(허용된) 위치·최근 쇼핑 쓰레드 요약·최근 검색어로 홈 첫 화면 상태 인사 한 줄(검색어 제안 없음 — 최근 쓰레드를 가리키는 「」 부분과 threadIndex)과 ' +
      '자연어 추천 검색어 3개를 만든다. ' +
      '날씨는 BFF 가 Open-Meteo 에서 붙인다(없으면 서울 기준, 실패면 null). LLM 미설정·실패 시 같은 재료의 휴리스틱(source=fallback). ' +
      'FE 는 기본 인사말을 먼저 보이고 이 응답을 페이드인으로 얹는다.',
  })
  @ApiBody({ schema: toOpenApi(HomePersonalizeBody) })
  @ApiCreatedResponse({ schema: toOpenApi(HomePersonalizeResult) })
  async home(@Body(new ZodValidationPipe(HomePersonalizeBody)) body: HomePersonalizeBody): Promise<HomePersonalizeResult> {
    const weather = await this.weather.current(body.location)
    const input = {
      name: body.name,
      profile: body.profile,
      now: body.now,
      weather,
      threads: body.threads || [],
      recentSearches: body.recentSearches || [],
    }
    try {
      const { content } = await this.llm.personalizeHome(input)
      const greeting = content.greeting.trim()
      if (!greeting) throw new Error('empty greeting')
      const suggestions = content.suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 3)
      // 가리키는 쓰레드 번호는 요청 목록 범위 안일 때만 — 범위 밖·「」 없는 인사말은 탭 대상 없음
      const idx = typeof content.threadIndex === 'number' ? Math.floor(content.threadIndex) : null
      const threadIndex = idx != null && idx >= 1 && idx <= input.threads.length && /「[^」]+」/.test(greeting) ? idx : null
      return {
        greeting,
        threadIndex,
        suggestions: suggestions.length ? suggestions : heuristicHomeSuggestions(input),
        weather,
        source: 'llm',
      }
    } catch (e) {
      this.logger.warn(`홈 개인화 LLM 실패 — 휴리스틱으로 대신: ${(e as Error).message}`)
      return {
        greeting: heuristicHomeGreeting(input),
        threadIndex: heuristicHomeThreadIndex(input),
        suggestions: heuristicHomeSuggestions(input),
        weather,
        source: 'fallback',
      }
    }
  }

  @Get('popular')
  @ApiOperation({
    summary: '인기 검색어(파랑 칩) — 전체 사용자 후보 표를 인기순 내림차순으로 최대 n개',
    description:
      '원천은 core 설정 KV `search-popular`(`[{keyword,count}]`). 표가 없으면 @ddak/pipeline 시드로 답하며 같은 값을 KV 에 한 번 시딩한다(source=seed). ' +
      '검색 제출이 후보 표의 검색어와 일치하면 count 가 1 오른다.',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 3, description: '1~10, 기본 3' })
  @ApiOkResponse({ schema: toOpenApi(PopularSearchesResult) })
  popularSearches(@Query('limit') limit?: string): Promise<PopularSearchesResult> {
    const n = Math.min(10, Math.max(1, Number(limit) || 3))
    return this.popular.list(n)
  }
}
