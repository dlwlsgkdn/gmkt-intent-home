import { Module } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { TaggingService } from './tagging.service'
import { TaggingController } from './tagging.controller'
import { HealthController } from './health.controller'
import { StateService } from './state.service'
import { StateController } from './state.controller'

@Module({
  controllers: [TaggingController, HealthController, StateController],
  providers: [MongoService, TaxonomyService, TaggingService, StateService],
})
export class AppModule {}
