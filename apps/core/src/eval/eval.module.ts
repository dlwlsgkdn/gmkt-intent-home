import { Module } from '@nestjs/common'
import { DbModule } from '../db/db.module'
import { EvalController } from './eval.controller'
import { EvalService } from './eval.service'

@Module({
  imports: [DbModule],
  controllers: [EvalController],
  providers: [EvalService],
})
export class EvalModule {}
