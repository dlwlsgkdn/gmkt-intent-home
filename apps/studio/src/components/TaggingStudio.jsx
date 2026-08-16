import React, { useEffect, useMemo, useState } from 'react'
import {
  FIELD_DEFS,
  TAGGING_SEED,
  TAG_LIMIT,
  UNIT_STATUS,
  loadTaggingReview,
  optionsFor,
  productEmoji,
  resetTaggingReview,
  saveTaggingReview,
  taggingExportPayload,
  totalTags,
  unitStatusKey,
  validateUnit,
} from '../lib/taggingCatalog.js'

/*
 * 상품 태깅 검토 스튜디오 — 라이브 생성의 상품 매칭(그라운딩) 근거인 카탈로그 태그를
 * 사람이 점검하는 화면. AI 1차 분류(필드별 태그·확신도·근거)를 3컬럼으로 검토한다:
 * 좌측 작업 단위 목록+상품 정보, 가운데 필드별 태깅 편집(대표 태그 ★·근거·미검토 확인),
 * 우측 태그 게이지·최종 태그·규칙 검증·승인/반려. 결과는 이 브라우저에만 저장되고,
 * 카탈로그(코드) 반영·기기 이동은 JSON 내보내기로 한다. 진입은 홈 드로어의 도구 행.
 */

const formatPrice = (price) => `${Number(price).toLocaleString('ko-KR')}원`

const confLevel = (confidence) => (confidence >= 75 ? 'ok' : confidence >= 60 ? 'warn' : 'bad')
const needsReviewUnit = (unit) => ['unreviewed', 'fix'].includes(unitStatusKey(unit))
const fieldEditKey = (unitId, fieldKey) => `${unitId}:${fieldKey}`

/* 필드가 규칙상 다시 봐야 하는지 — status뿐 아니라 사람이 편집하다 만든 범위·사전 오류도
   검수 전용 보기에서 사라지지 않게 같은 관문으로 판정한다. */
const fieldHasValueIssue = (unit, def) => {
  const field = unit.fields[def.key]
  if (field.selected.length < def.min || field.selected.length > def.max) return true
  const allow = optionsFor(def.key, unit.fields.category.selected[0])
  if (field.selected.some((tag) => !allow.includes(tag))) return true
  return def.max > 1 && field.selected.length > 1 && !field.rep
}
const fieldNeedsReview = (unit, def) => unit.fields[def.key].status !== 'done' || fieldHasValueIssue(unit, def)

const cloneSeedField = (field) => ({ ...field, selected: [...field.selected] })

const freshSeedUnit = (unitId) => {
  const seed = TAGGING_SEED.find((candidate) => candidate.id === unitId)
  if (!seed) return null
  return {
    ...seed,
    fields: Object.fromEntries(Object.entries(seed.fields).map(([key, field]) => [key, cloneSeedField(field)])),
    tagRequest: { ...(seed.tagRequest || {}) },
    decision: null,
    note: '',
  }
}

function UnitThumb({ unit, className }) {
  const [broken, setBroken] = useState(false)
  if (unit.imageUrl && !broken) {
    return <img className={className} src={unit.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
  }
  return <span className={className}>{productEmoji(unit.catalogTags)}</span>
}

export default function TaggingStudio({ api, embedded = false }) {
  const [units, setUnits] = useState(loadTaggingReview)
  const [selectedId, setSelectedId] = useState(() => units.find(needsReviewUnit)?.id ?? units[0]?.id ?? null)
  const [listFilter, setListFilter] = useState('needs-review')
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(true)
  const [openWhy, setOpenWhy] = useState({})
  /* 잠금 해제는 편집 세션 상태다. 저장본의 status=done이 기본 잠금 원천이라 새로 열면 다시 안전하게 잠긴다. */
  const [unlockedFields, setUnlockedFields] = useState({})

  useEffect(() => {
    saveTaggingReview(units)
  }, [units])

  const statusById = useMemo(() => new Map(units.map((u) => [u.id, unitStatusKey(u)])), [units])
  const counts = useMemo(() => {
    const out = { unreviewed: 0, fix: 0 }
    for (const key of statusById.values()) if (out[key] !== undefined) out[key] += 1
    return out
  }, [statusById])

  const listed = units.filter((u) => {
    if (listFilter === 'all') return true
    if (listFilter === 'needs-review') return needsReviewUnit(u)
    return statusById.get(u.id) === listFilter
  })
  /* 현재 항목이 검수 완료되어 큐에서 빠지면 다음 검수 항목을 즉시 보여준다. */
  const unit = listed.find((u) => u.id === selectedId) || listed[0] || units.find((u) => u.id === selectedId) || units[0]
  const { errs, warns } = useMemo(() => validateUnit(unit), [unit])
  const total = totalTags(unit)
  const finalTags = FIELD_DEFS.flatMap((d) =>
    unit.fields[d.key].selected.map((tag) => ({ tag, key: d.key, field: d.label, rep: unit.fields[d.key].rep === tag }))
  )
  const unreviewedFields = FIELD_DEFS.filter((d) => unit.fields[d.key].status === 'unreviewed')
  const currentReviewFields = FIELD_DEFS.filter((def) => fieldNeedsReview(unit, def))
  const reviewStats = useMemo(() => {
    let pending = 0
    let locked = 0
    for (const candidate of units) {
      for (const def of FIELD_DEFS) {
        if (fieldNeedsReview(candidate, def)) pending += 1
        else locked += 1
      }
    }
    return { pending, locked, total: pending + locked }
  }, [units])

  const selectUnit = (id) => {
    setSelectedId(id)
    setOpenWhy({})
  }

  const patchUnit = (updater) => {
    setUnits((prev) => prev.map((u) => (u.id === unit.id ? updater(u) : u)))
  }

  const setFieldUnlocked = (key, unlocked) => {
    const editKey = fieldEditKey(unit.id, key)
    setUnlockedFields((prev) => ({ ...prev, [editKey]: unlocked }))
  }

  const restoreAiField = (key) => {
    const seed = TAGGING_SEED.find((candidate) => candidate.id === unit.id)
    if (!seed) return
    /* 대분류를 되돌릴 때 종속 사전도 함께 복원해 서로 허용되지 않는 조합이 남지 않게 한다. */
    const keys = key === 'category' ? ['category', 'subtype', 'type'] : [key]
    patchUnit((current) => {
      const fields = { ...current.fields }
      const tagRequest = { ...current.tagRequest }
      for (const restoreKey of keys) {
        fields[restoreKey] = cloneSeedField(seed.fields[restoreKey])
        tagRequest[restoreKey] = !!seed.tagRequest?.[restoreKey]
      }
      return { ...current, fields, tagRequest, decision: null }
    })
    setUnlockedFields((prev) => {
      const next = { ...prev }
      for (const restoreKey of keys) delete next[fieldEditKey(unit.id, restoreKey)]
      return next
    })
    api.showToast(key === 'category' ? '대분류와 연결 항목을 AI 원본으로 되돌렸어요.' : 'AI가 분류한 원본 값으로 되돌렸어요.')
  }

  const restoreCurrentUnit = () => {
    if (!window.confirm(`「${unit.name}」의 담당자 수정·검토 메모를 지우고 AI 원본으로 되돌릴까요?`)) return
    const fresh = freshSeedUnit(unit.id)
    if (!fresh) return
    setUnits((prev) => prev.map((candidate) => candidate.id === unit.id ? fresh : candidate))
    setUnlockedFields((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => !key.startsWith(`${unit.id}:`)),
    ))
    setOpenWhy({})
    api.showToast('선택한 상품을 AI 원본으로 되돌렸어요.')
  }

  /* 사람 손이 닿은 필드는 담당자 소유·검토 완료가 되고, 승인/반려 결정은 초기화된다 */
  const toggleTag = (key, tag) => {
    const def = FIELD_DEFS.find((d) => d.key === key)
    patchUnit((u) => {
      const field = u.fields[key]
      let selected
      if (field.selected.includes(tag)) {
        selected = field.selected.filter((t) => t !== tag)
      } else if (def.max === 1) {
        selected = [tag]
      } else if (field.selected.length >= def.max) {
        api.showToast(`‘${def.label}’은(는) 최대 ${def.max}개까지 선택할 수 있어요.`)
        return u
      } else {
        selected = [...field.selected, tag]
      }
      const rep = selected.length === 1 ? selected[0] : (selected.includes(field.rep) ? field.rep : null)
      /* 검수 필요 필드는 값을 고쳤다고 자동 완료하지 않는다. 담당자가 아래 완료 버튼을
         명시적으로 눌러야 잠기고 큐에서 빠진다. 이미 잠금을 풀어 편집한 완료 필드만 완료 유지. */
      const fields = { ...u.fields, [key]: { ...field, selected, rep, origin: 'human' } }
      if (key === 'category') {
        /* 대분류가 바뀌면 종속 사전(세부유형·타입)에서 허용되지 않는 값을 정리한다 */
        for (const depKey of ['subtype', 'type']) {
          const dep = fields[depKey]
          const allow = optionsFor(depKey, selected[0])
          const kept = dep.selected.filter((t) => allow.includes(t))
          if (kept.length !== dep.selected.length) {
            fields[depKey] = {
              ...dep,
              selected: kept,
              rep: kept.length === 1 ? kept[0] : (kept.includes(dep.rep) ? dep.rep : null),
              origin: 'human',
            }
          }
        }
      }
      return { ...u, decision: null, fields }
    })
  }

  const setRep = (key, tag) => {
    patchUnit((u) => ({
      ...u,
      decision: null,
      fields: { ...u.fields, [key]: { ...u.fields[key], rep: tag, origin: 'human' } },
    }))
  }

  const markDone = (key) => {
    const def = FIELD_DEFS.find((candidate) => candidate.key === key)
    if (fieldHasValueIssue(unit, def)) {
      api.showToast(`‘${def.label}’의 선택 개수·대표 태그를 먼저 확인해주세요.`)
      return
    }
    patchUnit((u) => ({
      ...u,
      fields: { ...u.fields, [key]: { ...u.fields[key], status: 'done', origin: 'human' } },
    }))
    setFieldUnlocked(key, false)
  }

  const toggleRequest = (key) => {
    patchUnit((u) => ({ ...u, tagRequest: { ...u.tagRequest, [key]: !u.tagRequest[key] } }))
  }

  const approve = () => {
    if (errs.length) return api.showToast('규칙 위반이 있어 승인할 수 없어요.')
    if (unreviewedFields.length) return api.showToast('미검토 항목이 남아 있어요. 확인 후 승인해주세요.')
    patchUnit((u) => ({ ...u, decision: 'approved' }))
    api.showToast('승인 처리되었습니다.')
  }

  const reject = () => {
    patchUnit((u) => ({ ...u, decision: 'rejected' }))
    api.showToast('반려 처리되었습니다.')
  }

  const exportJson = () => {
    const payload = taggingExportPayload(units)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ddak-tagging-review-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    api.showToast('태깅 검토 결과를 JSON으로 내려받았어요.')
  }

  const resetAll = () => {
    if (!window.confirm('검토 상태·수정한 태그·메모를 모두 지우고 카탈로그 원본으로 되돌릴까요?')) return
    const fresh = resetTaggingReview()
    setUnits(fresh)
    setListFilter('needs-review')
    setOnlyNeedsReview(true)
    setOpenWhy({})
    setUnlockedFields({})
    api.showToast('카탈로그 원본으로 되돌렸어요.')
  }

  return (
    <section className={'sb-tagging' + (embedded ? ' sb-tagging--embedded' : '')}>
      <div className="sb-tagging__head">
        <div className="sb-tagging__title">
          <h1><span className="sb-tagging__mark">◈</span>상품 태깅 검토 스튜디오</h1>
          <p className="sb-tagging__sub">
            AI가 확정한 항목은 잠겨 있어요. 검수 필요 항목만 확인하고, 완료 항목을 고치려면 자물쇠를 풀어주세요.
            언제든 AI 원본으로 되돌릴 수 있어요.
          </p>
        </div>
        <div className="sb-tagging__filters">
          <button
            type="button"
            className={'sb-tagging-pill sb-tagging-pill--needs' + (listFilter === 'needs-review' ? ' is-on' : '')}
            onClick={() => setListFilter('needs-review')}
          >
            검수 필요 <b>{counts.unreviewed + counts.fix}</b>
          </button>
          <button
            type="button"
            className={'sb-tagging-pill sb-tagging-pill--unreviewed' + (listFilter === 'unreviewed' ? ' is-on' : '')}
            onClick={() => setListFilter((prev) => (prev === 'unreviewed' ? 'all' : 'unreviewed'))}
          >
            미검토 <b>{counts.unreviewed}</b>
          </button>
          <button
            type="button"
            className={'sb-tagging-pill sb-tagging-pill--fix' + (listFilter === 'fix' ? ' is-on' : '')}
            onClick={() => setListFilter((prev) => (prev === 'fix' ? 'all' : 'fix'))}
          >
            수정 필요 <b>{counts.fix}</b>
          </button>
          <button
            type="button"
            className={'sb-tagging-pill' + (listFilter === 'all' ? ' is-on' : '')}
            onClick={() => setListFilter('all')}
          >
            전체 <b>{units.length}</b>
          </button>
        </div>
        <div className="sb-tagging__head-actions">
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={exportJson}>
            JSON 내보내기
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={resetAll}>
            원본으로 초기화
          </button>
          {!embedded && <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={api.closeTaggingStudio}>
            홈으로
          </button>}
        </div>
      </div>

      <div className="sb-tagging__cols">
        {/* ── 좌: 작업 단위 목록 + 상품 정보 ── */}
        <aside className="sb-tagging__side">
          <div className="sb-tagging-panel">
            <p className="sb-tagging-panel__hd">
              작업 단위 <span className="sb-tagging-panel__dim">옵션 기준</span>
            </p>
            <div className="sb-tagging-units">
              {listed.length === 0 && <p className="sb-tagging-empty">해당 상태의 작업이 없어요.</p>}
              {listed.map((u) => {
                const status = UNIT_STATUS[statusById.get(u.id)]
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`sb-tagging-unit sb-tagging-unit--${status.cls}` + (u.id === unit.id ? ' is-sel' : '')}
                    onClick={() => selectUnit(u.id)}
                  >
                    <span className="sb-tagging-unit__thumb">
                      <UnitThumb unit={u} />
                    </span>
                    <span className="sb-tagging-unit__meta">
                      <span className="sb-tagging-unit__name">{u.name}</span>
                      <span className="sb-tagging-unit__opt">{u.brand} · {u.option}</span>
                    </span>
                    <span className={`sb-tagging-chip sb-tagging-chip--${status.cls}`}>{status.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="sb-tagging-panel sb-tagging-pinfo">
            <p className="sb-tagging-panel__hd">상품 정보</p>
            <div className="sb-tagging-pinfo__img">
              <UnitThumb unit={unit} />
            </div>
            <p className="sb-tagging-pinfo__name">{unit.name}</p>
            <p className="sb-tagging-pinfo__brand">{unit.brand} · {unit.option}</p>
            <dl>
              <dt>상세페이지 주요 문구</dt>
              <dd>{unit.copy}</dd>
              <dt>리뷰 요약</dt>
              <dd>{unit.review}</dd>
              <dt>가격</dt>
              <dd>{formatPrice(unit.price)}</dd>
              <dt>카탈로그 원본 태그</dt>
              <dd className="sb-tagging-pinfo__tags">
                {unit.catalogTags.map((tag) => <code key={tag}>{tag}</code>)}
              </dd>
              <dt>상품 ID</dt>
              <dd><code>{unit.id}</code></dd>
            </dl>
          </div>
        </aside>

        {/* ── 가운데: 필드별 태깅 편집 ── */}
        <main className="sb-tagging__center">
          <div className="sb-tagging-center-hd">
            <div>
              <h2>사람이 확인할 항목</h2>
              <p>이 상품에서 {currentReviewFields.length}개만 확인하면 돼요.</p>
            </div>
            <label className="sb-tagging-sw">
              <input
                type="checkbox"
                checked={onlyNeedsReview}
                onChange={(event) => setOnlyNeedsReview(event.target.checked)}
              />
              검수할 항목만 보기
            </label>
          </div>
          <div className="sb-tagging-review-focus">
            <span><b>{reviewStats.pending}</b>개 검수 대기</span>
            <i><b style={{ width: `${Math.round((reviewStats.locked / reviewStats.total) * 100)}%` }} /></i>
            <small>AI·담당자 확정 {reviewStats.locked}개는 잠김</small>
          </div>
          {FIELD_DEFS.map((def) => {
            const field = unit.fields[def.key]
            const needsReview = fieldNeedsReview(unit, def)
            if (onlyNeedsReview && !needsReview) return null
            const opts = optionsFor(def.key, unit.fields.category.selected[0])
            const status = UNIT_STATUS[field.status]
            const multi = def.max > 1
            const requested = !!unit.tagRequest[def.key]
            const unlocked = !!unlockedFields[fieldEditKey(unit.id, def.key)]
            const locked = field.status === 'done' && !unlocked
            return (
              <section
                key={def.key}
                className={
                  `sb-tagging-field sb-tagging-field--k-${def.key}` +
                  (field.status === 'unreviewed' ? ' sb-tagging-field--unreviewed' : '') +
                  (field.status === 'fix' ? ' sb-tagging-field--fix' : '') +
                  (locked ? ' sb-tagging-field--locked' : '')
                }
              >
                <div className="sb-tagging-field__hd">
                  <div className="sb-tagging-field__label">
                    {def.label}
                    {def.required && <em>필수</em>}
                    <span className="sb-tagging-field__count">
                      {def.min === def.max ? `${def.max}개` : `${def.min}~${def.max}개`}
                    </span>
                  </div>
                  <div className="sb-tagging-field__meta">
                    <span
                      className={`sb-tagging-conf sb-tagging-conf--${confLevel(field.confidence)}`}
                      title="AI 확신도"
                    >
                      <i style={{ width: `${field.confidence}%` }} />
                      <b>{field.confidence}%</b>
                    </span>
                    <span className={`sb-tagging-chip sb-tagging-chip--${status.cls}`}>{status.label}</span>
                    <span className={'sb-tagging-origin' + (field.origin === 'human' ? ' sb-tagging-origin--human' : '')}>
                      {field.origin === 'ai' ? 'AI' : '담당자'}
                    </span>
                    {field.status === 'done' && (
                      <button
                        type="button"
                        className={'sb-tagging-lock' + (unlocked ? ' is-open' : '')}
                        aria-pressed={unlocked}
                        title={unlocked ? '편집을 끝내고 다시 잠그기' : '잠금을 풀고 직접 편집하기'}
                        onClick={() => setFieldUnlocked(def.key, !unlocked)}
                      >
                        {unlocked ? '🔓 편집 중' : '🔒 고정됨'}
                      </button>
                    )}
                  </div>
                </div>
                {locked && (
                  <p className="sb-tagging-locked-note">
                    {field.origin === 'ai' ? 'AI 검수 완료 값이에요.' : '담당자가 확인해 확정한 값이에요.'} 수정하려면 오른쪽 자물쇠를 눌러주세요.
                  </p>
                )}
                <div className={'sb-tagging-opts' + (locked ? ' is-locked' : '')} aria-disabled={locked}>
                  {opts.length === 0 && (
                    <span className="sb-tagging-panel__dim">대분류를 먼저 선택하면 목록이 표시됩니다.</span>
                  )}
                  {opts.map((tag) => {
                    const on = field.selected.includes(tag)
                    const isRep = on && field.rep === tag
                    return (
                      <span key={tag} className={'sb-tagging-opt' + (on ? ' is-on' : '')}>
                        <button type="button" className="sb-tagging-opt__body" disabled={locked} onClick={() => toggleTag(def.key, tag)}>
                          {tag}
                        </button>
                        {on && multi && field.selected.length > 1 && (
                          <button
                            type="button"
                            className={'sb-tagging-opt__star' + (isRep ? ' is-rep' : '')}
                            title="대표 태그 지정"
                            disabled={locked}
                            onClick={() => setRep(def.key, tag)}
                          >
                            {isRep ? '★' : '☆'}
                          </button>
                        )}
                        {on && multi && field.selected.length === 1 && (
                          <span className="sb-tagging-opt__star is-rep is-auto" title="단일 선택 — 자동 대표">★</span>
                        )}
                      </span>
                    )
                  })}
                </div>
                <div className="sb-tagging-field__ft">
                  <button
                    type="button"
                    className="sb-tagging-why"
                    onClick={() => setOpenWhy((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                  >
                    {openWhy[def.key] ? '근거 접기 ▴' : '선택 근거 ▾'}
                  </button>
                  {field.status !== 'done' && (
                    <button type="button" className="sb-tagging-mini sb-tagging-mini--ok" onClick={() => markDone(def.key)}>
                      {field.status === 'fix' ? '수정 완료로 표시' : '확인 완료로 표시'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={'sb-tagging-mini' + (requested ? ' sb-tagging-mini--req' : '')}
                    disabled={locked}
                    onClick={() => toggleRequest(def.key)}
                  >
                    {requested ? '태그 추가 요청됨 ✓' : '태그 추가 요청'}
                  </button>
                  {(field.origin === 'human' || unlocked) && (
                    <button type="button" className="sb-tagging-mini sb-tagging-mini--restore" onClick={() => restoreAiField(def.key)}>
                      AI 원본으로 되돌리기
                    </button>
                  )}
                </div>
                {openWhy[def.key] && <p className="sb-tagging-rationale">{field.rationale}</p>}
              </section>
            )
          })}
          {onlyNeedsReview && currentReviewFields.length === 0 && (
            <div className="sb-tagging-review-empty">
              <b>✓ 이 상품은 더 확인할 항목이 없어요.</b>
              <span>완료 항목은 안전하게 잠겨 있습니다.</span>
              <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => setOnlyNeedsReview(false)}>잠긴 완료 항목 보기</button>
            </div>
          )}
        </main>

        {/* ── 우: 게이지 · 최종 태그 · 검증 · 승인/반려 ── */}
        <aside className="sb-tagging__side">
          <div className="sb-tagging-panel">
            <p className="sb-tagging-panel__hd">태그 게이지</p>
            <div className="sb-tagging-gauge">
              {Array.from({ length: TAG_LIMIT.max }).map((_, index) => (
                <span
                  key={index}
                  className={
                    'sb-tagging-gauge__cell' +
                    (index < Math.min(total, TAG_LIMIT.max) ? ' is-fill' : '') +
                    (total > TAG_LIMIT.max ? ' is-over' : '') +
                    (index === TAG_LIMIT.min - 1 ? ' is-min' : '')
                  }
                />
              ))}
              {total > TAG_LIMIT.max && <span className="sb-tagging-gauge__over">+{total - TAG_LIMIT.max}</span>}
            </div>
            <p className={'sb-tagging-gauge__txt' + (total > TAG_LIMIT.max || total < TAG_LIMIT.min ? ' is-bad' : '')}>
              총 {total}개 <span className="sb-tagging-panel__dim">/ 최소 {TAG_LIMIT.min} · 최대 {TAG_LIMIT.max}</span>
            </p>
          </div>

          <div className="sb-tagging-panel">
            <p className="sb-tagging-panel__hd">최종 적용 태그</p>
            <div className="sb-tagging-final">
              {finalTags.length === 0 && <span className="sb-tagging-panel__dim">선택된 태그가 없어요.</span>}
              {finalTags.map((entry) => (
                <span
                  key={`${entry.field}:${entry.tag}`}
                  className={`sb-tagging-ftag sb-tagging-ftag--k-${entry.key}` + (entry.rep ? ' is-rep' : '')}
                >
                  {entry.rep ? '★ ' : ''}{entry.tag}<i>{entry.field}</i>
                </span>
              ))}
            </div>
          </div>

          <div className="sb-tagging-panel">
            <p className="sb-tagging-panel__hd">검증 결과</p>
            {errs.length === 0 && warns.length === 0 && <p className="sb-tagging-vd sb-tagging-vd--ok">✓ 규칙 위반 없음</p>}
            {errs.map((message) => <p key={message} className="sb-tagging-vd sb-tagging-vd--err">✕ {message}</p>)}
            {warns.map((message) => <p key={message} className="sb-tagging-vd sb-tagging-vd--warn">⚠ {message}</p>)}
            {unreviewedFields.length > 0 && (
              <p className="sb-tagging-vd sb-tagging-vd--warn">
                ⚠ 미검토 항목: {unreviewedFields.map((d) => d.label).join(', ')}
              </p>
            )}
          </div>

          <div className="sb-tagging-panel">
            <p className="sb-tagging-panel__hd">검토 메모</p>
            <textarea
              className="sb-tagging-note"
              value={unit.note}
              rows={3}
              placeholder="예: ‘지속력’은 리뷰 근거가 약해 뺐어요"
              onChange={(event) => {
                const note = event.target.value
                patchUnit((u) => ({ ...u, note }))
              }}
            />
          </div>

          <div className="sb-tagging-actions">
            <button type="button" className="sb-btn sb-btn--primary" onClick={approve}>승인</button>
            <button type="button" className="sb-btn sb-btn--danger" onClick={reject}>반려</button>
          </div>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small sb-tagging-restore-unit" onClick={restoreCurrentUnit}>
            이 상품을 AI 원본으로 되돌리기
          </button>
          {unit.decision && (
            <p className={`sb-tagging-decision sb-tagging-decision--${unit.decision}`}>
              이 작업 단위는 {unit.decision === 'approved' ? '승인' : '반려'} 처리되었습니다. 항목을 수정하면 상태가
              초기화됩니다.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}
