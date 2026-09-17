import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import {
  CatalogContentSearchWire,
  CatalogProductSearchWire,
  CatalogSearchQuery,
  CatalogStatsWire,
  PatchCatalogRowBody,
  UpsertCatalogContentsBody,
  UpsertCatalogProductsBody,
  UpsertCatalogResult,
} from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { CatalogService } from './catalog.service'

/** 내재화 카탈로그 internal API (BFF 전용) — 저장·검색·점검 (API.md §2-1) */
@ApiTags('internal-catalog')
@ApiBearerAuth()
@Controller('internal/catalog')
@UseGuards(ServiceTokenGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('products/search')
  @ApiOperation({ summary: '상품 검색 — 검색어 부분 일치 점수순 (기본 verified·active 만)' })
  @ApiBody({ schema: toOpenApi(CatalogSearchQuery) })
  @ApiOkResponse({ schema: toOpenApi(CatalogProductSearchWire) })
  searchProducts(@Body(new ZodValidationPipe(CatalogSearchQuery)) body: CatalogSearchQuery) {
    return this.catalog.searchProducts(body)
  }

  @Post('contents/search')
  @ApiOperation({ summary: '콘텐츠 검색 — 검색어 부분 일치 점수순' })
  @ApiBody({ schema: toOpenApi(CatalogSearchQuery) })
  @ApiOkResponse({ schema: toOpenApi(CatalogContentSearchWire) })
  searchContents(@Body(new ZodValidationPipe(CatalogSearchQuery)) body: CatalogSearchQuery) {
    return this.catalog.searchContents(body)
  }

  @Put('products')
  @ApiOperation({ summary: '상품 일괄 upsert (≤500) — bump=true 면 수확(노출 횟수 누적·출처/검증 보존)' })
  @ApiBody({ schema: toOpenApi(UpsertCatalogProductsBody) })
  @ApiOkResponse({ schema: toOpenApi(UpsertCatalogResult) })
  upsertProducts(@Body(new ZodValidationPipe(UpsertCatalogProductsBody)) body: UpsertCatalogProductsBody) {
    return this.catalog.upsertProducts(body.items, body.bump ?? false)
  }

  @Put('contents')
  @ApiOperation({ summary: '콘텐츠 일괄 upsert (≤500) — bump=true 면 수확' })
  @ApiBody({ schema: toOpenApi(UpsertCatalogContentsBody) })
  @ApiOkResponse({ schema: toOpenApi(UpsertCatalogResult) })
  upsertContents(@Body(new ZodValidationPipe(UpsertCatalogContentsBody)) body: UpsertCatalogContentsBody) {
    return this.catalog.upsertContents(body.items, body.bump ?? false)
  }

  @Patch('products/:id')
  @ApiOperation({ summary: '상품 행 표시 — verified·status(active|dead)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: toOpenApi(PatchCatalogRowBody) })
  patchProduct(@Param('id') id: string, @Body(new ZodValidationPipe(PatchCatalogRowBody)) body: PatchCatalogRowBody) {
    return this.catalog.patchProduct(id, body)
  }

  @Patch('contents/:id')
  @ApiOperation({ summary: '콘텐츠 행 표시 — verified·status' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: toOpenApi(PatchCatalogRowBody) })
  patchContent(@Param('id') id: string, @Body(new ZodValidationPipe(PatchCatalogRowBody)) body: PatchCatalogRowBody) {
    return this.catalog.patchContent(id, body)
  }

  @Get('products/verify-list')
  @ApiOperation({ summary: "점검 대상 상품 — 오래 안 본 순, mall='*'(기본) 은 전 몰 (BFF 가 몰별 주소에 HEAD 로 생사를 본다)" })
  @ApiQuery({ name: 'mall', required: false, example: '*' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 50 })
  verifyList(
    @Query('mall', new DefaultValuePipe('*')) mall: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.catalog.listForVerify(mall, Math.min(Math.max(limit, 1), 200))
  }

  @Post('ensure-schema')
  @ApiOperation({ summary: '표 만들기 — 마이그레이션 0005 DDL 을 멱등 적용 + drizzle 이력 기록 (로컬 Node 없이 운영 콘솔에서)' })
  ensureSchema() {
    return this.catalog.ensureSchema()
  }

  @Get('stats')
  @ApiOperation({ summary: '카탈로그 현황 — 개수·몰별·출처별·검증·dead' })
  @ApiOkResponse({ schema: toOpenApi(CatalogStatsWire) })
  stats() {
    return this.catalog.stats()
  }
}
