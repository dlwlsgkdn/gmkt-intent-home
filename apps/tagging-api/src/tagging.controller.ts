import { Body, Controller, Get, Param, Patch } from '@nestjs/common'
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
}
