import React from 'react'
import { splitList, splitTextList, joinTextList } from '../../lib/store.js'
import { plainEvaluationText } from '../../lib/evaluation.js'

/*
 * 프로필 요약 패널 / 설문 요약 패널의 속성 칩 관리 편집기.
 *
 * - ProfileChipManager (kind: 'profileChips') — 프로필 칩의 문구·추가·삭제·순서는
 *   계정 프로필 공통(api.updateProfile → 탐색·모든 시나리오에 반영)이고,
 *   노출 체크만 이 시나리오의 props.hidden에 저장된다 (캔버스 배지 클릭과 동일).
 * - SummaryChipManager (kind: 'summaryChips') — 설문 요약 패널이 보여줄 항목 선택.
 *   프로필 칩은 라벨, 설문 질문은 질문 문구로 매칭한다 (문구를 바꾸면 다시 보임 — 안전한 실패).
 */

const renameInList = (list, from, to) => list.map((label) => (label === from ? to : label))

export function ProfileChipManager({ hidden, onChangeHidden, profile, updateProfile }) {
  const items = (profile?.items || [])
  const hiddenList = splitList(hidden)

  const setHidden = (next) => onChangeHidden(next.join(', '))
  const setItems = (next) => updateProfile({ ...profile, items: next })
  const toggle = (label) =>
    setHidden(hiddenList.includes(label) ? hiddenList.filter((l) => l !== label) : [...hiddenList, label])
  const patchItem = (i, key, v) => {
    const before = items[i]
    setItems(items.map((item, j) => (j === i ? { ...item, [key]: v } : item)))
    // 라벨을 고치면 숨김 목록의 라벨도 함께 갱신 (숨김 상태 유지)
    if (key === 'label' && before && hiddenList.includes(before.label)) {
      setHidden(renameInList(hiddenList, before.label, v))
    }
  }
  const moveItem = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  const removeItem = (i) => {
    const target = items[i]
    setItems(items.filter((_, j) => j !== i))
    if (target && hiddenList.includes(target.label)) setHidden(hiddenList.filter((l) => l !== target.label))
  }

  return (
    <div className="sb-optlist sb-chipman">
      <div className="sb-optlist__head">
        <span className="sb-optlist__count">
          {items.length}개 · 노출 {items.filter((item) => !hiddenList.includes(item.label)).length}개
        </span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="sb-optlist__row">
          <label className="sb-chipman__check" title={hiddenList.includes(item.label) ? '이 시나리오에 노출하기' : '이 시나리오에서 숨기기'}>
            <input
              type="checkbox"
              checked={!hiddenList.includes(item.label)}
              onChange={() => toggle(item.label)}
            />
          </label>
          <div className="sb-optlist__inputs">
            <div className="sb-optlist__pair">
              <input
                type="text"
                value={item.label}
                placeholder="라벨 (예: 피부타입)"
                onChange={(e) => patchItem(i, 'label', e.target.value)}
              />
              <input
                type="text"
                value={item.value}
                placeholder="값 (예: 복합성)"
                onChange={(e) => patchItem(i, 'value', e.target.value)}
              />
            </div>
          </div>
          <div className="sb-optlist__tools">
            <button type="button" title="위로" disabled={i === 0} onClick={() => moveItem(i, -1)}>↑</button>
            <button type="button" title="아래로" disabled={i === items.length - 1} onClick={() => moveItem(i, 1)}>↓</button>
            <button type="button" className="sb-optlist__remove" title="속성 삭제 (계정 프로필에서 제거)" onClick={() => removeItem(i)}>✕</button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="sb-btn sb-btn--ghost sb-btn--small sb-optlist__add"
        onClick={() => setItems([...items, { label: '', value: '' }])}
      >
        + 속성 추가
      </button>
      <p className="sb-optlist__hint">
        체크 = 이 시나리오에 노출 (캔버스 배지 클릭과 동일). 문구·추가·삭제·순서는 <b>계정 프로필 공통</b>이라
        탐색 페이지와 모든 시나리오에 함께 반영돼요.
      </p>
    </div>
  )
}

export function SummaryChipManager({
  hiddenProfile,
  hiddenQuestions,
  onChangeHiddenProfile,
  onChangeHiddenQuestions,
  profile,
  surveyQuestions,
}) {
  const items = (profile?.items || []).filter((item) => item.label && item.label.trim())
  const questions = surveyQuestions || []
  const hiddenP = splitList(hiddenProfile)
  const hiddenQ = splitTextList(hiddenQuestions)

  const toggleProfile = (label) =>
    onChangeHiddenProfile(
      (hiddenP.includes(label) ? hiddenP.filter((l) => l !== label) : [...hiddenP, label]).join(', ')
    )
  const toggleQuestion = (text) => {
    const key = String(text || '').trim()
    onChangeHiddenQuestions(
      joinTextList(hiddenQ.includes(key) ? hiddenQ.filter((t) => t !== key) : [...hiddenQ, key])
    )
  }

  return (
    <div className="sb-optlist sb-chipman">
      <p className="sb-chipman__group">프로필 항목</p>
      {items.length === 0 && <p className="sb-optlist__hint">프로필 항목이 없어요.</p>}
      {items.map((item) => (
        <label key={item.label} className="sb-chipman__toggle-row">
          <input
            type="checkbox"
            checked={!hiddenP.includes(item.label)}
            onChange={() => toggleProfile(item.label)}
          />
          <span className="sb-chipman__label">{item.label}</span>
          <span className="sb-chipman__value">{item.value}</span>
        </label>
      ))}
      <p className="sb-chipman__group">설문 질문</p>
      {questions.length === 0 && <p className="sb-optlist__hint">설문 단계에 질문 컴포넌트가 없어요.</p>}
      {questions.map((question) => {
        const key = String(question.text || '').trim()
        return (
          <label key={question.id} className="sb-chipman__toggle-row">
            <input type="checkbox" checked={!hiddenQ.includes(key)} onChange={() => toggleQuestion(key)} />
            <span className="sb-chipman__label sb-chipman__label--wide">{plainEvaluationText(question.text) || '질문'}</span>
          </label>
        )
      })}
      <p className="sb-optlist__hint">
        체크한 항목만 요약에 표시돼요. 질문은 문구 기준으로 기억하므로 질문 문구를 바꾸면 다시 표시될 수 있어요.
      </p>
    </div>
  )
}
