import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import type {
  CreateThreadBody,
  FeedbackStepsWire,
  SettingWire,
  Thread,
  ThreadListPage,
  ThreadStep,
  ThreadWithSteps,
  UpdateThreadBody,
  UpsertStepBody,
} from '@ddak/schema'

/** backend core internal API 클라이언트 — 계약 타입은 @ddak/schema 공유 */
@Injectable()
export class CoreClientService {
  private base(): string {
    const url = process.env.CORE_URL
    if (!url) throw new ServiceUnavailableException('CORE_URL이 설정되지 않았습니다')
    return url.replace(/\/$/, '')
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    const token = process.env.CORE_SERVICE_TOKEN
    if (token) h.authorization = `Bearer ${token}`
    return h
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base() + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new HttpException(`core ${method} ${path} 실패: ${text.slice(0, 200)}`, res.status)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  createThread(body: CreateThreadBody) {
    return this.req<Thread>('POST', '/internal/threads', body)
  }
  updateThread(id: string, body: UpdateThreadBody) {
    return this.req<Thread>('PATCH', `/internal/threads/${id}`, body)
  }
  upsertStep(id: string, seq: number, body: UpsertStepBody) {
    return this.req<ThreadStep>('PUT', `/internal/threads/${id}/steps/${seq}`, body)
  }
  getThread(id: string) {
    return this.req<ThreadWithSteps>('GET', `/internal/threads/${id}`)
  }
  listThreads(uid: string, cursor?: string, limit?: number) {
    const q = new URLSearchParams()
    if (cursor) q.set('cursor', cursor)
    if (limit) q.set('limit', String(limit))
    const qs = q.toString()
    return this.req<ThreadListPage>(
      'GET',
      `/internal/users/${encodeURIComponent(uid)}/threads${qs ? `?${qs}` : ''}`,
    )
  }

  /** 관리용 전체 목록 — archived 포함, id 키셋 커서 */
  listAllThreads(cursor?: string, limit?: number) {
    const q = new URLSearchParams()
    if (cursor) q.set('cursor', cursor)
    if (limit) q.set('limit', String(limit))
    const qs = q.toString()
    return this.req<ThreadListPage>('GET', `/internal/threads${qs ? `?${qs}` : ''}`)
  }

  /** 피드백 스텝 나열 (관리 평가 모아보기 원천) — 최신순, limit 상한 + truncated */
  listFeedbackSteps(limit?: number) {
    const qs = limit ? `?limit=${limit}` : ''
    return this.req<FeedbackStepsWire>('GET', `/internal/feedback-steps${qs}`)
  }

  /** 설정 KV — 없는 키는 null (404를 삼킨다) */
  async getSetting(key: string): Promise<SettingWire | null> {
    try {
      return await this.req<SettingWire>('GET', `/internal/settings/${encodeURIComponent(key)}`)
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 404) return null
      throw e
    }
  }
  putSetting(key: string, value: unknown) {
    return this.req<SettingWire>('PUT', `/internal/settings/${encodeURIComponent(key)}`, { value })
  }
  deleteSetting(key: string) {
    return this.req<{ ok: boolean }>('DELETE', `/internal/settings/${encodeURIComponent(key)}`)
  }
}
