import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AdminApiError,
  archiveAdminThread,
  fetchAdminFeedback,
  fetchAdminModel,
  fetchAdminThread,
  fetchAdminThreads,
  getAdminToken,
  putAdminModel,
  setAdminToken,
} from '../lib/adminApi.js'
import { renderMarkdown, statusLabel, threadMarkdown } from '../lib/adminReport.jsx'
import { timeAgo } from '../lib/timeAgo.js'
import AdminFeedback from './AdminFeedback.jsx'
import AdminThreadPreview, { threadPreviewPages } from './AdminThreadPreview.jsx'

/*
 * thread 관리 페이지 — #admin 해시로만 진입한다 (홈·플레이어 어디에도 링크 없음).
 * 관리 토큰(ADMIN_TOKEN)을 입력해야 API가 응답하고, 입력한 토큰은 localStorage에
 * 보관해 반복 입력을 없앤다. 401이 오면 보관 토큰을 지우고 게이트로 돌아간다.
 * "삭제"는 보관(archived) 처리 — 데이터는 남고 사용자 목록에서만 숨겨진다.
 */

export default function AdminView({ api }) {
  const [token, setToken] = useState(getAdminToken)
  const [tokenInput, setTokenInput] = useState('')
  const [gateError, setGateError] = useState(null)

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

  const [detail, setDetail] = useState(null) // ThreadWithSteps
  const [detailView, setDetailView] = useState('doc') // 'doc' | 'survey' | 'plan'
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null) // thread row
  const [archiving, setArchiving] = useState(false)

  /* 401 공통 처리 — 보관 토큰 폐기 후 게이트로 */
  const handleError = useCallback((e, fallback) => {
    if (e instanceof AdminApiError && e.unauthorized) {
      setAdminToken('')
      setToken('')
      setGateError('토큰이 거부됐어요. 다시 입력해주세요.')
      return
    }
    api.showToast(e.message || fallback)
  }, [api])

  const loadList = useCallback(async (activeToken, cursor) => {
    setListLoading(true)
    setListError(null)
    try {
      const page = await fetchAdminThreads(activeToken, cursor)
      setThreads((prev) => (cursor ? [...prev, ...page.items] : page.items))
      setNextCursor(page.nextCursor)
    } catch (e) {
      if (e instanceof AdminApiError && e.unauthorized) {
        setAdminToken('')
        setToken('')
        setGateError('토큰이 거부됐어요. 다시 입력해주세요.')
      } else {
        setListError(e.message)
      }
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadFeedback = useCallback(async (activeToken) => {
    setFeedbackLoading(true)
    setFeedbackError(null)
    try {
      setFeedback(await fetchAdminFeedback(activeToken))
    } catch (e) {
      if (e instanceof AdminApiError && e.unauthorized) return // loadList가 게이트 처리
      setFeedbackError(e.message)
    } finally {
      setFeedbackLoading(false)
    }
  }, [])

  const loadModel = useCallback(async (activeToken) => {
    try {
      const wire = await fetchAdminModel(activeToken)
      setModel(wire)
      setModelChoice(wire.configured ?? '')
    } catch (e) {
      if (e instanceof AdminApiError && e.unauthorized) return // loadList가 게이트 처리
      api.showToast(`모델 설정을 불러오지 못했어요: ${e.message}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!token) return
    loadList(token)
    loadFeedback(token)
    loadModel(token)
  }, [token, loadList, loadFeedback, loadModel])

  const submitToken = (event) => {
    event.preventDefault()
    const value = tokenInput.trim()
    if (!value) return
    setAdminToken(value)
    setToken(value)
    setTokenInput('')
    setGateError(null)
  }

  const lockOut = () => {
    setAdminToken('')
    setToken('')
    setThreads([])
    setDetail(null)
    setModel(null)
    setFeedback(null)
    api.showToast('보관된 관리 토큰을 지웠어요.')
  }

  const openDetail = async (threadId) => {
    setDetailLoading(true)
    setDetailView('doc')
    try {
      setDetail(await fetchAdminThread(token, threadId))
    } catch (e) {
      handleError(e, '쓰레드를 불러오지 못했어요.')
    } finally {
      setDetailLoading(false)
    }
  }

  const applyModel = async () => {
    setModelSaving(true)
    try {
      const wire = await putAdminModel(token, modelChoice || null)
      setModel(wire)
      setModelChoice(wire.configured ?? '')
      api.showToast(`생성 모델: ${wire.current}${wire.configured ? '' : ' (기본값)'} — 새 생성부터 반영돼요.`)
    } catch (e) {
      handleError(e, '모델을 변경하지 못했어요.')
    } finally {
      setModelSaving(false)
    }
  }

  const doArchive = async () => {
    if (!confirmArchive) return
    setArchiving(true)
    try {
      const updated = await archiveAdminThread(token, confirmArchive.id)
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

  /* ── 토큰 게이트 ── */
  if (!token) {
    return (
      <section className="sb-admin sb-admin--gate">
        <form className="sb-admin-gate" onSubmit={submitToken}>
          <h1>thread 관리</h1>
          <p>관리 토큰(ADMIN_TOKEN)을 입력해야 접근할 수 있어요. 한 번 입력하면 이 브라우저에 저장돼요.</p>
          <input
            type="password"
            autoFocus
            placeholder="관리 토큰"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          {gateError && <p className="sb-admin-gate__error">{gateError}</p>}
          <div className="sb-admin-gate__actions">
            <button type="button" className="sb-btn sb-btn--ghost" onClick={api.exitAdmin}>홈으로</button>
            <button type="submit" className="sb-btn sb-btn--primary" disabled={!tokenInput.trim()}>입장</button>
          </div>
        </form>
      </section>
    )
  }

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
              loadList(token)
              loadFeedback(token)
            }}
          >
            새로고침
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={lockOut} title="보관된 관리 토큰을 지우고 잠급니다">
            토큰 지우기
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={api.exitAdmin}>홈으로</button>
        </div>
      </header>

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
            <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => loadList(token, nextCursor)}>
              더 보기
            </button>
          )}
        </div>
      </div>

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
