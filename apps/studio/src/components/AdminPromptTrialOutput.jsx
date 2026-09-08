import React from 'react'

const SECTION_LABEL = {
  guide: '단계 안내',
  look: '연출 제안',
  steps: '체크리스트',
  products: '상품 추천',
  contents: '참고 콘텐츠',
}


const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const comparableQuestion = (question) => question ? {
  question: question.question || '',
  options: question.options || [],
} : null

const comparableSection = (section) => section ? {
  kind: section.kind || '',
  title: section.title || '',
  body: section.body || section.desc || section.reason || '',
  points: section.points || section.steps || [],
  products: [...(section.webProducts || []), ...(section.products || [])].map((product) => ({
    id: product.id || '',
    brand: product.brand || '',
    name: product.name || '',
    price: product.price ?? null,
  })),
  items: (section.items || []).map((item) => ({ title: item.title || '', source: item.source || '', url: item.url || '' })),
  productIds: section.productIds || [],
} : null

const planSections = (selectedId, output) =>
  selectedId === 'plan-skeleton' ? output?.skeleton?.sections || [] : output?.sections || []

function DiffBadge({ side }) {
  return <small className={`sb-prompt-trial__diff-badge is-${side}`}>{side === 'before' ? '변경 전' : '변경 후'}</small>
}

function SurveyResult({ survey, answers = [], compareSurvey = null, diffSide = null }) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.choices]))
  const introChanged = diffSide && !sameValue(survey?.intro || '', compareSurvey?.intro || '')
  return (
    <div className="sb-prompt-trial__survey">
      {survey?.intro && <p className={introChanged ? `is-diff is-${diffSide}` : ''}>{introChanged && <DiffBadge side={diffSide} />}{survey.intro}</p>}
      <ol>
        {(survey?.questions || []).map((question, index) => {
          const changed = diffSide && !sameValue(comparableQuestion(question), comparableQuestion(compareSurvey?.questions?.[index]))
          return (
            <li key={question.id} className={changed ? `is-diff is-${diffSide}` : ''}>
              <span>{index + 1}</span>
              <div>
                {changed && <DiffBadge side={diffSide} />}
                <b>{question.question}</b>
                <div>
                  {(question.options || []).map((option) => (
                    <em key={option} className={answerMap.get(question.id)?.includes(option) ? 'is-picked' : ''}>{option}</em>
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function PlanSection({ section, compareSection = null, diffSide = null }) {
  const products = [...(section.webProducts || []), ...(section.products || [])]
  const changed = diffSide && !sameValue(comparableSection(section), comparableSection(compareSection))
  return (
    <article className={`sb-prompt-trial__section${changed ? ` is-diff is-${diffSide}` : ''}`}>
      <div className="sb-prompt-trial__section-meta"><span>{SECTION_LABEL[section.kind] || section.kind}</span>{changed && <DiffBadge side={diffSide} />}</div>
      <h4>{section.title || '제목 없음'}</h4>
      {(section.body || section.desc || section.reason) && <p>{section.body || section.desc || section.reason}</p>}
      {(section.points || section.steps || []).length > 0 && (
        <ul>{(section.points || section.steps).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      )}
      {products.length > 0 && (
        <ul className="sb-prompt-trial__products">
          {products.map((product, index) => (
            <li key={product.id || product.url || `${product.name}-${index}`}>
              <b>{product.brand ? `${product.brand} ` : ''}{product.name || product.id}</b>
              {product.price != null && <small>{Number(product.price).toLocaleString('ko-KR')}원</small>}
            </li>
          ))}
        </ul>
      )}
      {(section.items || []).length > 0 && (
        <ul className="sb-prompt-trial__products">
          {section.items.map((item, index) => <li key={item.url || `${item.title}-${index}`}><b>{item.title}</b><small>{item.source}</small></li>)}
        </ul>
      )}
      {(section.productIds || []).length > 0 && products.length === 0 && (
        <p className="sb-admin__muted">카탈로그 상품 · {section.productIds.join(', ')}</p>
      )}
    </article>
  )
}

export function TrialOutput({ selectedId, output, compareOutput, diffSide }) {
  if (!output) return null
  if (selectedId === 'survey') return <SurveyResult survey={output.survey} compareSurvey={compareOutput?.survey} diffSide={diffSide} />
  const sections = planSections(selectedId, output)
  const compareSections = planSections(selectedId, compareOutput)
  const headingChanged = selectedId === 'plan-skeleton' && !sameValue(
    { headline: output.skeleton?.headline || '', summary: output.skeleton?.summary || '' },
    { headline: compareOutput?.skeleton?.headline || '', summary: compareOutput?.skeleton?.summary || '' },
  )
  return (
    <div className="sb-prompt-trial__plan">
      {selectedId === 'plan-skeleton' && (
        <header className={headingChanged ? `is-diff is-${diffSide}` : ''}>{headingChanged && <DiffBadge side={diffSide} />}<h3>{output.skeleton?.headline}</h3><p>{output.skeleton?.summary}</p></header>
      )}
      {sections.map((section, index) => <PlanSection key={`${section.kind}-${section.title}-${index}`} section={section} compareSection={compareSections[index]} diffSide={diffSide} />)}
      {sections.length === 0 && <p className="sb-admin__muted">검증을 통과해 표시할 결과가 없어요. 지시를 조금 바꿔 다시 시험해보세요.</p>}
    </div>
  )
}

