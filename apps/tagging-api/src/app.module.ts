import { Module } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { TaggingService } from './tagging.service'
import { TaggingController } from './tagging.controller'
import { StateService } from './state.service'
import { StateController } from './state.controller'

@Module({
  controllers: [TaggingController, StateController],
  providers: [MongoService, TaxonomyService, TaggingService, StateService],
})
export class AppModule {}
