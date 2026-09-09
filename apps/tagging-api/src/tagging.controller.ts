import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { TaggingService } from './tagging.service'

@Controller('tagging')
export class TaggingController {
  constructor(private readonly tagging: TaggingService) {}

  @Get('bootstrap')
  bootstrap() {
    return this.tagging.bootstrap()
  }

  @Get('summary')
  summary() {
    return this.tagging.summary()
  }

  @Patch('units/:catalogId')
  save(@Param('catalogId') catalogId: string, @Body() body: unknown) {
    return this.tagging.saveUnit(catalogId, body)
  }

  @Post('units/:catalogId/review')
  review(@Param('catalogId') catalogId: string, @Body() body: { decision?: unknown }) {
    return this.tagging.setDecision(catalogId, body?.decision ?? null)
  }
}
