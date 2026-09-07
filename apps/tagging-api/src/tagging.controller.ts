import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { TaggingService } from './tagging.service'

@Controller()
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

  @Patch('units/:productId')
  save(@Param('productId') productId: string, @Body() body: unknown) {
    return this.tagging.saveUnit(productId, body)
  }

  @Post('units/:productId/review')
  review(@Param('productId') productId: string, @Body() body: { decision?: unknown }) {
    return this.tagging.setDecision(productId, body?.decision ?? null)
  }
}
