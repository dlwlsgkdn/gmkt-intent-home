import { classifyImportPayload, normalizeScenario } from '../../../lib/store.js'
import { PAD, MIN_ITEM_W, layoutCompactUp } from '../../../lib/layout.js'
import { buildShareUrl } from '../../../lib/share.js'
import {
  VERSION_LIMIT,
  publishSnapshot,
  publishWarnings,
  rescaleForDevice,
  resolveChipLabel,
  scenarioFromSnapshot,
} from '../../../lib/builder/publishing.js'

/*
 * 상단 바의 시나리오 단위 명령 — 기기/컴팩트/자동 정렬, 발행·버전 복원,
 * 현재 시나리오 JSON 입출력, 공유 링크. 편집 상태는 만지지 않고
 * 시나리오(와 배치)만 바꾼다.
 */
export function useTopBarActions({
  api, scenario, planCases, history, layout, setItems, setSelectedIds,
  heightsRef, canvasW, itemW, compactType, previewMode, closeMenu,
}) {
  const patchScenario = (patch) => api.updateScenario(scenario.id, (current) => ({ ...current, ...patch }))

  const changeDevice = (preset) => {
    if (previewMode) return
    closeMenu()
    if (preset.key === (scenario.device || 'desktop')) return
    history.pushHistory()
    api.updateScenario(scenario.id, (current) => ({
      ...current,
      ...rescaleForDevice(current, preset, { pad: PAD, minItemW: MIN_ITEM_W, currentCanvasW: canvasW }),
    }))
    // 폭 변경으로 높이가 다시 측정된 뒤 겹침/간격을 보정한다.
    // withTopOnly 필수 — 자식까지 넘기면 컴팩트가 자식을 캔버스 아이템으로 취급해
    // 좌표를 부여하고, 그 유령 블록이 최상위 아이템을 아래로 밀어낸다.
    setTimeout(() => {
      setItems((prev) => layout.withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
    }, 200)
    api.showToast(`${preset.label} 폭 기준으로 캔버스를 전환했어요.`)
  }

  const changeCompact = (type) => {
    if (previewMode) return
    closeMenu()
    if (type.key === compactType) return
    patchScenario({ compact: type.key })
    if (type.key !== 'none') setItems((prev) => layout.compactTo(prev, type.key))
    api.showToast(`${type.label} — ${type.desc}`)
  }

  const runAutoLayout = (mode) => {
    if (previewMode) return
    closeMenu()
    setItems((prev) => layout.withTopOnly(prev, (top) => mode.fn(top, heightsRef.current, { itemW, canvasW })))
    // 너비가 바뀌는 정렬은 높이가 다시 측정된 뒤 한 번 더 보정한다
    if (mode.key !== 'compact') {
      setTimeout(() => {
        setItems((prev) => layout.withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
      }, 180)
    }
    api.showToast(`${mode.label}로 겹침 없이 배치했어요.`)
  }

  const publish = () => {
    const warnings = publishWarnings(scenario, planCases)
    if (warnings.length > 0 && !window.confirm(`${warnings.join('\n')}\n\n그래도 발행할까요?`)) return
    const chip = resolveChipLabel(scenario)
    const snapshot = publishSnapshot(scenario, planCases, chip)
    api.updateScenario(scenario.id, (current) => ({
      ...current,
      status: 'published',
      chip,
      versionAt: snapshot.at,
      versions: [...(current.versions || []), snapshot].slice(-VERSION_LIMIT),
    }))
    api.showToast(`"#${chip}" 칩이 홈 탐색창 밑에 발행됐어요!`)
    api.goHome()
  }

  /* 발행 버전 복원: 현재 상태는 undo 히스토리로 보존된다 */
  const restoreVersion = (snapshot) => {
    if (previewMode) return
    closeMenu()
    const when = new Date(snapshot.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    if (!window.confirm(`${when} 발행 시점으로 되돌릴까요?\n(현재 상태는 ⌘Z로 복구할 수 있어요)`)) return
    history.pushHistory()
    setSelectedIds([])
    patchScenario(scenarioFromSnapshot(snapshot))
    api.showToast('발행 시점 버전으로 복원했어요.')
  }

  /* 현재 시나리오 JSON 입출력 — 홈 드로어의 목록 단위 입출력과 달리 이 시나리오 하나만 다룬다 */
  const exportScenarioJson = () => {
    closeMenu()
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ddak-scenario-${(scenario.chip || scenario.title || '시나리오').replace(/\s+/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    api.showToast('현재 시나리오를 JSON 파일로 내보냈어요.')
  }

  const importScenarioJson = (file) => {
    closeMenu()
    if (!file || previewMode) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        // 드로어와 같은 감지기를 공유 — 봉투(ddak-export)·목록(배열)이면 첫 시나리오를 쓴다
        const detected = classifyImportPayload(JSON.parse(reader.result))
        if (detected.kind === 'workspace') {
          api.showToast('전체 백업 파일이에요. 홈 드로어의 "JSON 가져오기"에서 복원해주세요.')
          return
        }
        const source = detected.kind === 'scenarios' ? detected.scenarios[0] : null
        if (!source || typeof source !== 'object' || !source.stages) throw new Error('시나리오 형식 아님')
        if (!window.confirm(`"${source.title || '제목 없음'}" 파일 내용으로 현재 시나리오를 교체할까요?\n(현재 상태는 ⌘Z로 복구할 수 있어요)`)) return
        const next = normalizeScenario(source)
        history.pushHistory()
        setSelectedIds([])
        // 내용 필드만 교체 — id·발행 상태·버전 이력은 현재 시나리오 것을 유지한다
        patchScenario({
          title: next.title,
          chip: next.chip,
          query: next.query,
          device: next.device,
          color: next.color,
          compact: next.compact,
          stages: next.stages,
          planCases: next.planCases,
        })
        api.showToast('JSON 파일 내용으로 시나리오를 교체했어요.')
      } catch {
        api.showToast('가져오기 실패: 시나리오 JSON 형식을 확인해주세요.')
      }
    }
    reader.readAsText(file)
  }

  /* 공유 링크: URL 해시에 시나리오 전체가 담겨 어디서든 바로 실행된다 */
  const copyShareLink = () => {
    const url = buildShareUrl(scenario)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => api.showToast('공유 링크를 복사했어요. 받는 사람은 링크만 열면 바로 체험할 수 있어요.'),
        () => window.prompt('아래 링크를 복사하세요', url)
      )
    } else {
      window.prompt('아래 링크를 복사하세요', url)
    }
  }

  return {
    patchScenario,
    changeDevice,
    changeCompact,
    runAutoLayout,
    publish,
    restoreVersion,
    exportScenarioJson,
    importScenarioJson,
    copyShareLink,
  }
}
