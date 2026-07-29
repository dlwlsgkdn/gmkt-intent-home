import React from 'react'
import { CHIP_COLORS, DEVICE_PRESETS, STAGES, planCasesForScenario } from '../../lib/store.js'
import { COMPACT_TYPES, LAYOUT_MODES } from '../../lib/layout.js'
import Dropdown from '../ui/Dropdown.jsx'
import SyncButton from '../SyncButton.jsx'

/*
 * 빌더 상단 바 — 표시와 이벤트 위임만 한다. 상태와 판단은 전부 Builder가 갖고 있다.
 *
 * 4개 행이 각기 다른 관심사를 담당한다:
 *   1행 문서   — 제목·칩·상태·발행
 *   2행 도구   — 히스토리 / 보기(모드·줌) / 레이아웃(기기·컴팩트·정렬) / 공유
 *   3행 단계   — 탐색 · 설문 · 계획 · 평가 탭
 *   4행(children) — 계획 케이스 바처럼 단계에 종속된 행
 */

/* 빌더에서 편집 가능한 단계: 공통 탐색(계정 소유, 자동 반영) + 시나리오 소유 설문/계획 */
export const BUILD_STAGES = [
  { key: 'explore', label: '탐색', desc: '모든 시나리오가 공유하는 공통 탐색(홈) 페이지 — 저장 즉시 홈에 반영', common: true },
  ...STAGES,
  { key: 'evaluation', label: '평가 · 보강', desc: '대표 CASE의 실제 콘텐츠 컴포넌트를 인스턴스별로 0~5점 QA', review: true },
]

const chevron = (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
)

export default function BuilderTopBar({
  scenario,
  remoteSync,
  planCases,
  stageKey,
  setStageKey,
  previewMode,
  isExplore,
  isEvaluation,
  exploreItemCount,
  evaluatedCaseCount,
  chipColor,
  device,
  compactType,
  compactOn,
  canvasView,
  setCanvasView,
  zoom,
  openMenu,
  toggleMenu,
  closeMenu,
  history,
  onGoHome,
  onPlay,
  onPatchScenario,
  onChangeDevice,
  onChangeCompact,
  onAutoLayout,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onPublish,
  onUnpublish,
  onRestoreVersion,
  onExportJson,
  onImportJsonFile,
  onCopyShareLink,
  children,
}) {
  const versions = scenario.versions || []
  /* 현재 편집본의 기준 버전(마지막 발행·복원). versionAt 기록이 없는 구버전 데이터는 최신 발행본으로 간주 */
  const versionAtIndex = versions.findIndex((version) => version.at === scenario.versionAt)
  const currentVersionNo = versionAtIndex >= 0 ? versionAtIndex + 1 : versions.length

  return (
    <div className="sb-topbar">
      {/* 1행: 문서 정보 + 발행 */}
      <div className="sb-topbar__row">
        <button type="button" className="sb-icon-btn" onClick={onGoHome} aria-label="홈으로">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div className="sb-topbar__meta">
          <input
            className="sb-title-input"
            value={scenario.title}
            placeholder="시나리오 제목"
            onChange={(event) => onPatchScenario({ title: event.target.value })}
          />
          <div className="sb-chip-input-wrap" style={{ color: chipColor }}>
            <span>#</span>
            <input
              className="sb-chip-input"
              style={{ color: chipColor }}
              value={scenario.chip}
              placeholder="칩_라벨"
              onChange={(event) => onPatchScenario({ chip: event.target.value.replace(/\s+/g, '_') })}
            />
          </div>
          <Dropdown
            open={openMenu === 'color'}
            onClose={closeMenu}
            menuClass="sb-color-menu"
            button={
              <button type="button" className="sb-color-btn" title="칩 색상 선택" aria-label="칩 색상 선택" onClick={() => toggleMenu('color')}>
                <span className="sb-color-dot" style={{ background: chipColor }} />
              </button>
            }
          >
            {CHIP_COLORS.map((color) => (
              <button
                key={color.key}
                type="button"
                className={'sb-color-swatch' + (chipColor === color.color ? ' sb-color-swatch--active' : '')}
                title={color.label}
                style={{ background: color.color }}
                onClick={() => {
                  onPatchScenario({ color: color.color })
                  closeMenu()
                }}
              />
            ))}
          </Dropdown>
        </div>

        <span className={'sb-status ' + (scenario.status === 'published' ? 'sb-status--live' : '')}>
          {scenario.status === 'published' ? '발행됨' : '작성 중'}
        </span>
        <span className="sb-autosave" title={scenario.updatedAt}>
          자동 저장됨 · {new Date(scenario.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <SyncButton sync={remoteSync} small />


        <div className="sb-topbar__actions">
          <button type="button" className="sb-btn" onClick={onPlay}>시험해보기</button>

          <Dropdown
            open={openMenu === 'json'}
            onClose={closeMenu}
            button={
              <button type="button" className={'sb-btn' + (openMenu === 'json' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('json')} title="현재 시나리오 JSON 파일 내보내기/가져오기">
                JSON
                {chevron}
              </button>
            }
          >
            <button type="button" className="sb-menu__item" onClick={onExportJson}>
              <strong>파일로 내보내기</strong>
              <small>현재 시나리오 전체를 JSON 파일로 저장</small>
            </button>
            <label className={'sb-menu__item' + (previewMode ? ' sb-menu__item--disabled' : '')} style={{ cursor: previewMode ? 'not-allowed' : 'pointer' }}>
              <strong>파일에서 가져오기</strong>
              <small>JSON 파일 내용으로 현재 시나리오 교체 · ⌘Z 복구 가능</small>
              <input
                type="file"
                accept="application/json,.json"
                hidden
                disabled={previewMode}
                onChange={(event) => {
                  onImportJsonFile(event.target.files && event.target.files[0])
                  event.target.value = ''
                }}
              />
            </label>
          </Dropdown>

          {versions.length > 0 && (
            <Dropdown
              open={openMenu === 'version'}
              onClose={closeMenu}
              button={
                <button type="button" disabled={previewMode} className={'sb-btn' + (openMenu === 'version' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('version')} title={`발행 시점 버전 복원 — 현재 편집본은 v${currentVersionNo} 기준`}>
                  버전 v{currentVersionNo}/{versions.length}
                </button>
              }
            >
              {[...versions].reverse().map((version, index, list) => {
                const versionNo = list.length - index
                const isCurrent = versionNo === currentVersionNo
                const versionCases = version.planCases || planCasesForScenario({ stages: version.stages })
                const itemCount = versionCases.reduce((sum, planCase) => sum + (planCase.items || []).length, 0)
                return (
                  <button
                    key={version.at}
                    type="button"
                    className={'sb-menu__item' + (isCurrent ? ' sb-menu__item--active' : '')}
                    onClick={() => onRestoreVersion(version)}
                  >
                    <strong>발행 v{versionNo}{index === 0 ? ' · 최신' : ''}{isCurrent ? ' · 현재 사용 중' : ''}</strong>
                    <small>
                      {new Date(version.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' · '}설문 {(version.stages.survey || []).length} · 계획 {versionCases.length}케이스/{itemCount}개
                    </small>
                  </button>
                )
              })}
            </Dropdown>
          )}

          {scenario.status === 'published' && (
            <button type="button" className="sb-btn sb-btn--ghost" onClick={onUnpublish}>발행 취소</button>
          )}
          <button type="button" className="sb-btn sb-btn--primary" onClick={onPublish}>
            {scenario.status === 'published' ? '변경사항 재발행' : '발행하기'}
          </button>
        </div>
      </div>

      {/* 2행: 편집 도구 그룹 (구분선으로 관심사 분리) */}
      <div className="sb-topbar__row sb-topbar__row--tools" hidden={isEvaluation}>
        <div className="sb-tb-group" role="group" aria-label="히스토리">
          <button type="button" className="sb-icon-btn" title="실행 취소 (⌘Z)" aria-label="실행 취소" disabled={previewMode || !history.canUndo} onClick={history.undo}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg>
          </button>
          <button type="button" className="sb-icon-btn" title="다시 실행 (⇧⌘Z)" aria-label="다시 실행" disabled={previewMode || !history.canRedo} onClick={history.redo}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></svg>
          </button>
        </div>
        <span className="sb-tb-sep" aria-hidden="true" />
        <div className="sb-tb-group" role="group" aria-label="보기">
          <button
            type="button"
            className={'sb-btn' + (canvasView === 'preview' ? ' sb-btn--compact-on' : '')}
            title={canvasView === 'preview'
              ? '미리보기 모드 — 실제 사용자가 보는 모습 (클릭해 편집 모드로)'
              : '편집 모드 — 레이아웃 클리핑을 풀고 모든 자식을 온전히 표시 (클릭해 미리보기로)'}
            onClick={() => setCanvasView(canvasView === 'edit' ? 'preview' : 'edit')}
          >
            {canvasView === 'preview' ? '👁 미리보기' : '✏️ 편집 모드'}
          </button>
          <div className="sb-zoom-ctl">
            <button type="button" title="축소 (⌘-)" aria-label="축소" onClick={onZoomOut}>−</button>
            <button type="button" className="sb-zoom-ctl__val" title="100%로 (⌘0)" onClick={onZoomReset}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" title="확대 (⌘+)" aria-label="확대" onClick={onZoomIn}>+</button>
          </div>
        </div>
        <span className="sb-tb-sep" aria-hidden="true" />
        <div className="sb-tb-group" role="group" aria-label="레이아웃">
          <Dropdown
            open={openMenu === 'device'}
            onClose={closeMenu}
            button={
              <button type="button" disabled={previewMode} className={'sb-btn' + (openMenu === 'device' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('device')} title="캔버스 기기 폭 선택">
                {device.icon} {device.label}
                {chevron}
              </button>
            }
          >
            {DEVICE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={'sb-menu__item' + (preset.key === device.key ? ' sb-menu__item--active' : '')}
                onClick={() => onChangeDevice(preset)}
              >
                <strong>{preset.icon} {preset.label}</strong>
                <small>캔버스 폭 {preset.w}px{preset.key === device.key ? ' · 사용 중' : ''}</small>
              </button>
            ))}
          </Dropdown>

          <Dropdown
            open={openMenu === 'compact'}
            onClose={closeMenu}
            button={
              <button
                type="button"
                disabled={previewMode}
                className={'sb-btn' + (compactOn ? ' sb-btn--compact-on' : '') + (openMenu === 'compact' ? ' sb-btn--open' : '')}
                title="컴팩트 방향 — 배치가 바뀔 때 빈 공간 없이 스택되는 방향"
                onClick={() => toggleMenu('compact')}
              >
                🧲 {COMPACT_TYPES.find((type) => type.key === compactType)?.label || '컴팩트'}
                {chevron}
              </button>
            }
          >
            {COMPACT_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                className={'sb-menu__item' + (type.key === compactType ? ' sb-menu__item--active' : '')}
                onClick={() => onChangeCompact(type)}
              >
                <strong>{type.label}</strong>
                <small>{type.desc}{type.key === compactType ? ' · 사용 중' : ''}</small>
              </button>
            ))}
          </Dropdown>

          <Dropdown
            open={openMenu === 'layout'}
            onClose={closeMenu}
            button={
              <button type="button" disabled={previewMode} className={'sb-btn' + (openMenu === 'layout' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('layout')}>
                자동 정렬
                {chevron}
              </button>
            }
          >
            {LAYOUT_MODES.map((mode) => (
              <button key={mode.key} type="button" className="sb-menu__item" onClick={() => onAutoLayout(mode)}>
                <strong>{mode.label}</strong>
                <small>{mode.desc}</small>
              </button>
            ))}
          </Dropdown>
        </div>
        <span className="sb-tb-sep" aria-hidden="true" />
        <div className="sb-tb-group" role="group" aria-label="공유">
          <button type="button" className="sb-icon-btn" title="공유 링크 복사 — 링크만 열면 바로 체험" aria-label="공유 링크 복사" onClick={onCopyShareLink}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" /></svg>
          </button>
        </div>
      </div>

      {/* 3행: 단계 탭 — 탐색(공통 캔버스)도 설문/계획처럼 직접 편집한다 */}
      <div className="sb-topbar__row sb-topbar__row--tabs">
        <div className="sb-stage-tabs">
          {BUILD_STAGES.map((stage, index) => (
            <React.Fragment key={stage.key}>
              {index === 1 && <span className="sb-stage-tabs__divider" aria-hidden="true" />}
              <button
                type="button"
                className={
                  'sb-stage-tab'
                  + (stage.common ? ' sb-stage-tab--common' : '')
                  + (stage.review ? ' sb-stage-tab--review' : '')
                  + (stageKey === stage.key ? ' sb-stage-tab--active' : '')
                }
                title={stage.desc}
                onClick={() => setStageKey(stage.key)}
              >
                <span className="sb-stage-tab__num">{stage.common ? '🧭' : index}</span>
                {stage.label}
                <span className="sb-stage-tab__count">
                  {stage.common
                    ? exploreItemCount
                    : stage.key === 'evaluation'
                      ? evaluatedCaseCount
                      : stage.key === 'plan'
                        ? planCases.length
                        : (scenario.stages[stage.key] || []).length}
                </span>
              </button>
            </React.Fragment>
          ))}
          {isExplore && <span className="sb-stage-tabs__note">공통 페이지 · 모든 시나리오 홈에 즉시 반영</span>}
        </div>
      </div>

      {children}
    </div>
  )
}
