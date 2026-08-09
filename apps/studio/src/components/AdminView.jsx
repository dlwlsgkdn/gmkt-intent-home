import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  archiveAdminThread,
  fetchAdminFeedback,
  fetchAdminModel,
  fetchAdminPrompts,
  fetchAdminThread,
  fetchAdminThreads,
  putAdminModel,
  putAdminPrompt,
} from '../lib/adminApi.js'
import { renderMarkdown, statusLabel, threadMarkdown } from '../lib/adminReport.jsx'
import { timeAgo } from '../lib/timeAgo.js'
import AdminFeedback from './AdminFeedback.jsx'
import AdminThreadPreview, { threadPreviewPages } from './AdminThreadPreview.jsx'
import PipelineStudio from './PipelineStudio.jsx'

/*
 * thread 관리 페이지 — 진입은 홈 드로어 도구 행의 버튼 또는 #admin 해시.
 * 별도 토큰 게이트 없음 (옛 x-admin-token 입력 검증은 뗐다 — adminApi.js 참고).
 * "삭제"는 보관(archived) 처리 — 데이터는 남고 사용자 목록에서만 숨겨진다.
 */

export default function AdminView({ api }) {
  const [tab, setTab] = useState('threads') // 'threads'(운영) | 'pipeline'(생성 파이프라인)
  const [threads, setThreads] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState(null)

  const [feedback, setFeedback] = useState(null) // AdminFeedbackWire { items, truncated }
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackError, setFeedbackError] = useState(null)

  const [model, setModel] = useState(null) // { current, defaultModel, configured, options }
  const [modelChoice, setModelChoice] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

  const [prompts, setPrompts] = useState(null) // AdminPromptsWire { promptVersion, prompts }
  const [promptsError, setPromptsError] = useState(null)
  const [promptEdit, setPromptEdit] = useState(null) // AdminPromptEntry (편집 다이얼로그)
  const [promptText, setPromptText] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)

  const [detail, setDetail] = useState(null) // ThreadWithSteps
  const [detailView, setDetailView] = useState('doc') // 'doc' | 'survey' | 'plan'
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null) // thread row
  const [archiving, setArchiving] = useState(false)

  const handleError = useCallback((e, fallback) => {
    api.showToast(e.message || fallback)
  }, [api])

  const loadList = useCallback(async (cursor) => {
    setListLoading(true)
    setListError(null)
    try {
      const page = await fetchAdminThreads(cursor)
      setThreads((prev) => (cursor ? [...prev, ...page.items] : page.items))
      setNextCursor(page.nextCursor)
    } catch (e) {
      setListError(e.message)
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true)
    setFeedbackError(null)
    try {
      setFeedback(await fetchAdminFeedback())
    } catch (e) {
      setFeedbackError(e.message)
    } finally {
      setFeedbackLoading(false)
    }
  }, [])

  const loadModel = useCallback(async () => {
    try {
      const wire = await fetchAdminModel()
      setModel(wire)
      setModelChoice(wire.configured ?? '')
    } catch (e) {
      api.showToast(`모델 설정을 불러오지 못했어요: ${e.message}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPrompts = useCallback(async () => {
    setPromptsError(null)
    try {
      setPrompts(await fetchAdminPrompts())
    } catch (e) {
      setPromptsError(e.message)
    }
  }, [])

  useEffect(() => {
    loadList()
    loadFeedback()
    loadModel()
    loadPrompts()
  }, [loadList, loadFeedback, loadModel, loadPrompts])

  const openDetail = async (threadId) => {
    setDetailLoading(true)
    setDetailView('doc')
    try {
      setDetail(await fetchAdminThread(threadId))
    } catch (e) {
      handleError(e, '쓰레드를 불러오지 못했어요.')
    } finally {
      setDetailLoading(false)
    }
  }

  const applyModel = async () => {
    setModelSaving(true)
    try {
      const wire = await putAdminModel(modelChoice || null)
      setModel(wire)
      setModelChoice(wire.configured ?? '')
      api.showToast(`생성 모델: ${wire.current}${wire.configured ? '' : ' (기본값)'} — 새 생성부터 반영돼요.`)
    } catch (e) {
      handleError(e, '모델을 변경하지 못했어요.')
    } finally {
      setModelSaving(false)
    }
  }

  const openPromptEdit = (entry) => {
    setPromptEdit(entry)
    setPromptText(entry.configured ?? entry.defaultText)
  }

  const savePrompt = async (textOrNull) => {
    if (!promptEdit) return
    setPromptSaving(true)
    try {
      const wire = await putAdminPrompt(promptEdit.id, textOrNull)
      setPrompts(wire)
      const updated = wire.prompts.find((p) => p.id === promptEdit.id)
      api.showToast(
        updated?.configured
          ? `「${promptEdit.label}」 프롬프트를 재정의했어요 — 새 생성부터 반영돼요.`
          : `「${promptEdit.label}」 프롬프트를 기본값으로 되돌렸어요.`,
      )
      setPromptEdit(null)
    } catch (e) {
      handleError(e, '프롬프트를 저장하지 못했어요.')
    } finally {
      setPromptSaving(false)
    }
  }

  const doArchive = async () => {
    if (!confirmArchive) return
    setArchiving(true)
    try {
      const updated = await archiveAdminThread(confirmArchive.id)
      setThreads((prev) => prev.map((t) => (t.id === updated.id ? { ...t, status: updated.status } : t)))
      if (detail && detail.id === updated.id) setDetail({ ...detail, status: updated.status })
      api.showToast('보관 처리했어요. 사용자 목록에서 숨겨져요.')
      setConfirmArchive(null)
    } catch (e) {
      handleError(e, '보관 처리하지 못했어요.')
    } finally {
      setArchiving(false)
    }
  }

  const copyMarkdown = async () => {
    if (!detail) return
    try {
      await navigator.clipboard.writeText(threadMarkdown(detail))
      api.showToast('마크다운 문서를 복사했어요.')
    } catch {
      api.showToast('클립보드 복사에 실패했어요.')
    }
  }

  const markdown = useMemo(() => (detail ? threadMarkdown(detail) : ''), [detail])
  const dirty = model && (model.configured ?? '') !== modelChoice

  return (
    <section className="sb-admin">
      <header className="sb-admin__head">
        <div>
          <h1>thread 관리</h1>
          <p className="sb-admin__sub">core DB의 라이브 쓰레드 전체 — 보관 처리한 쓰레드는 사용자 목록에서 숨겨져요.</p>
        </div>
        <div className="sb-admin__head-actions">
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--small"
            onClick={() => {
              loadList()
              loadFeedback()
              loadPrompts()
            }}
          >
            새로고침
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={api.exitAdmin}>홈으로</button>
        </div>
      </header>

      {/* 탭 — 운영(쓰레드·평가) / 파이프라인(단계·프롬프트·지식·플레이그라운드) */}
      <div className="sb-admin-tabs" role="tablist" aria-label="관리 영역">
        {[
          ['threads', '쓰레드·평가'],
          ['pipeline', '파이프라인'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={'sb-admin-tabs__btn' + (tab === value ? ' is-on' : '')}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 파이프라인 탭 — 모델·프롬프트·단계·지식·플레이그라운드 */}
      {tab === 'pipeline' && (
      <>
      {/* LLM 모델 설정 */}
      <div className="sb-admin-card">
        <p className="sb-panel-label">생성 모델</p>
        {!model ? (
          <p className="sb-admin__muted">모델 설정을 불러오는 중…</p>
        ) : (
          <>
            <div className="sb-admin-model">
              <select value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
                <option value="">기본값 사용 — {model.defaultModel}</option>
                {model.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({option.id})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sb-btn sb-btn--primary sb-btn--small"
                disabled={!dirty || modelSaving}
                onClick={applyModel}
              >
                {modelSaving ? '적용 중…' : '적용'}
              </button>
              <span className="sb-admin-model__current">
                현재: <b>{model.current}</b>{model.configured ? '' : ' (기본값)'}
              </span>
            </div>
            <ul className="sb-admin-model__notes">
              {model.options.map((option) => (
                <li key={option.id}>
                  <b>{option.label}</b>{option.note ? ` — ${option.note}` : ''}
                </li>
              ))}
            </ul>
            <p className="sb-admin__muted">변경은 core 설정(llm-model)에 저장되고 새 생성부터 반영돼요 (서버 캐시 최대 30초).</p>
          </>
        )}
      </div>

      {/* LLM 시스템 프롬프트 — 단계별 기본값·재정의 관리 */}
      <div className="sb-admin-card">
        <p className="sb-panel-label">
          시스템 프롬프트{prompts ? ` (기본 ${prompts.promptVersion})` : ''}
        </p>
        {promptsError && <p className="sb-admin-gate__error">{promptsError}</p>}
        {!prompts && !promptsError && <p className="sb-admin__muted">프롬프트를 불러오는 중…</p>}
        {prompts && (
          <>
            <ul className="sb-admin-prompts">
              {prompts.prompts.map((entry) => {
                const effective = entry.configured ?? entry.defaultText
                return (
                  <li key={entry.id} className="sb-admin-prompts__row">
                    <div className="sb-admin-prompts__main">
                      <div className="sb-admin-prompts__title">
                        <b>{entry.label}</b>
                        <code>{entry.id}</code>
                        {entry.configured ? (
                          <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의 사용 중</span>
                        ) : (
                          <span className="sb-admin-prompt-chip">기본값</span>
                        )}
                      </div>
                      <p className="sb-admin-prompts__note">{entry.note}</p>
                      <p className="sb-admin-prompts__preview">{effective.split('\n')[0]}</p>
                    </div>
                    <div className="sb-admin-prompts__actions">
                      <span className="sb-admin__muted">{effective.length.toLocaleString('ko-KR')}자</span>
                      <button
                        type="button"
                        className="sb-btn sb-btn--ghost sb-btn--tiny"
                        onClick={() => openPromptEdit(entry)}
                      >
                        열람·수정
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="sb-admin__muted">
              재정의는 core 설정(llm-prompt-*)에 저장되고 새 생성부터 반영돼요 (서버 캐시 최대 30초).
              재정의로 생성된 스텝은 llmMeta.promptVersion에 +custom이 붙어요.
            </p>
          </>
        )}
      </div>

      {/* 단계 카탈로그·지식 KV·엔진·플레이그라운드 */}
      <PipelineStudio prompts={prompts} onOpenPrompt={openPromptEdit} />
      </>
      )}

      {tab === 'threads' && (
      <>
      {/* 평가 모아보기 — 피드백 제출 대시보드 */}
      <AdminFeedback wire={feedback} loading={feedbackLoading} error={feedbackError} onOpenThread={openDetail} />

      {/* 쓰레드 목록 */}
      <div className="sb-admin-card">
        <p className="sb-panel-label">쓰레드 목록 {threads.length > 0 ? `(${threads.length}개 로드됨)` : ''}</p>
        {listError && <p className="sb-admin-gate__error">{listError}</p>}
        <div className="sb-table sb-admin-table">
          <div className="sb-table__scroll">
            <table>
              <thead>
                <tr>
                  <th>threadId</th>
                  <th>제목 / 진입</th>
                  <th>상태</th>
                  <th>사용자</th>
                  <th>갱신</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => (
                  <tr key={t.id} className={t.status === 'archived' ? 'sb-admin-row--archived' : undefined}>
                    <td><code>{t.id}</code></td>
                    <td className="sb-admin-table__title">{t.title || (t.source && t.source.query) || '—'}</td>
                    <td>
                      <span className={`sb-admin-status sb-admin-status--${t.status}`}>{statusLabel(t.status)}</span>
                    </td>
                    <td><code>{t.userId}</code></td>
                    <td title={t.updatedAt}>{timeAgo(t.updatedAt, { empty: '—' })}</td>
                    <td className="sb-admin-table__actions">
                      <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => openDetail(t.id)}>
                        열람
                      </button>
                      {t.status !== 'archived' && (
                        <button
                          type="button"
                          className="sb-btn sb-btn--danger sb-btn--tiny"
                          onClick={() => setConfirmArchive(t)}
                        >
                          보관
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {threads.length === 0 && !listLoading && (
              <p className="sb-table__empty">쓰레드가 없어요. 홈에서 라이브 생성 체험을 하면 여기에 쌓여요.</p>
            )}
          </div>
        </div>
        <div className="sb-admin__list-foot">
          {listLoading && <span className="sb-admin__muted">불러오는 중…</span>}
          {!listLoading && nextCursor && (
            <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => loadList(nextCursor)}>
              더 보기
            </button>
          )}
        </div>
      </div>
      </>
      )}

      {/* 쓰레드 상세 — 마크다운 문서 */}
      {(detail || detailLoading) && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetail(null)
          }}
        >
          <section className="sb-llm-dialog sb-admin-dialog" role="dialog" aria-modal="true" aria-label="쓰레드 상세">
            <div className="sb-admin-dialog__head">
              <h2>{detailLoading ? '불러오는 중…' : `쓰레드 ${detail.id}`}</h2>
              <div className="sb-admin-dialog__actions">
                {detail && (
                  <>
                    <div className="sb-admin-fb-seg" role="group" aria-label="상세 보기 방식">
                      {[
                        ['doc', '문서', true],
                        ['survey', '설문 화면', !!threadPreviewPages(detail).survey],
                        ['plan', '계획 화면', !!threadPreviewPages(detail).plan],
                      ].map(([value, label, enabled]) => (
                        <button
                          key={value}
                          type="button"
                          className={'sb-admin-fb-seg__btn' + (detailView === value ? ' is-on' : '')}
                          disabled={!enabled}
                          title={enabled ? undefined : '이 쓰레드에는 해당 페이지가 기록되지 않았어요'}
                          onClick={() => setDetailView(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={copyMarkdown}>
                      마크다운 복사
                    </button>
                    {detail.status !== 'archived' && (
                      <button
                        type="button"
                        className="sb-btn sb-btn--danger sb-btn--small"
                        onClick={() => setConfirmArchive(detail)}
                      >
                        보관 처리
                      </button>
                    )}
                  </>
                )}
                <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setDetail(null)}>×</button>
              </div>
            </div>
            {detail && detailView === 'doc' && <div className="sb-admin-doc">{renderMarkdown(markdown)}</div>}
            {detail && detailView !== 'doc' && <AdminThreadPreview thread={detail} stage={detailView} />}
          </section>
        </div>
      )}

      {/* 시스템 프롬프트 열람·수정 */}
      {promptEdit && (() => {
        const isDefaultText = promptText === promptEdit.defaultText
        const saved = promptEdit.configured ?? promptEdit.defaultText
        const dirtyPrompt = promptText !== saved
        const missingCatalog = promptEdit.id === 'plan-products' && !promptText.includes('{{CATALOG}}')
        return (
          <div
            className="sb-llm-modal"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !promptSaving) setPromptEdit(null)
            }}
          >
            <section
              className="sb-llm-dialog sb-admin-dialog sb-admin-prompt-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="시스템 프롬프트 열람·수정"
            >
              <div className="sb-admin-dialog__head">
                <h2>시스템 프롬프트 — {promptEdit.label}</h2>
                <div className="sb-admin-dialog__actions">
                  <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setPromptEdit(null)}>×</button>
                </div>
              </div>
              <div className="sb-admin-prompt-dialog__body">
                <p className="sb-admin__muted">{promptEdit.note}</p>
                <textarea
                  className="sb-admin-prompt-dialog__editor"
                  value={promptText}
                  spellCheck={false}
                  onChange={(event) => setPromptText(event.target.value)}
                />
                <div className="sb-admin-prompt-dialog__meta">
                  <span className="sb-admin__muted">{promptText.length.toLocaleString('ko-KR')}자</span>
                  {isDefaultText && <span className="sb-admin-prompt-chip">기본값과 동일 — 저장하면 기본값 추종으로 돌아가요</span>}
                  {!isDefaultText && promptEdit.configured && !dirtyPrompt && (
                    <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의 사용 중</span>
                  )}
                  {missingCatalog && (
                    <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">
                      {'{{CATALOG}}'} 자리표시자가 없어요 — 상품 카탈로그 목록이 프롬프트에서 빠져요
                    </span>
                  )}
                </div>
                <div className="sb-json-dialog__actions">
                  {promptEdit.configured && (
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost"
                      disabled={promptSaving}
                      onClick={() => savePrompt(null)}
                    >
                      기본값으로 되돌리기
                    </button>
                  )}
                  {!isDefaultText && !promptEdit.configured && (
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost"
                      disabled={promptSaving}
                      onClick={() => setPromptText(promptEdit.defaultText)}
                    >
                      기본값 원문으로 채우기
                    </button>
                  )}
                  <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPromptEdit(null)}>취소</button>
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={!dirtyPrompt || promptSaving || !promptText.trim()}
                    onClick={() => savePrompt(promptText)}
                  >
                    {promptSaving ? '저장 중…' : '저장'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )
      })()}

      {/* 보관 확인 */}
      {confirmArchive && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmArchive(null)
          }}
        >
          <section className="sb-llm-dialog sb-json-dialog" role="dialog" aria-modal="true" aria-label="보관 확인">
            <div className="sb-json-dialog__body">
              <div className="sb-json-dialog__head">
                <h2 className="sb-json-dialog__title">쓰레드 보관</h2>
                <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setConfirmArchive(null)}>×</button>
              </div>
              <p className="sb-json-dialog__note">
                「{confirmArchive.title || confirmArchive.id}」를 보관할까요?
              </p>
              <p className="sb-json-dialog__note sb-json-dialog__note--danger">
                사용자의 쓰레드 목록에서 숨겨져요. 데이터는 DB에 남지만 관리 페이지에서 되돌리는 기능은 없어요.
              </p>
              <div className="sb-json-dialog__actions">
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setConfirmArchive(null)}>취소</button>
                <button type="button" className="sb-btn sb-btn--danger" disabled={archiving} onClick={doArchive}>
                  {archiving ? '처리 중…' : '보관 처리'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
