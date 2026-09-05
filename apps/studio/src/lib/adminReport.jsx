/* 관리 페이지의 쓰레드 문서화 — core ThreadWithSteps를 마크다운 문서로 변환하고,
   그 문서를 화면에 렌더한다. 렌더러는 우리가 생성하는 마크다운 서브셋(제목·표·목록·
   코드블록·굵게·인라인 코드·수평선)만 다루는 미니 구현 — 외부 의존성 없음.
   "마크다운 복사"가 원문을 그대로 쓰므로 생성기와 렌더러는 같은 서브셋을 유지할 것. */

import React from 'react'

const STATUS_LABEL = {
  exploring: '탐색 중',
  surveying: '설문 중',
  planning: '계획 확인 중',
  done: '완료',
  abandoned: '이탈',
  archived: '보관됨',
}

export function statusLabel(status) {
  return STATUS_LABEL[status] || status
}

function fmtTime(iso) {
  const t = new Date(iso || '')
  if (Number.isNaN(t.getTime())) return String(iso || '—')
  const pad = (n) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
}

function fmtNum(n) {
  return typeof n === 'number' ? n.toLocaleString('ko-KR') : null
}

function sourceLine(source) {
  if (!source) return '—'
  if (source.kind === 'chip') return `칩 클릭 · ${source.chipId || '?'}`
  return `검색 · "${source.query || '?'}"`
}

/** 스텝 payload를 사람이 읽을 요약 줄 목록으로 — 단계별 형태가 다르다 (API.md §2 seq 규약) */
function stepSummary(step, surveyPage) {
  const p = step.payload || {}
  const lines = []
  if (step.stage === 'explore') {
    lines.push(`- 진입: ${sourceLine(p.source)}`)
    if (Array.isArray(p.profile) && p.profile.length > 0) {
      lines.push(`- 프로필: ${p.profile.map((it) => `${it.label}=${it.value}`).join(', ')}`)
    }
  } else if (step.stage === 'survey') {
    const page = p.page || {}
    if (page.intro) lines.push(`- 인트로: ${page.intro}`)
    const questions = Array.isArray(page.questions) ? page.questions : []
    lines.push(`- 질문 ${questions.length}개:`)
    for (const q of questions) {
      lines.push(`  - [${q.id}] ${q.question} (${(q.options || []).length}지선다${q.multi ? ' · 복수' : ''})`)
    }
  } else if (step.stage === 'answers') {
    const answers = Array.isArray(p.answers) ? p.answers : []
    const questions = surveyPage && Array.isArray(surveyPage.questions) ? surveyPage.questions : []
    for (const a of answers) {
      const q = questions.find((question) => question.id === a.questionId)
      lines.push(`- ${q ? q.question : a.questionId}: **${(a.choices || []).join(', ')}**`)
    }
    if (answers.length === 0) lines.push('- (답변 없음)')
  } else if (step.stage === 'plan') {
    const page = p.page || {}
    if (page.headline) lines.push(`- 헤드라인: ${page.headline}`)
    if (page.summary) lines.push(`- 요약: ${page.summary}`)
    const sections = Array.isArray(page.sections) ? page.sections : []
    for (const s of sections) {
      if (s.kind === 'products') {
        const matches = (s.products || []).filter((x) => x.match).map((x) => `${x.match.score}%`)
        lines.push(`- [products] ${s.title} — 상품 ${(s.products || []).length}개${matches.length ? ` (매칭율 ${matches.join(' · ')})` : ''}`)
      } else if (s.kind === 'contents') {
        lines.push(`- [contents] ${s.title} — 콘텐츠 ${(s.items || []).length}개`)
      } else if (s.kind === 'steps') {
        lines.push(`- [steps] ${s.title} — 체크 ${(s.steps || []).length}개`)
      } else {
        lines.push(`- [${s.kind}] ${s.title}`)
      }
    }
  } else if (step.stage === 'action') {
    if (p.type === 'feedback' && p.data && typeof p.data === 'object') {
      lines.push(...feedbackSummary(p.data))
    } else if (p.type === 'prompt-trial' && p.data && typeof p.data === 'object') {
      const trial = p.data
      const score = trial.evaluation?.score
      lines.push('- 행동: **prompt-trial** · 저장된 지시서 A/B 시험')
      lines.push(`- 지시서: **${trial.promptLabel || trial.promptId || '?'}**`)
      lines.push(`- 수정 명령: ${trial.instruction || '—'}`)
      lines.push(`- 최초 검색 문장: ${trial.intent || '—'}`)
      lines.push(`- 수정 요약: ${trial.summary || '—'}`)
      lines.push(`- 전체 평가: ${score == null ? '미평가' : `${'★'.repeat(score)} ${score}점`}${trial.evaluation?.comment ? ` — "${trial.evaluation.comment}"` : ''}`)
      lines.push('- 적용 상태: **결정 대기**')
    } else if (p.type === 'prompt-trial-decision' && p.data && typeof p.data === 'object') {
      lines.push(`- 행동: **prompt-trial-decision** · ${p.data.decision === 'applied' ? '시험안 적용 완료' : '시험안 적용 안 함'}`)
      if (p.data.summary) lines.push(`- 시험 요약: ${p.data.summary}`)
    } else {
      lines.push(`- 행동: **${p.type || '?'}**${p.data ? ` · ${JSON.stringify(p.data)}` : ''}`)
    }
    if (p.at) lines.push(`- 시각: ${fmtTime(p.at)}`)
  }
  return lines
}

/** 피드백 제출(action type='feedback')을 별점·코멘트로 문서화 — 같은 단계의 뒤 스텝이 최신 유효본 */
function feedbackSummary(data) {
  const star = (score) =>
    score == null ? '미평가' : score === 0 ? '0점(사용 불가)' : `${'★'.repeat(score)} ${score}점`
  const line = (label, entry) =>
    `${label}: ${star(entry.score)}${entry.feedback ? ` — "${entry.feedback}"` : ''}`
  const lines = [`- 행동: **feedback** · ${data.stage === 'plan' ? '계획' : '설문'} 페이지 평가`]
  if (data.review) lines.push(`- ${line('전체', data.review)}`)
  for (const c of data.components || []) {
    lines.push(`  - ${line(c.label || c.id, c)}`)
  }
  return lines
}

function llmMetaLine(meta) {
  if (!meta) return null
  const parts = []
  if (meta.model) parts.push(`모델 \`${meta.model}\``)
  if (meta.promptVersion) parts.push(`프롬프트 ${meta.promptVersion}`)
  const usage = meta.usage || {}
  const inTok = fmtNum(usage.inputTokens)
  const outTok = fmtNum(usage.outputTokens)
  if (inTok || outTok) {
    const cache = fmtNum(usage.cacheReadTokens)
    parts.push(`토큰 입력 ${inTok ?? '?'} / 출력 ${outTok ?? '?'}${cache ? ` (캐시 읽기 ${cache})` : ''}`)
  }
  if (typeof meta.latencyMs === 'number') parts.push(`${(meta.latencyMs / 1000).toFixed(1)}s`)
  return parts.length > 0 ? `- LLM: ${parts.join(' · ')}` : null
}

const PAYLOAD_JSON_LIMIT = 4000

/** core ThreadWithSteps → 마크다운 문서 (복사·공유 가능한 원문) */
export function threadMarkdown(thread) {
  const steps = Array.isArray(thread.steps) ? thread.steps : []
  const surveyStep = steps.find((s) => s.stage === 'survey')
  const surveyPage = surveyStep && surveyStep.payload ? surveyStep.payload.page : null

  const md = []
  md.push(`# 쓰레드 ${thread.id}`)
  md.push('')
  md.push('| 항목 | 값 |')
  md.push('|---|---|')
  md.push(`| 제목 | ${thread.title || '—'} |`)
  md.push(`| 상태 | ${statusLabel(thread.status)} (\`${thread.status}\`) |`)
  md.push(`| 사용자 | \`${thread.userId}\` |`)
  md.push(`| 진입 | ${sourceLine(thread.source)} |`)
  md.push(`| 생성 | ${fmtTime(thread.createdAt)} |`)
  md.push(`| 갱신 | ${fmtTime(thread.updatedAt)} |`)
  md.push('')
  md.push('---')
  md.push('')
  md.push(`## 라이프사이클 로그 (${steps.length} 스텝)`)

  for (const step of steps) {
    md.push('')
    md.push(`### ${step.seq}. ${step.stage} — ${fmtTime(step.createdAt)}`)
    const lines = stepSummary(step, surveyPage)
    if (lines.length > 0) md.push(...lines)
    const meta = llmMetaLine(step.llmMeta)
    if (meta) md.push(meta)
    let json = JSON.stringify(step.payload, null, 2)
    if (json && json.length > PAYLOAD_JSON_LIMIT) {
      json = `${json.slice(0, PAYLOAD_JSON_LIMIT)}\n… (${fmtNum(json.length)}자 중 앞부분만)`
    }
    md.push('')
    md.push('```json')
    md.push(json || '{}')
    md.push('```')
  }

  if (steps.length === 0) {
    md.push('')
    md.push('- (기록된 스텝이 없어요)')
  }
  return md.join('\n')
}

/* ── 미니 마크다운 렌더러 — 위 생성기가 만드는 서브셋 전용 ────────────── */

function renderInline(text, key) {
  // **굵게** 와 `코드` 만 — 생성기가 쓰는 인라인 서식 전부
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <React.Fragment key={key}>
      {parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>
        if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>
        return part
      })}
    </React.Fragment>
  )
}

export function renderMarkdown(md) {
  const lines = String(md || '').split('\n')
  const out = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const buf = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1 // 닫는 ```
      out.push(
        <pre key={key++} className="sb-admin-doc__code">
          <code>{buf.join('\n')}</code>
        </pre>
      )
      continue
    }
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i])
        i += 1
      }
      const parse = (row) => row.split('|').slice(1, -1).map((cell) => cell.trim())
      const header = parse(rows[0] || '')
      const body = rows.slice(2).map(parse) // rows[1] = 구분선
      out.push(
        <table key={key++}>
          <thead>
            <tr>{header.map((cell, c) => <th key={c}>{renderInline(cell, c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((cells, r) => (
              <tr key={r}>{cells.map((cell, c) => <td key={c}>{renderInline(cell, c)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }
    if (/^- |^ {2}- /.test(line)) {
      const items = []
      while (i < lines.length && /^- |^ {2}- /.test(lines[i])) {
        items.push(lines[i])
        i += 1
      }
      out.push(
        <ul key={key++}>
          {items.map((item, n) => (
            <li key={n} className={item.startsWith('  ') ? 'sb-admin-doc__nested' : undefined}>
              {renderInline(item.replace(/^ {2}- |^- /, ''), n)}
            </li>
          ))}
        </ul>
      )
      continue
    }
    if (line.startsWith('### ')) out.push(<h4 key={key++}>{renderInline(line.slice(4), key)}</h4>)
    else if (line.startsWith('## ')) out.push(<h3 key={key++}>{renderInline(line.slice(3), key)}</h3>)
    else if (line.startsWith('# ')) out.push(<h2 key={key++}>{renderInline(line.slice(2), key)}</h2>)
    else if (line.trim() === '---') out.push(<hr key={key++} />)
    else if (line.trim() !== '') out.push(<p key={key++}>{renderInline(line, key)}</p>)
    i += 1
  }
  return out
}
