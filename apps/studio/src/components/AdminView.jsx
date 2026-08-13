import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  archiveAdminThread,
  fetchAdminFeedback,
  fetchAdminThread,
  fetchAdminThreads,
} from '../lib/adminApi.js'
import { renderMarkdown, statusLabel, threadMarkdown } from '../lib/adminReport.jsx'
import { timeAgo } from '../lib/timeAgo.js'
import AdminFeedback from './AdminFeedback.jsx'
import AdminThreadPreview, { threadPreviewPages } from './AdminThreadPreview.jsx'
import PipelineStudio from './PipelineStudio.jsx'
import ExperimentStudio from './ExperimentStudio.jsx'
import { promoteEvalCase } from '../lib/adminApi.js'
import AdminDashboard from './AdminDashboard.jsx'
import AdminKnowledge from './AdminKnowledge.jsx'
import AdminPromptLibrary from './AdminPromptLibrary.jsx'
import TaggingStudio from './TaggingStudio.jsx'

/*
 * 운영 콘솔 — 진입은 홈 드로어 도구 행의 버튼 또는 #ops 해시 (구 #admin 호환).
 * 탭(threads|pipeline|experiment)은 해시가 원천 — App.jsx가 #ops/<탭>으로 라우팅해
 * 새로고침·앞뒤로가기가 탭을 유지한다. 전환은 api.setAdminTab.
 * 별도 토큰 게이트 없음 (옛 x-admin-token 입력 검증은 뗐다 — adminApi.js 참고).
 * "삭제"는 보관(archived) 처리 — 데이터는 남고 사용자 목록에서만 숨겨진다.
 */

/** admin 프로필 — 플레이그라운드 플로우 실행이 만드는 쓰레드의 소유자 (실사용자와 구분 축) */
const ADMIN_USER = 'ops-playground'

const NAV_GROUPS = [
  { label: '한눈에 보기', items: [['dashboard', '◈', '대시보드']] },
  {
    label: '서비스 품질',
    items: [
      ['threads', '◎', '고객 여정·평가'],
      ['tagging', '⊞', '상품 태깅'],
      ['knowledge', '◇', '운영 지식'],
    ],
  },
  {
    label: 'AI 운영',
    items: [
      ['pipeline', '⌁', '생성 파이프라인'],
      ['prompts', '⌘', '프롬프트'],
      ['experiment', '△', '실험·회귀'],
    ],
  },
]

export default function AdminView({ api, tab }) {
  const [mode, setMode] = useState('lab')
  const [threads, setThreads] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all') // 상태 흐름 바의 필터 (칩 재클릭 = 해제)
  const [ownerFilter, setOwnerFilter] = useState('all') // 'all' | 'user'(실사용자) | 'admin'(플레이그라운드)

  const [feedback, setFeedback] = useState(null) // AdminFeedbackWire { items, truncated }
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackError, setFeedbackError] = useState(null)

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

  useEffect(() => {
    loadList()
    loadFeedback()
  }, [loadList, loadFeedback])

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

  /* 소유 필터 — admin(플레이그라운드) 쓰레드와 실사용자 쓰레드를 가른다.
     상태 흐름 바의 개수도 이 축을 따른다 (플레이그라운드 실행이 여정 지표를 섞지 않게) */
  const adminThreadCount = useMemo(() => threads.filter((t) => t.userId === ADMIN_USER).length, [threads])
  const ownerThreads = useMemo(
    () =>
      ownerFilter === 'all'
        ? threads
        : threads.filter((t) => (t.userId === ADMIN_USER) === (ownerFilter === 'admin')),
    [threads, ownerFilter],
  )

  /* 상태 흐름 바 — 로드된 행 기준 상태별 개수. 체험 여정(탐색→설문→계획→완료)과
     종착 상태(이탈·보관)를 파이프라인과 같은 흐름 문법으로 보여주고, 칩 클릭이 목록을 거른다 */
  const statusCounts = useMemo(() => {
    const counts = {}
    for (const t of ownerThreads) counts[t.status] = (counts[t.status] || 0) + 1
    return counts
  }, [ownerThreads])
  const visibleThreads = useMemo(
    () => (statusFilter === 'all' ? ownerThreads : ownerThreads.filter((t) => t.status === statusFilter)),
    [ownerThreads, statusFilter],
  )
  const statusChip = (status) => (
    <button
      key={status}
      type="button"
      className={
        `sb-thread-flow__chip sb-thread-flow__chip--${status}` + (statusFilter === status ? ' is-on' : '')
      }
      title={`${statusLabel(status)} 쓰레드만 보기 (다시 누르면 전체)`}
      onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
    >
      <span className="sb-thread-flow__count">{statusCounts[status] || 0}</span>
      <span className="sb-thread-flow__label">{statusLabel(status)}</span>
    </button>
  )

  const activeLabel = NAV_GROUPS.flatMap((group) => group.items).find(([value]) => value === tab)?.[2] || '대시보드'

  return (
    <div className="sb-builder sb-admin-app">
      <aside className="sb-admin-sidebar">
        <div className="sb-admin-sidebar__brand">
          <button type="button" onClick={api.exitAdmin} aria-label="DDAK 홈으로">D</button>
          <span><b>DDAK</b><small>운영 센터</small></span>
        </div>
        <div className="sb-admin-mode" role="group" aria-label="운영 화면 모드">
          <button type="button" className={mode === 'lab' ? 'is-on' : ''} onClick={() => setMode('lab')}>실험실</button>
          <button type="button" className={mode === 'ops' ? 'is-on' : ''} onClick={() => setMode('ops')}>실서비스</button>
        </div>
        <nav className="sb-admin-nav" aria-label="운영 센터 메뉴">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="sb-admin-nav__group">
              <p>{group.label}</p>
              {group.items.map(([value, icon, label]) => (
                <button key={value} type="button" className={tab === value ? 'is-on' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => api.setAdminTab(value)}>
                  <i>{icon}</i><span>{label}</span>
                  {value === 'threads' && (feedback?.items?.length || 0) > 0 && <em>{feedback.items.length}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-admin-sidebar__foot">
          <span><i /> {listError || feedbackError ? '일부 데이터 연결 안 됨' : '운영 데이터 연결됨'}</span>
          <button type="button" onClick={api.exitAdmin}>시나리오 스튜디오로 돌아가기</button>
        </div>
      </aside>

      <div className="sb-admin-shell__body">
        <header className="sb-admin-mobilebar">
          <button type="button" className="sb-icon-btn" onClick={api.exitAdmin} aria-label="이전 화면으로">←</button>
          <b>{activeLabel}</b>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => { loadList(); loadFeedback() }}>새로고침</button>
        </header>

    {/* 파이프라인 탭은 3컬럼(지식·다이어그램·플레이그라운드)이라 넓은 컨테이너 변형을 쓴다 */}
    <main className={'sb-admin' + (tab === 'pipeline' || tab === 'tagging' ? ' sb-admin--wide' : '')}>

      {tab === 'dashboard' && <AdminDashboard api={api} threads={threads} feedback={feedback} loading={listLoading} mode={mode} />}

      {/* 파이프라인 탭 — 세로 흐름 다이어그램(엔진·모델 설정 포함) ∥ 플레이그라운드·지식.
          시스템 프롬프트는 별도 카드 없이 다이어그램의 단계 레이어 모달에서 열람·수정한다 */}
      {tab === 'pipeline' && <PipelineStudio api={api} />}

      {tab === 'prompts' && <AdminPromptLibrary api={api} />}

      {tab === 'knowledge' && <AdminKnowledge api={api} />}

      {tab === 'tagging' && <TaggingStudio api={api} embedded />}

      {/* 실험 탭 — 골든 케이스 실행·채점 + 전환 판정 계기판 */}
      {tab === 'experiment' && <ExperimentStudio />}

      {tab === 'threads' && (
      <>
      {/* 평가 모아보기 — 피드백 제출 대시보드 */}
      <AdminFeedback wire={feedback} loading={feedbackLoading} error={feedbackError} onOpenThread={openDetail} />

      {/* 쓰레드 목록 */}
      <div className="sb-admin-card">
        <p className="sb-panel-label">쓰레드 목록 {threads.length > 0 ? `(${threads.length}개 로드됨)` : ''}</p>
        {listError && <p className="sb-admin-gate__error">{listError}</p>}
        {/* 소유 필터 — admin(플레이그라운드) 쓰레드 구분. 상태 흐름 바·목록이 같이 걸린다 */}
        {threads.length > 0 && (
          <div className="sb-admin-fb-filters">
            <div className="sb-admin-fb-seg" role="group" aria-label="쓰레드 소유 필터">
              {[
                ['all', `전체 (${threads.length})`],
                ['user', `실사용자 (${threads.length - adminThreadCount})`],
                ['admin', `admin (${adminThreadCount})`],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={'sb-admin-fb-seg__btn' + (ownerFilter === value ? ' is-on' : '')}
                  onClick={() => setOwnerFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="sb-admin__muted">admin = 플레이그라운드(ops-playground) 실행 쓰레드</span>
          </div>
        )}
        {threads.length > 0 && (
          <div className="sb-thread-flow" role="group" aria-label="상태별 쓰레드 필터">
            {['exploring', 'surveying', 'planning', 'done'].map((status, index) => (
              <React.Fragment key={status}>
                {index > 0 && <i className="sb-flow__link sb-thread-flow__link" aria-hidden="true" />}
                {statusChip(status)}
              </React.Fragment>
            ))}
            <span className="sb-thread-flow__side">{['abandoned', 'archived'].map(statusChip)}</span>
          </div>
        )}
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
                {visibleThreads.map((t) => (
                  <tr key={t.id} className={t.status === 'archived' ? 'sb-admin-row--archived' : undefined}>
                    <td><code>{t.id}</code></td>
                    <td className="sb-admin-table__title">{t.title || (t.source && t.source.query) || '—'}</td>
                    <td>
                      <span className={`sb-admin-status sb-admin-status--${t.status}`}>{statusLabel(t.status)}</span>
                    </td>
                    <td>
                      {t.userId === ADMIN_USER ? (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom" title={t.userId}>admin</span>
                      ) : (
                        <code>{t.userId}</code>
                      )}
                    </td>
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
            {threads.length > 0 && visibleThreads.length === 0 && (
              <p className="sb-table__empty">「{statusLabel(statusFilter)}」 상태의 쓰레드가 없어요.</p>
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
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--small"
                      title="입력 스냅샷(의도·프로필·설문·답변)을 실험 탭의 골든 케이스로 굳혀요"
                      onClick={async () => {
                        try {
                          await promoteEvalCase(detail.id)
                          api.showToast('평가 케이스로 저장했어요 — 실험 탭에서 실행하세요.')
                        } catch (e) {
                          api.showToast(`케이스 저장 실패: ${e.message}`)
                        }
                      }}
                    >
                      평가 케이스로 저장
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
    </main>
    </div>
    </div>
  )
}
