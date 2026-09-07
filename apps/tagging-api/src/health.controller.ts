import { Controller, Get } from '@nestjs/common'
import { MongoService } from './mongo.service'

/* 기동 확인 전용 엔드포인트 — **Mongo에 의존하지 않는다.**
   쿠버네티스 프로브를 /api/tagging/summary 처럼 DB를 타는 경로에 걸면, Mongo가 잠깐
   흔들리는 것만으로 프로브가 실패해 Pod 이 죽고 재시작을 반복한다(사내망 존 방화벽처럼
   앱 밖의 이유로도 그렇게 된다). 그래서 프로세스가 살아 있는지와 의존성이 붙었는지를
   분리한다: 상태 코드는 언제나 200 이고, Mongo 연결 여부는 본문 mongo 필드로만 알린다. */
@Controller('health')
export class HealthController {
  constructor(private readonly mongo: MongoService) {}

  @Get()
  health() {
    return { ok: true, mongo: this.mongo.collection() ? 'connected' : 'disconnected' }
  }
}
