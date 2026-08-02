import { classifyImportPayload, normalizeScenario } from '../../../lib/store.js'
import { buildShareUrl } from '../../../lib/share.js'
import { copyToClipboard } from '../../../lib/clipboard.js'
import { downloadJson, readFileText } from '../../../lib/jsonFile.js'
import {
  VERSION_LIMIT,
  publishSnapshot,
  publishWarnings,
  resolveChipLabel,
  scenarioFromSnapshot,
} from '../../../lib/builder/publishing.js'

/*
 * 상단 바의 시나리오 단위 명령 — 기기 폭, 발행·버전 복원,
 * 현재 시나리오 JSON 입출력, 공유 링크. 편집 상태는 만지지 않고 시나리오만 바꾼다.
 */
export function useTopBarActions({
  api, scenario, planCases, history, setSelectedIds, previewMode, closeMenu,
}) {
  const patchScenario = (patch) => api.updateScenario(scenario.id, (current) => ({ ...current, ...patch }))

  /* 기기 폭 전환 — 스택 모델이라 프레임 폭만 바뀐다 (아이템은 전폭·자동 높이) */
  const changeDevice = (preset) => {
    if (previewMode) return
    closeMenu()
    if (preset.key === (scenario.device || 'desktop')) return
    history.pushHistory()
    patchScenario({ device: preset.key })
    api.showToast(`${preset.label} 폭 기준으로 캔버스를 전환했어요.`)
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
    downloadJson(scenario, `ddak-scenario-${(scenario.chip || scenario.title || '시나리오').replace(/\s+/g, '_')}.json`)
    api.showToast('현재 시나리오를 JSON 파일로 내보냈어요.')
  }

  const importScenarioJson = (file) => {
    closeMenu()
    if (!file || previewMode) return
    readFileText(file).then((text) => {
      try {
        // 드로어와 같은 감지기를 공유 — 봉투(ddak-export)·목록(배열)이면 첫 시나리오를 쓴다
        const detected = classifyImportPayload(JSON.parse(text))
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
          stages: next.stages,
          planCases: next.planCases,
        })
        api.showToast('JSON 파일 내용으로 시나리오를 교체했어요.')
      } catch {
        api.showToast('가져오기 실패: 시나리오 JSON 형식을 확인해주세요.')
      }
    }, () => api.showToast('가져오기 실패: 파일을 읽을 수 없어요.'))
  }

  /* 공유 링크: URL 해시에 시나리오 전체가 담겨 어디서든 바로 실행된다 */
  const copyShareLink = async () => {
    const url = buildShareUrl(scenario)
    if (await copyToClipboard(url)) {
      api.showToast('공유 링크를 복사했어요. 받는 사람은 링크만 열면 바로 체험할 수 있어요.')
    } else {
      window.prompt('아래 링크를 복사하세요', url)
    }
  }

  return {
    patchScenario,
    changeDevice,
    publish,
    restoreVersion,
    exportScenarioJson,
    importScenarioJson,
    copyShareLink,
  }
}
