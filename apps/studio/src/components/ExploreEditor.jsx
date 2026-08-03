import React from 'react'

/* 사용자 프로필(고정 설문 정보) + 키워드 사전 편집기 — 계정 공통 설정.
   탐색(홈) 페이지 콘텐츠는 빌더의 "탐색" 탭에서 컴포넌트로 자유 배치·편집한다. */
export default function ExploreEditor({ api }) {
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
        <div className="sb-topbar__row">
          <button type="button" className="sb-icon-btn" onClick={api.closeExploreEditor} aria-label="이전 화면으로">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="sb-topbar__meta">
            <span className="sb-title-static">🪪 프로필 · 키워드 사전 (공통)</span>
          </div>
          <span className="sb-autosave">이 프로필의 모든 시나리오가 공유 · 자동 저장</span>
          <div className="sb-topbar__actions">
            <button type="button" className="sb-btn sb-btn--primary" onClick={api.goHome}>홈에서 확인</button>
          </div>
        </div>
      </div>

      <div className="sb-explore-workspace sb-explore-workspace--single">
        <aside className="sb-inspector sb-explore-fields">
          <p className="sb-profile-config__hint">
            💡 탐색(홈) 페이지의 인사말·검색창·스토리 등 콘텐츠는 이제 <strong>빌더의 "탐색" 탭</strong>에서
            설문/계획처럼 컴포넌트로 자유롭게 배치·편집해요.
          </p>

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
        </aside>
      </div>
    </div>
  )
}
