import React, { useEffect, useMemo, useState } from 'react'
import {
  PROPAGATION_BATCH_SIZE,
  buildPropagationPrompt,
  buildPropagationRequest,
  chunkTargets,
  collectPropagationSeeds,
  propagationTargets,
  validatePropagationResponse,
} from '../../lib/prompt/propagation.js'
import { wrapForChatApp } from '../../lib/prompt/chatPrompt.js'
import { LIBRARY } from '../../lib/registry.jsx'
import PromptExchange from './PromptExchange.jsx'
import AiRoundTripNote from './AiRoundTripNote.jsx'

/*
 * 평가 피드백 전체 반영 다이얼로그.
 *
 * 평가한 케이스들(로테이션으로 누적)에 남긴 피드백을 씨앗으로, 미평가 케이스들의
 * 같은 자리를 배치로 나눠 고친다. 씨앗은 리더보드(평균 별점) 순이며 상위 N개
 * 케이스로 제한할 수 있다. 수정안은 필드 단위(허용 목록 + before 대조)라 개별
 * 선택 적용이 가능하고, 적용은 문구 다듬기와 같은 경로(applyRevisions)를 탄다.
 */
const SEED_LIMIT_OPTIONS = [3, 5, 10]

export default function PropagationDialog({ scenario, planCases, onApply, onClose, onToast }) {
  const [seedCaseLimit, setSeedCaseLimit] = useState(null) // null = 리더보드 전체
  const allSeeds = useMemo(
    () => collectPropagationSeeds(planCases, { caseLimit: seedCaseLimit }),
    [planCases, seedCaseLimit]
  )
  const [pickedSeedIds, setPickedSeedIds] = useState(() => new Set(allSeeds.componentSeeds.map((seed) => seed.id)))
  const [includeCaseNotes, setIncludeCaseNotes] = useState(true)
  const evaluatedCount = allSeeds.leaderboard.length
  const seedCaseCount = seedCaseLimit ? Math.min(seedCaseLimit, evaluatedCount) : evaluatedCount

  /* 씨앗 케이스 범위가 바뀌면 개별 선택은 새 범위 전체로 초기화한다 */
  useEffect(() => {
    setPickedSeedIds(new Set(allSeeds.componentSeeds.map((seed) => seed.id)))
  }, [seedCaseLimit]) // eslint-disable-line react-hooks/exhaustive-deps

  const [phase, setPhase] = useState('setup') // setup | exchange | review
  const [batches, setBatches] = useState([])
  const [batchIndex, setBatchIndex] = useState(0)
  const [answerText, setAnswerText] = useState('')
  const [collected, setCollected] = useState([]) // 배치를 넘나드는 누적 수정안
  const [runErrors, setRunErrors] = useState([])
  const [runWarnings, setRunWarnings] = useState([])
  const [selectedKeys, setSelectedKeys] = useState(new Set())

  const seeds = useMemo(() => ({
    componentSeeds: allSeeds.componentSeeds.filter((seed) => pickedSeedIds.has(seed.id)),
    caseNotes: includeCaseNotes ? allSeeds.caseNotes : [],
    evaluatedCaseIds: allSeeds.evaluatedCaseIds,
  }), [allSeeds, pickedSeedIds, includeCaseNotes])

  const targets = useMemo(() => propagationTargets(planCases, seeds), [planCases, seeds])
  const seedCount = seeds.componentSeeds.length + seeds.caseNotes.length

  const toggleSeed = (id) => {
    setPickedSeedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const start = () => {
    setBatches(chunkTargets(targets))
    setBatchIndex(0)
    setAnswerText('')
    setCollected([])
    setRunErrors([])
    setRunWarnings([])
    setSelectedKeys(new Set())
    setPhase('exchange')
  }

  const activeBatch = batches[batchIndex] || []
  const batchRequest = useMemo(
    () => buildPropagationRequest({ scenario, seeds, targets: activeBatch }),
    [scenario, seeds, activeBatch]
  )
  const batchPrompt = useMemo(
    () => (activeBatch.length > 0
      ? wrapForChatApp(buildPropagationPrompt(batchRequest), { json: true, pasteTarget: '결과 가져오기' })
      : ''),
    [batchRequest, activeBatch]
  )

  const keyOf = (revision) => [revision.caseId, revision.itemId, revision.fieldKey].join(':')

  const submitAnswer = () => {
    setRunErrors([])
    const validation = validatePropagationResponse(answerText, batchRequest)
    if (validation.revisions.length === 0 && validation.errors.length > 0) {
      setRunErrors(validation.errors)
      onToast(`응답 검증 실패: ${validation.errors[0]}`)
      return
    }
    setRunWarnings((current) => [...current, ...validation.warnings])
    if (validation.errors.length > 0) setRunErrors(validation.errors)
    setCollected((current) => [...current, ...validation.revisions])
    setSelectedKeys((current) => {
      const next = new Set(current)
      validation.revisions.forEach((revision) => next.add(keyOf(revision)))
      return next
    })
    setAnswerText('')
    if (batchIndex + 1 >= batches.length) setPhase('review')
    else setBatchIndex(batchIndex + 1)
  }

  const applySelected = () => {
    const chosen = collected.filter((revision) => selectedKeys.has(keyOf(revision)))
    if (chosen.length === 0) return
    onApply(chosen)
    onClose()
  }

  /* 검토 화면: 케이스별로 묶어 보여준다 */
  const grouped = useMemo(() => {
    const map = new Map()
    collected.forEach((revision) => {
      const list = map.get(revision.caseId) || { caseName: revision.caseName, revisions: [] }
      list.revisions.push(revision)
      map.set(revision.caseId, list)
    })
    return [...map.values()]
  }, [collected])

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="sb-llm-dialog sb-gen-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-prop-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">평가 피드백 → 프롬프트 → 내 AI → 전체 케이스</p>
            <h2 id="sb-prop-title">피드백 전체 반영</h2>
            <p>
              평가한 케이스 <b>{evaluatedCount}개</b>에 남긴 피드백을 패턴 삼아,
              아직 평가하지 않은 <b>{targets.length}개 케이스</b>의 같은 자리에서 같은 문제를 찾아 고칩니다.
            </p>
            <AiRoundTripNote>
              대상이 많아 <b>{Math.max(1, chunkTargets(targets).length)}개 배치</b>로 나눠 왕복해요.
              수정안은 필드 단위로 검증되고, 하나씩 골라 적용할 수 있어요(⌘Z 가능).
            </AiRoundTripNote>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <ol className="sb-steps" aria-label="진행 단계">
          <li className={'sb-steps__item' + (phase === 'setup' ? ' is-active' : ' is-done')}>씨앗 확인</li>
          <li className="sb-steps__sep" aria-hidden="true">›</li>
          <li className={'sb-steps__item' + (phase === 'exchange' ? ' is-active' : phase === 'review' ? ' is-done' : '')}>프롬프트 왕복</li>
          <li className="sb-steps__sep" aria-hidden="true">›</li>
          <li className={'sb-steps__item' + (phase === 'review' ? ' is-active' : '')}>검토 · 적용</li>
        </ol>

        {phase === 'setup' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>패턴이 될 피드백</span>
                  <strong>씨앗 케이스 {seedCaseCount}개 · 피드백 {allSeeds.componentSeeds.length + allSeeds.caseNotes.length}개</strong>
                </div>
                <span>{seedCount}개 선택됨</span>
              </div>
              <label className="sb-prop-seedlimit">
                씨앗 범위
                <select
                  value={seedCaseLimit ?? 'all'}
                  onChange={(event) => setSeedCaseLimit(
                    event.target.value === 'all' ? null : Number(event.target.value)
                  )}
                >
                  {/* 평가 수보다 큰 제한은 전체와 같으므로 비활성 — 숨기면 기능이 없어진 걸로 오해된다 */}
                  {SEED_LIMIT_OPTIONS.map((limit) => (
                    <option key={limit} value={limit} disabled={limit >= evaluatedCount}>
                      리더보드 상위 {limit}개 케이스
                    </option>
                  ))}
                  <option value="all">평가한 케이스 전체 ({evaluatedCount}개)</option>
                </select>
                <small>
                  {evaluatedCount > SEED_LIMIT_OPTIONS[0]
                    ? '평균 별점이 높은 케이스의 피드백부터 씨앗이 돼요.'
                    : `평가한 케이스가 ${SEED_LIMIT_OPTIONS[0] + 1}개 이상 쌓이면 상위 N개로 제한할 수 있어요.`}
                </small>
              </label>
              <ul className="sb-crev-feedback">
                {allSeeds.caseNotes.length > 0 && (
                  <li className="sb-crev-feedback__case">
                    <input
                      type="checkbox"
                      checked={includeCaseNotes}
                      onChange={(event) => setIncludeCaseNotes(event.target.checked)}
                    />
                    <b>케이스 전체 코멘트 {allSeeds.caseNotes.length}개</b>
                    <span>{allSeeds.caseNotes.map((note) => note.feedback).join(' / ').slice(0, 80)}</span>
                  </li>
                )}
                {allSeeds.componentSeeds.map((seed) => (
                  <li key={seed.id}>
                    <input
                      type="checkbox"
                      checked={pickedSeedIds.has(seed.id)}
                      onChange={() => toggleSeed(seed.id)}
                    />
                    <b>
                      {seed.slot ? `CASE ${seed.slot}` : `${seed.rank}위 ${seed.caseName}`}
                      {' · '}{LIBRARY[seed.type]?.label || seed.type}
                    </b>
                    <span>{seed.feedback}</span>
                    {seed.score != null && <em>{seed.score}점</em>}
                  </li>
                ))}
              </ul>
              {allSeeds.componentSeeds.length === 0 && allSeeds.caseNotes.length === 0 && (
                <p className="sb-llm-help">평가한 케이스에 피드백이 없어요. 평가 탭에서 말풍선에 피드백을 먼저 남겨주세요.</p>
              )}
              <p className="sb-llm-help">
                씨앗 케이스의 현재 문구가 <b>모범 예시</b>로 함께 전달돼요 — 말풍선에서 <b>반영 완료(✓)</b>로
                표시해 두면 검증된 예시로, 아니면 참고용으로 구분돼 전달됩니다.
              </p>
            </section>

            <div className="sb-llm-dialog__foot">
              <p>대상: 평가한 케이스를 제외한 {targets.length}개 · 씨앗과 같은 타입의 컴포넌트 필드만.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={seedCount === 0 || targets.length === 0}
                  onClick={start}
                >
                  프롬프트 만들기
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'exchange' && (
          <>
            <div className="sb-batch-bar">
              <div>
                <strong>배치 {batchIndex + 1} / {batches.length}</strong>
                <small>{activeBatch.map((target) => target.name).join(' · ')}</small>
              </div>
              <div className="sb-batch-bar__meter" aria-hidden="true">
                <i style={{ width: `${batches.length > 0 ? Math.round((batchIndex / batches.length) * 100) : 0}%` }} />
              </div>
              <span>수정안 {collected.length}개 수집</span>
            </div>

            <PromptExchange
              title="이 배치의 전파 프롬프트"
              hint="피드백 패턴·모범 예시와 이 배치 케이스들의 실제 필드 값이 들어가요. 검증에 성공하면 다음 배치로 넘어갑니다."
              prompt={batchPrompt}
              onCopied={(ok) => onToast(ok
                ? `배치 ${batchIndex + 1}/${batches.length} 프롬프트를 복사했어요.`
                : '복사하지 못했어요. 프롬프트를 펼쳐 직접 복사해주세요.')}
              answerText={answerText}
              answerPlaceholder={'AI가 반환한 {"summary":"...","revisions":[...]} JSON을 붙여넣으세요.'}
              onAnswerChange={setAnswerText}
              rows={8}
            />

            {runErrors.map((error, index) => <p key={index} className="sb-llm-error">{error}</p>)}

            <div className="sb-llm-dialog__foot">
              <p>중간에 그만둬도 이미 검증된 수정안은 검토·적용할 수 있어요.</p>
              <div>
                <button
                  type="button"
                  className="sb-btn sb-btn--ghost"
                  disabled={collected.length === 0}
                  onClick={() => setPhase('review')}
                >
                  여기까지만 검토
                </button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={!answerText.trim()}
                  onClick={submitAnswer}
                >
                  {batchIndex + 1 >= batches.length ? '응답 검증 · 검토로' : '응답 검증 · 다음 배치'}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'review' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>검토 · 적용</span>
                  <strong>케이스 {grouped.length}개에 수정안 {collected.length}개</strong>
                </div>
                <span>{selectedKeys.size}/{collected.length}개 선택</span>
              </div>
              {runWarnings.slice(0, 6).map((warning, index) => (
                <p key={index} className="sb-llm-warning">{warning}</p>
              ))}
              <div className="sb-llm-revisions sb-gen-results">
                {grouped.map((group) => (
                  <div key={group.caseName} className="sb-prop-group">
                    <p className="sb-prop-group__name">{group.caseName}</p>
                    {group.revisions.map((revision) => {
                      const key = keyOf(revision)
                      return (
                        <label key={key} className="sb-llm-revision">
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(key)}
                            onChange={() => setSelectedKeys((current) => {
                              const next = new Set(current)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })}
                          />
                          <div>
                            <strong>{LIBRARY[revision.itemType]?.label || revision.itemType} · {revision.fieldKey}</strong>
                            <p><del>{revision.before || '(비어 있음)'}</del></p>
                            <p><ins>{revision.after}</ins></p>
                            {revision.reason && <em>{revision.reason}</em>}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                ))}
                {collected.length === 0 && (
                  <div className="sb-llm-empty">
                    <strong>수집된 수정안이 없습니다.</strong>
                    <p>같은 문제가 없는 케이스는 건너뛰는 게 정상이에요.</p>
                  </div>
                )}
              </div>
            </section>
            <div className="sb-llm-dialog__foot">
              <p>적용은 필드 단위이고 ⌘Z로 되돌릴 수 있어요.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('setup')}>씨앗으로</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={selectedKeys.size === 0}
                  onClick={applySelected}
                >
                  선택한 {selectedKeys.size}개 적용
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
