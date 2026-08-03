import { DEFAULT_KEYWORDS, normalizeAccountsState, normalizeScenario } from '../../lib/store.js'
import {
  accountKey,
  assembleAccount,
  isContentBodyRow,
  isFatAccountRow,
  scenarioKey,
  threadsKey,
  versionsKey,
} from '../../lib/accountRows.js'

/*
 * 서버 행 채택 — 받은 행을 메모리에 병합하고 행 기준선(rowsRef)을 잡는다.
 *
 * 공통 규칙: 기준선은 항상 서버 값으로 잡고(loaded), 메모리는 손대지 않은 경우에만 서버
 * 값으로 바꾼다 — 손댄 데이터는 미저장으로 남아 다음 업로드가 올린다.
 */
export function createRowAdoption(ctx) {
  const {
    stateRef, setAccounts, setActiveAccountId, setKeywords,
    rowsRef, metaBaselineRef, keywordsBaselineRef,
    initialByIdRef, adoptionRef, legacyQueueRef, shellJson,
  } = ctx

  /* 이미 서버와 맞춘(loaded) 기준선을 미로드 기준선으로 되덮지 않는다 */
  const setRow = (key, entry) => {
    const existing = rowsRef.current.get(key)
    if (!existing || !existing.loaded || entry.loaded) rowsRef.current.set(key, entry)
  }

  const adoptKeywords = (remoteKeywords) => {
    if (!Array.isArray(remoteKeywords)) return
    const isDefaultDict = (list) => JSON.stringify(list) === JSON.stringify(DEFAULT_KEYWORDS)
    setKeywords((prev) => {
      const keepLocal = isDefaultDict(remoteKeywords) && !isDefaultDict(prev)
      keywordsBaselineRef.current = keepLocal ? null : JSON.stringify(remoteKeywords)
      return keepLocal ? prev : remoteKeywords
    })
  }

  /* 본문(셸) 행 채택 — 계정을 상태에 병합하고 행 기준선을 잡는다. 새 셸 형식이면 콘텐츠·버전·
     쓰레드는 같은 id의 로컬 값을 임시로 붙인다(해당 행이 로드될 때 서버 값으로 확정).
     구형 본문(콘텐츠 인라인)은 인라인 값이 곧 서버 콘텐츠라 그 행들도 로드된 것으로 처리하고
     새 행 체계로의 이관 대기열에 올린다 */
  const adoptBodyRow = (data) => {
    if (!data || typeof data !== 'object' || !data.id) return null
    const id = data.id
    const fat = isFatAccountRow(data)
    const legacy = fat || isContentBodyRow(data)
    const local = stateRef.current.accounts.find((account) => account.id === id)
      || initialByIdRef.current.get(id) || null
    const assembled = assembleAccount(data, { localAccount: local })
    const normalized = normalizeAccountsState({ accounts: [assembled], activeId: id })
    if (!normalized) return null
    const adopted = normalized.accounts[0]

    setAccounts((prev) => {
      const current = prev.find((account) => account.id === id)
      if (!current) return [...prev, adopted]
      const untouched = current === initialByIdRef.current.get(id) || current === adoptionRef.current.get(id)
      return untouched ? prev.map((account) => (account.id === id ? adopted : account)) : prev
    })
    adoptionRef.current.set(id, adopted)

    rowsRef.current.set(accountKey(id), { loaded: true, base: shellJson(adopted) })
    for (const scenario of adopted.scenarios || []) {
      setRow(scenarioKey(id, scenario.id), { loaded: legacy, base: { stages: scenario.stages, planCases: scenario.planCases } })
      setRow(versionsKey(id, scenario.id), { loaded: fat, base: scenario.versions })
    }
    setRow(threadsKey(id), { loaded: fat, base: adopted.threads })
    if (legacy) legacyQueueRef.current.set(id, { account: adopted, fat })
    return adopted
  }

  const adoptScenarioRow = (accountId, scenarioId, data) => {
    if (!data || typeof data !== 'object') return
    const key = scenarioKey(accountId, scenarioId)
    const account = stateRef.current.accounts.find((candidate) => candidate.id === accountId)
    const scenario = account?.scenarios.find((candidate) => candidate.id === scenarioId)
    if (!scenario) return // 셸에 없는 시나리오의 잔여 행 — 채택하지 않는다 (고아 정리가 지운다)
    const merged = normalizeScenario({ ...scenario, stages: data.stages, planCases: data.planCases })
    const entry = rowsRef.current.get(key)
    setAccounts((prev) => prev.map((candidate) => {
      if (candidate.id !== accountId) return candidate
      let changed = false
      const scenarios = candidate.scenarios.map((current) => {
        if (current.id !== scenarioId) return current
        const untouched = !entry
          || (entry.base && entry.base.stages === current.stages && entry.base.planCases === current.planCases)
        if (!untouched) return current // 그 사이 손댐 — 메모리 유지, 기준선만 서버 값(미저장으로 남는다)
        changed = true
        return merged
      })
      return changed ? { ...candidate, scenarios } : candidate
    }))
    rowsRef.current.set(key, { loaded: true, base: { stages: merged.stages, planCases: merged.planCases } })
  }

  const adoptVersionsRow = (accountId, scenarioId, data) => {
    const server = Array.isArray(data) ? data : []
    const key = versionsKey(accountId, scenarioId)
    const entry = rowsRef.current.get(key)
    setAccounts((prev) => prev.map((candidate) => {
      if (candidate.id !== accountId) return candidate
      let changed = false
      const scenarios = candidate.scenarios.map((current) => {
        if (current.id !== scenarioId) return current
        const untouched = !entry || entry.base === current.versions
        if (!untouched) return current
        changed = true
        return { ...current, versions: server }
      })
      return changed ? { ...candidate, scenarios } : candidate
    }))
    rowsRef.current.set(key, { loaded: true, base: server })
  }

  const adoptThreadsRow = (accountId, data) => {
    const server = Array.isArray(data) ? data : []
    const key = threadsKey(accountId)
    const entry = rowsRef.current.get(key)
    setAccounts((prev) => prev.map((candidate) => {
      if (candidate.id !== accountId) return candidate
      const untouched = !entry || entry.base === candidate.threads
      if (untouched) return { ...candidate, threads: server }
      /* 로드 전에 기록된 쓰레드 보존 — 서버 목록과 id 합집합 (로컬 신규가 앞) */
      const serverIds = new Set(server.map((thread) => thread && thread.id))
      const merged = [...candidate.threads.filter((thread) => thread && !serverIds.has(thread.id)), ...server]
      return { ...candidate, threads: merged.slice(0, 30) }
    }))
    rowsRef.current.set(key, { loaded: true, base: server })
  }

  /* 구 통짜 블롭 경로 전용: 전체 데이터를 한 번에 채택하고 전 행을 로드 상태로 */
  const adoptFullAccounts = (adopted) => {
    setAccounts((prev) => {
      const serverIds = new Set(adopted.accounts.map((account) => account.id))
      const next = adopted.accounts.map((server) => {
        const current = prev.find((account) => account.id === server.id)
        if (!current) return server
        const untouched = current === initialByIdRef.current.get(server.id)
        return untouched ? server : current
      })
      for (const current of prev) {
        if (serverIds.has(current.id)) continue
        if (current !== initialByIdRef.current.get(current.id)) next.push(current)
      }
      return next
    })
    setActiveAccountId((prev) => {
      if (adopted.accounts.some((account) => account.id === prev)) return prev
      const current = stateRef.current.accounts.find((account) => account.id === prev)
      if (current && current !== initialByIdRef.current.get(prev)) return prev
      return adopted.activeId
    })
    for (const account of adopted.accounts) {
      adoptionRef.current.set(account.id, account)
      rowsRef.current.set(accountKey(account.id), { loaded: true, base: shellJson(account) })
      for (const scenario of account.scenarios || []) {
        rowsRef.current.set(scenarioKey(account.id, scenario.id), { loaded: true, base: { stages: scenario.stages, planCases: scenario.planCases } })
        rowsRef.current.set(versionsKey(account.id, scenario.id), { loaded: true, base: scenario.versions })
      }
      rowsRef.current.set(threadsKey(account.id), { loaded: true, base: account.threads })
    }
    metaBaselineRef.current = JSON.stringify(adopted.accounts.map((account) => account.id))
  }

  return { adoptKeywords, adoptBodyRow, adoptScenarioRow, adoptVersionsRow, adoptThreadsRow, adoptFullAccounts }
}
