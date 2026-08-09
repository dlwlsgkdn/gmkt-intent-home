import { z } from 'zod'
import type { Answer, Profile, SurveyPageWire } from '@ddak/schema'

/*
 * 제약 원장(constraint ledger) — 전략 문서 2단계. 제약을 문장이 아니라 구조체로 굳혀,
 * 생성(검색 필터·설문 중복 방지)과 검증(6단계 역대조)이 같은 값을 보게 하는 장치.
 * 전 필드 optional/빈값 허용 — 데이터 소스(피드백·키워드·설문조사)가 아직 없어도 성립하고,
 * 소스가 생기면 조립기 입력만 채워진다. 스텝 payload에 스냅샷으로 기록된다(페이즈 3).
 */

export const LedgerFact = z.object({
  /** 사람이 읽는 라벨 (예: 피부타입, 예산) */
  label: z.string(),
  value: z.string(),
  /** 값의 출처 — 설문 중복 방지·검증 근거 표시용. intent = 1단계 의도 정규화 산출 */
  source: z.enum(['profile', 'answer', 'feedback', 'signal', 'intent']),
})
export type LedgerFact = z.infer<typeof LedgerFact>

export const SelectionSignal = z.object({
  /** 상품명 — 담음·버림 신호 (전략 문서 p.14) */
  name: z.string(),
  action: z.enum(['cartAdd', 'cartRemove', 'dismissed']),
})
export type SelectionSignal = z.infer<typeof SelectionSignal>

export const ConstraintLedger = z.object({
  /** 확정 사실 — 프로필·설문 답변에서 굳힌 값. "원장에 있으면 묻지 않는다"의 원천 */
  facts: z.array(LedgerFact),
  /** 예산 상한 (원) — facts에서 파생 가능하면 파생, 아니면 null */
  budgetKrw: z.number().int().nullable(),
  /** 기피 성분·속성 — 6단계 역대조 대상 */
  avoid: z.array(z.string()),
  /** 직전 쓰레드 피드백 한 줄 압축 (예: "향 강한 제품 ★1") */
  recentFeedback: z.array(z.string()),
  /** 지금 뜨는 키워드 — KV knowledge-trend-keywords 원천, 4단계 검색어 결합 */
  trendKeywords: z.array(z.string()),
  /** 직전 쓰레드의 담음·버림 신호 */
  selectionSignals: z.array(SelectionSignal),
})
export type ConstraintLedger = z.infer<typeof ConstraintLedger>

export const emptyLedger = (): ConstraintLedger => ({
  facts: [],
  budgetKrw: null,
  avoid: [],
  recentFeedback: [],
  trendKeywords: [],
  selectionSignals: [],
})

export type LedgerInputs = {
  profile?: Profile
  survey?: SurveyPageWire
  answers?: Answer[]
  /** 1단계 의도 정규화 산출 — facts(source='intent')로 굳는다 */
  intentProfile?: { template: string; goal: string; timing: string; audience: string } | null
  recentFeedback?: string[]
  trendKeywords?: string[]
  selectionSignals?: SelectionSignal[]
}

/** 예산 문구에서 상한 파싱 — "3만원", "30,000원 이하" 등. 못 읽으면 null */
export function parseBudgetKrw(value: string): number | null {
  const man = value.replace(/\s/g, '').match(/(\d+(?:\.\d+)?)만\s*원?/)
  if (man) return Math.round(Number(man[1]) * 10_000)
  const won = value.replace(/[,\s]/g, '').match(/(\d{4,})원/)
  if (won) return Number(won[1])
  return null
}

/** 원장 조립 — 있는 소스만 굳힌다. 프로필·답변은 facts로, 예산 라벨은 budgetKrw로,
 * 기피 라벨(기피/피하-)은 avoid 목록으로 파생 — 검증 게이트 역대조가 같은 값을 본다 */
export function assembleLedger(inputs: LedgerInputs): ConstraintLedger {
  const facts: LedgerFact[] = []
  if (inputs.intentProfile) {
    facts.push({ label: '의도 유형', value: inputs.intentProfile.template, source: 'intent' })
    facts.push({ label: '목적', value: inputs.intentProfile.goal, source: 'intent' })
    facts.push({ label: '시점', value: inputs.intentProfile.timing, source: 'intent' })
    facts.push({ label: '대상', value: inputs.intentProfile.audience, source: 'intent' })
  }
  for (const p of inputs.profile ?? []) {
    facts.push({ label: p.label, value: p.value, source: 'profile' })
  }
  for (const a of inputs.answers ?? []) {
    const q = inputs.survey?.questions.find((x) => x.id === a.questionId)
    facts.push({ label: q?.question ?? a.questionId, value: a.choices.join(', '), source: 'answer' })
  }
  const budgetFact = facts.find((f) => /예산|가격대/.test(f.label))
  const avoid: string[] = []
  for (const f of facts) {
    if (!/기피|피하/.test(f.label)) continue
    for (const token of f.value.split(/[,·/]/)) {
      const t = token.trim()
      if (t && !avoid.includes(t)) avoid.push(t)
    }
  }
  return {
    facts,
    budgetKrw: budgetFact ? parseBudgetKrw(budgetFact.value) : null,
    avoid,
    recentFeedback: inputs.recentFeedback ?? [],
    trendKeywords: inputs.trendKeywords ?? [],
    selectionSignals: inputs.selectionSignals ?? [],
  }
}
