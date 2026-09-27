import type { CreateEvalCaseBody, CreateEvalRunBody, JudgeEvalRunBody, ScoreEvalRunBody } from '@ddak/schema'
import type { EvalCaseWire, EvalRunWire } from '../db/wire'

/*
 * 평가·실험 저장 계층의 계약 = DI 토큰 (페이즈 5) — 케이스(입력 스냅샷)와 실행(설정×결과×채점)을 저장·조회만.
 * 내용 해석·집계·비교는 BFF/FE 몫. 구현은 저장소별로 둘(eval.neon.service.ts · eval.mongo.service.ts),
 * EvalModule 이 STORE 에 따라 하나를 꽂는다.
 */
export abstract class EvalService {
  abstract createCase(body: CreateEvalCaseBody): Promise<EvalCaseWire>
  abstract listCases(limit?: number): Promise<EvalCaseWire[]>
  abstract getCase(id: string): Promise<EvalCaseWire>
  /** 케이스 삭제 — 실행 기록도 함께 (Neon 은 FK cascade, Mongo 는 코드로 재현) */
  abstract deleteCase(id: string): Promise<{ ok: boolean }>
  abstract createRun(caseId: string, body: CreateEvalRunBody): Promise<EvalRunWire>
  abstract listRuns(caseId: string, limit?: number): Promise<EvalRunWire[]>
  /** 실행 단건 + 소속 케이스 — 자동 채점(BFF)이 케이스 입력을 함께 쓴다 */
  abstract getRun(id: string): Promise<{ run: EvalRunWire; case: EvalCaseWire }>
  /** 사람 채점 — judge 는 건드리지 않는다 (source 분리) */
  abstract scoreRun(id: string, body: ScoreEvalRunBody): Promise<EvalRunWire>
  /** 자동 채점 판정 저장 — 사람 채점은 건드리지 않는다 (source 분리) */
  abstract setJudge(id: string, body: JudgeEvalRunBody): Promise<EvalRunWire>
}
