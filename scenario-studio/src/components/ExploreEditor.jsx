import React from 'react'
import ExploreFrame from './ExploreFrame.jsx'
import { DEFAULT_EXPLORE } from '../lib/store.js'

const STORY_LABELS = ['피처 스토리 (대형)', '스토리 2 (우상단)', '스토리 3 (우하단)']

/* 공통 탐색(홈) 페이지 편집기 — 모든 시나리오가 공유한다 */
export default function ExploreEditor({ api }) {
  const cfg = api.explore
  const set = (patch) => api.updateExplore({ ...cfg, ...patch })
  const setStory = (i, patch) => {
    const stories = cfg.stories.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    set({ stories })
  }

  const reset = () => {
    if (window.confirm('탐색 페이지를 기본 구성으로 되돌릴까요?')) {
      api.updateExplore(DEFAULT_EXPLORE)
      api.showToast('탐색 페이지를 기본값으로 초기화했어요.')
    }
  }

  const published = api.scenarios.filter((s) => s.status === 'published')

  /* 키워드 사전 편집 — [[키워드]] 점선 밑줄 클릭 시 뜨는 설명 */
  const keywords = api.keywords || []
  const setKeywordItem = (i, patch) => {
    api.updateKeywords(keywords.map((k, idx) => (idx === i ? { ...k, ...patch } : k)))
  }
  const addKeyword = () => api.updateKeywords([...keywords, { word: '', desc: '', points: '' }])
  const removeKeyword = (i) => api.updateKeywords(keywords.filter((_, idx) => idx !== i))

  /* 사용자 프로필 (고정 설문 정보) 편집 */
  const profile = api.profile
  const setProfile = (patch) => api.updateProfile({ ...profile, ...patch })
  const setProfileItem = (i, patch) => {
    setProfile({ items: profile.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) })
  }
  const addProfileItem = () => setProfile({ items: [...profile.items, { label: '', value: '' }] })
  const removeProfileItem = (i) => setProfile({ items: profile.items.filter((_, idx) => idx !== i) })

  return (
    <div className="sb-builder">
      <div className="sb-topbar">
        <button type="button" className="sb-icon-btn" onClick={api.closeExploreEditor} aria-label="이전 화면으로">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="sb-topbar__meta">
          <span className="sb-title-static">🧭 탐색 페이지 (공통)</span>
        </div>
        <span className="sb-autosave">모든 시나리오가 공유 · 자동 저장</span>
        <div className="sb-topbar__actions">
          <button type="button" className="sb-btn sb-btn--ghost" onClick={reset}>기본값으로 초기화</button>
          <button type="button" className="sb-btn sb-btn--primary" onClick={api.goHome}>홈에서 확인</button>
        </div>
      </div>

      <div className="sb-explore-workspace">
        {/* 라이브 미리보기 */}
        <main className="sb-explore-preview">
          <div className="sb-explore-preview__frame">
            <ExploreFrame
              config={cfg}
              interactive={false}
              chips={
                published.length > 0
                  ? published.map((s) => (
                      <span key={s.id} className="suggestion-tag sb-chip-scenario" title="미리보기 (클릭 비활성)">
                        <span className="sb-chip-scenario__spark">✦</span>#{s.chip}
                      </span>
                    ))
                  : [
                      <span key="sample" className="suggestion-tag sb-chip-scenario sb-chip-scenario--sample">
                        <span className="sb-chip-scenario__spark">✦</span>#발행된_시나리오_칩_자리
                      </span>,
                    ]
              }
            />
          </div>
        </main>

        {/* 편집 필드 */}
        <aside className="sb-inspector sb-explore-fields">
          <p className="sb-panel-label">인사말 · 검색</p>
          <div className="sb-field">
            <label>인사말 문구</label>
            <textarea rows={3} value={cfg.greeting} onChange={(e) => set({ greeting: e.target.value })} />
          </div>
          <div className="sb-field">
            <label>검색창 플레이스홀더</label>
            <input type="text" value={cfg.searchPlaceholder} onChange={(e) => set({ searchPlaceholder: e.target.value })} />
          </div>

          <div className="sb-explore-story-fields">
            <p className="sb-panel-label">사용자 프로필 (고정 설문 정보)</p>
            <p className="sb-profile-config__hint">
              "프로필 요약 패널" 컴포넌트에 쓰여요. 시나리오별 노출 항목은 빌더 캔버스에서 패널의 배지를 눌러 고릅니다.
            </p>
            <div className="sb-field">
              <label>사용자 이름</label>
              <input type="text" value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} />
            </div>
            {profile.items.map((it, i) => (
              <div key={i} className="sb-profile-edit-row">
                <input
                  type="text"
                  placeholder="라벨"
                  value={it.label}
                  onChange={(e) => setProfileItem(i, { label: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="값"
                  value={it.value}
                  onChange={(e) => setProfileItem(i, { value: e.target.value })}
                />
                <button type="button" aria-label="항목 삭제" onClick={() => removeProfileItem(i)}>✕</button>
              </div>
            ))}
            <button type="button" className="sb-btn sb-btn--small" onClick={addProfileItem}>+ 항목 추가</button>
          </div>

          <div className="sb-explore-story-fields">
            <p className="sb-panel-label">키워드 사전</p>
            <p className="sb-profile-config__hint">
              컴포넌트 문구에 <code>[[키워드]]</code>로 쓰면 점선 밑줄이 생기고, 실행 중 클릭하면 여기 설명이 모달로 떠요.
            </p>
            {keywords.map((k, i) => (
              <div key={i} className="sb-keyword-edit">
                <div className="sb-profile-edit-row">
                  <input
                    type="text"
                    placeholder="키워드"
                    value={k.word}
                    onChange={(e) => setKeywordItem(i, { word: e.target.value })}
                  />
                  <button type="button" aria-label="키워드 삭제" onClick={() => removeKeyword(i)}>✕</button>
                </div>
                <textarea
                  rows={2}
                  placeholder="설명"
                  value={k.desc}
                  onChange={(e) => setKeywordItem(i, { desc: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="포인트 (쉼표 구분)"
                  value={k.points}
                  onChange={(e) => setKeywordItem(i, { points: e.target.value })}
                />
              </div>
            ))}
            <button type="button" className="sb-btn sb-btn--small" onClick={addKeyword}>+ 키워드 추가</button>
          </div>

          {cfg.stories.map((s, i) => (
            <div key={i} className="sb-explore-story-fields">
              <p className="sb-panel-label">{STORY_LABELS[i]}</p>
              <div className="sb-field">
                <label>키커(작은 라벨)</label>
                <input type="text" value={s.kicker} onChange={(e) => setStory(i, { kicker: e.target.value })} />
              </div>
              <div className="sb-field">
                <label>제목</label>
                <input type="text" value={s.title} onChange={(e) => setStory(i, { title: e.target.value })} />
              </div>
              {i === 0 && (
                <div className="sb-field">
                  <label>설명</label>
                  <textarea rows={2} value={s.desc} onChange={(e) => setStory(i, { desc: e.target.value })} />
                </div>
              )}
              <div className="sb-field">
                <label>이미지 URL</label>
                <input type="text" value={s.imageUrl} onChange={(e) => setStory(i, { imageUrl: e.target.value })} />
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
