/*
 * 구조화 출력 스트림의 컴포넌트 경계 파서 — 텍스트 델타를 누적하며
 * 대상 배열(sections/questions)의 원소 하나가 닫힐 때마다 콜백으로 내보낸다 (§4-1 부분 스트리밍).
 *
 * 안전 근거: JSON 문자열 값 안의 따옴표는 반드시 \" 로 이스케이프되므로, 원문에서
 * `"키"` 시퀀스(비이스케이프 따옴표)는 실제 키에서만 나타난다 — 정규식 탐색이 안전하다.
 * 원소 스캔은 깊이·문자열·이스케이프 상태를 추적하는 상태기계로, pause_turn 연속 호출로
 * JSON이 응답 경계에 걸쳐 쪼개져도 같은 인스턴스에 델타를 계속 밀어 넣으면 이어진다.
 *
 * 토큰 단위 미리보기(onHeadPartial/onElementPartial): 완성을 기다리지 않고 자라는 중인
 * 값을 스로틀 간격으로 내보낸다 — 미완성 원소는 열린 문자열·괄호를 닫아 복구 파싱한다.
 * 같은 키/인덱스로 반복 호출되며, 완성 시 onHead/onElement가 최종본으로 뒤따른다.
 *
 * 조각 JSON.parse 실패나 콜백 누락은 조용히 넘어간다 — 스트리밍은 UX 미리보기일 뿐이고,
 * 권위는 언제나 스트림 종료 후의 전체 파싱·검증(llm.service)이다.
 */
export type StreamParserOptions = {
  /** 원소 단위로 내보낼 대상 배열의 최상위 키 (예: 'sections', 'questions') */
  arrayKey: string
  /** 값이 완성되는 즉시 내보낼 최상위 문자열 필드 (예: headline·summary·intro) */
  headKeys?: string[]
  onHead?: (key: string, value: string) => void
  onElement?: (element: unknown, index: number) => void
  /** 자라는 중인 머리 필드 미리보기 — 같은 키로 값이 자라며 반복 호출된다 */
  onHeadPartial?: (key: string, value: string) => void
  /** 자라는 중인 원소 미리보기 — 복구 파싱된 미완성 객체. 같은 인덱스로 반복 호출된다 */
  onElementPartial?: (element: unknown, index: number) => void
  /** 부분 미리보기 최소 방출 간격(ms) — 델타마다 전부 내보내는 SSE 폭주 방지. 기본 120 */
  partialIntervalMs?: number
}

/** 미완성 JSON 문자열 꼬리 복구 — 잘린 이스케이프(\, \uXX…)를 걷어내고 파싱한다 */
function parsePartialString(raw: string): string | null {
  for (let k = 0; k <= 5 && k <= raw.length; k++) {
    try {
      return JSON.parse(`"${raw.slice(0, raw.length - k)}"`) as string
    } catch {
      /* 다음 후보 */
    }
  }
  return null
}

export class StructuredStreamParser {
  private buffer = ''
  private readonly headFound = new Set<string>()
  private arrayFound = false
  private scanPos = 0
  private depth = 0
  private inString = false
  private escape = false
  private elementStart = -1
  private elementIndex = 0
  private done = false
  /** 현재 열려 있는 괄호 스택 (배열 내부 한정) — 미완성 원소 복구 파싱의 닫는 괄호 재료 */
  private readonly openStack: string[] = []
  /** 부분 미리보기 마지막 방출 시각 — 키/인덱스별 스로틀 */
  private readonly lastPartialAt = new Map<string, number>()

  constructor(private readonly opts: StreamParserOptions) {}

  push(delta: string) {
    this.buffer += delta
    this.scanHeads()
    this.scanArray()
    this.scanHeadPartials()
    this.emitElementPartial()
  }

  private shouldEmitPartial(key: string): boolean {
    const now = Date.now()
    const last = this.lastPartialAt.get(key) ?? 0
    if (now - last < (this.opts.partialIntervalMs ?? 120)) return false
    this.lastPartialAt.set(key, now)
    return true
  }

  /** 아직 안 닫힌 머리 필드 — 자라는 중인 값을 그대로 내보낸다 (닫히면 scanHeads가 최종본) */
  private scanHeadPartials() {
    if (!this.opts.onHeadPartial) return
    for (const key of this.opts.headKeys ?? []) {
      if (this.headFound.has(key)) continue
      const open = this.buffer.match(new RegExp(`"${key}"\\s*:\\s*"`))
      if (!open || open.index === undefined) continue
      if (!this.shouldEmitPartial(`head:${key}`)) continue
      const value = parsePartialString(this.buffer.slice(open.index + open[0].length))
      if (value) this.opts.onHeadPartial(key, value)
    }
  }

  /** 열려 있는 원소를 복구 파싱해 미리보기로 내보낸다 — 실패는 조용히 다음 델타에 재시도 */
  private emitElementPartial() {
    if (!this.opts.onElementPartial || this.done || this.elementStart < 0) return
    if (!this.shouldEmitPartial(`el:${this.elementIndex}`)) return
    const raw = this.buffer.slice(this.elementStart)
    const closers = [...this.openStack].reverse().map((c) => (c === '{' ? '}' : ']')).join('')
    const candidates: string[] = []
    if (this.inString) {
      // 문자열 값 도중 — 잘린 이스케이프 꼬리를 걷어내며 닫는 따옴표를 붙여 본다
      for (let k = 0; k <= 5 && k < raw.length; k++) candidates.push(raw.slice(0, raw.length - k) + '"' + closers)
    } else {
      const stripped = raw.replace(/[\s,:]+$/, '')
      candidates.push(raw + closers, stripped + closers)
      // 값 없이 매달린 키(`,"title"`)를 걷어낸 후보 — 키 스트리밍 순간의 파싱 실패 보정
      candidates.push(stripped.replace(/,?\s*"(?:[^"\\]|\\.)*"$/, '') + closers)
    }
    for (const candidate of candidates) {
      try {
        this.opts.onElementPartial(JSON.parse(candidate), this.elementIndex)
        return
      } catch {
        /* 다음 후보 */
      }
    }
  }

  /** 최상위 문자열 필드 — 닫는 따옴표까지 완성된 시점에 한 번만 내보낸다 */
  private scanHeads() {
    for (const key of this.opts.headKeys ?? []) {
      if (this.headFound.has(key)) continue
      const match = this.buffer.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`))
      if (!match) continue
      this.headFound.add(key)
      try {
        this.opts.onHead?.(key, JSON.parse(match[1]) as string)
      } catch {
        /* 조각 파싱 실패 — 최종 검증에 맡긴다 */
      }
    }
  }

  private scanArray() {
    if (this.done) return
    if (!this.arrayFound) {
      const match = this.buffer.match(new RegExp(`"${this.opts.arrayKey}"\\s*:\\s*\\[`))
      if (!match || match.index === undefined) return
      this.arrayFound = true
      this.scanPos = match.index + match[0].length
    }
    // 배열 내부: depth 0 = 원소 사이. 원소 객체가 닫히면 그 구간만 잘라 파싱한다
    while (this.scanPos < this.buffer.length) {
      const ch = this.buffer[this.scanPos]
      if (this.inString) {
        if (this.escape) this.escape = false
        else if (ch === '\\') this.escape = true
        else if (ch === '"') this.inString = false
      } else if (ch === '"') {
        this.inString = true
      } else if (ch === '{' || ch === '[') {
        if (this.depth === 0 && ch === '{') this.elementStart = this.scanPos
        this.depth++
        this.openStack.push(ch)
      } else if (ch === '}' || ch === ']') {
        if (this.depth === 0) {
          // 대상 배열 자체가 닫혔다 (']') — 이후 텍스트는 원소 스캔 대상이 아니다
          this.done = true
          return
        }
        this.depth--
        this.openStack.pop()
        if (this.depth === 0 && ch === '}' && this.elementStart >= 0) {
          const raw = this.buffer.slice(this.elementStart, this.scanPos + 1)
          this.elementStart = -1
          const index = this.elementIndex++
          try {
            this.opts.onElement?.(JSON.parse(raw), index)
          } catch {
            /* 조각 파싱 실패 — 최종 검증에 맡긴다 */
          }
        }
      }
      this.scanPos++
    }
  }
}
