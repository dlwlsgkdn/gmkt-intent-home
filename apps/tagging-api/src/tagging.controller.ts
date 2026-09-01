import { Controller, Get } from '@nestjs/common'
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
}
