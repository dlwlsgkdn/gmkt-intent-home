import React from 'react'
import { PLAN_CONDITION_OPERATORS, createPlanCondition, splitOptions } from '../../lib/store.js'

const operatorFor = (key) =>
  PLAN_CONDITION_OPERATORS.find((operator) => operator.key === key)
  || PLAN_CONDITION_OPERATORS[0]

export default function PlanCaseEditor({
  planCase,
  caseIndex,
  caseCount,
  questions,
  onChange,
  onSetFallback,
  onDuplicate,
  onDelete,
  onMove,
}) {
  if (!planCase) return null

  const updateCondition = (id, patch) => {
    onChange({
      conditions: (planCase.conditions || []).map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition
      ),
    })
  }

  const removeCondition = (id) => {
    onChange({ conditions: (planCase.conditions || []).filter((condition) => condition.id !== id) })
  }

  const addCondition = () => {
    const question = questions[0]
    onChange({
      conditions: [
        ...(planCase.conditions || []),
        createPlanCondition({ questionId: question?.id || '' }),
      ],
    })
  }

  return (
    <div className="sb-plan-case-editor" onClick={(event) => event.stopPropagation()}>
      <div className="sb-plan-case-editor__head">
        <div>
          <p className="sb-panel-label">계획 케이스 설정</p>
          <small>
            {planCase.isFallback
              ? '조건 미일치 폴백 · 항상 마지막에 평가돼요.'
              : `우선순위 ${caseIndex + 1} · 위에서부터 첫 번째 일치 케이스가 실행돼요.`}
          </small>
        </div>
        <span className={'sb-plan-case-badge' + (planCase.isFallback ? ' sb-plan-case-badge--fallback' : '')}>
          {planCase.isFallback ? '기본' : `조건 ${planCase.conditions.length}`}
        </span>
      </div>

      <div className="sb-field">
        <label>케이스 이름</label>
        <input
          type="text"
          value={planCase.name}
          placeholder="예: 건조 · 고예산 집중 플랜"
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>

      {planCase.isFallback ? (
        <div className="sb-plan-case-fallback">
          <strong>기본 계획 케이스</strong>
          <p>위의 조건부 케이스가 하나도 일치하지 않을 때 이 페이지를 보여줘요. 저장된 조건은 기본 지정을 해제하면 다시 사용됩니다.</p>
        </div>
      ) : (
        <>
          <div className="sb-field">
            <label>여러 조건 조합</label>
            <div className="sb-seg">
              <button
                type="button"
                className={'sb-seg__btn' + (planCase.conditionMode === 'all' ? ' sb-seg__btn--active' : '')}
                onClick={() => onChange({ conditionMode: 'all' })}
              >
                모두 만족 (AND)
              </button>
              <button
                type="button"
                className={'sb-seg__btn' + (planCase.conditionMode === 'any' ? ' sb-seg__btn--active' : '')}
                onClick={() => onChange({ conditionMode: 'any' })}
              >
                하나라도 만족 (OR)
              </button>
            </div>
          </div>

          <div className="sb-plan-rules">
            {(planCase.conditions || []).map((condition, index) => {
              const question = questions.find((item) => item.id === condition.questionId)
              const options = question ? splitOptions(question.props.options).map((option) => option.main) : []
              const operator = operatorFor(condition.operator)
              const staleValues = (condition.values || []).filter((value) => !options.includes(value))
              return (
                <div key={condition.id} className="sb-plan-rule">
                  <div className="sb-plan-rule__top">
                    <span>{index + 1}</span>
                    <select
                      value={condition.questionId}
                      aria-label={`${index + 1}번째 조건 질문`}
                      onChange={(event) => updateCondition(condition.id, { questionId: event.target.value, values: [] })}
                    >
                      <option value="">질문을 선택하세요</option>
                      {questions.map((item) => (
                        <option key={item.id} value={item.id}>{item.props.question || '제목 없는 질문'}</option>
                      ))}
                    </select>
                    <button type="button" className="sb-plan-rule__remove" title="조건 삭제" onClick={() => removeCondition(condition.id)}>×</button>
                  </div>

                  <select
                    className="sb-plan-rule__operator"
                    value={condition.operator}
                    aria-label={`${index + 1}번째 조건 판정 방식`}
                    onChange={(event) => {
                      const next = operatorFor(event.target.value)
                      updateCondition(condition.id, {
                        operator: next.key,
                        values: next.needsValues ? condition.values : [],
                      })
                    }}
                  >
                    {PLAN_CONDITION_OPERATORS.map((item) => (
                      <option key={item.key} value={item.key}>{item.label}</option>
                    ))}
                  </select>

                  {operator.needsValues && (
                    <div className="sb-plan-rule__options">
                      {options.map((value) => {
                        const active = (condition.values || []).includes(value)
                        return (
                          <button
                            key={value}
                            type="button"
                            className={active ? 'sb-plan-rule-option sb-plan-rule-option--active' : 'sb-plan-rule-option'}
                            onClick={() => {
                              const values = active
                                ? condition.values.filter((item) => item !== value)
                                : [...(condition.values || []), value]
                              updateCondition(condition.id, { values })
                            }}
                          >
                            <span>{active ? '✓' : ''}</span>{value}
                          </button>
                        )
                      })}
                      {question && options.length === 0 && <em>이 질문에는 선택지가 없어요.</em>}
                      {!question && <em>먼저 설문 질문을 선택하세요.</em>}
                      {staleValues.map((value) => (
                        <button
                          key={'stale:' + value}
                          type="button"
                          className="sb-plan-rule-option sb-plan-rule-option--stale"
                          title="설문 선택지에서 사라진 값 — 클릭해 조건에서 제거"
                          onClick={() => updateCondition(condition.id, {
                            values: condition.values.filter((item) => item !== value),
                          })}
                        >
                          ⚠ {value} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {questions.length === 0 && (
            <p className="sb-plan-case-warning">설문 탭에 ‘설문 질문’ 컴포넌트를 먼저 추가해야 조건을 만들 수 있어요.</p>
          )}
          {questions.length > 0 && planCase.conditions.length === 0 && (
            <p className="sb-plan-case-warning">조건이 없는 일반 케이스는 매칭되지 않아요. 조건을 하나 이상 추가하세요.</p>
          )}
          <button type="button" className="sb-btn sb-btn--small" onClick={addCondition} disabled={questions.length === 0}>
            + 설문 조건 추가
          </button>
        </>
      )}

      <div className="sb-plan-case-editor__actions">
        {!planCase.isFallback && (
          <button type="button" onClick={onSetFallback}>기본 케이스로 지정</button>
        )}
        <button type="button" disabled={planCase.isFallback || caseIndex === 0} onClick={() => onMove(-1)} title="우선순위 올리기">← 위로</button>
        <button type="button" disabled={planCase.isFallback || caseIndex >= caseCount - 2} onClick={() => onMove(1)} title="우선순위 내리기">아래로 →</button>
        <button type="button" onClick={onDuplicate}>복제</button>
        <button type="button" className="sb-danger" disabled={caseCount <= 1} onClick={onDelete}>삭제</button>
      </div>
    </div>
  )
}
