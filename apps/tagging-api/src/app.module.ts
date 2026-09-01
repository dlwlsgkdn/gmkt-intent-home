import { Module } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { TaggingService } from './tagging.service'
import { TaggingController } from './tagging.controller'

@Module({
  controllers: [TaggingController],
  providers: [MongoService, TaxonomyService, TaggingService],
})
export class AppModule {}
