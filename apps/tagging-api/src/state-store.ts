/* 워크스페이스 상태 저장소 인터페이스 — 지금 구현은 Mongo 하나다.
   updatedAt 은 그대로 JSON 응답에 실릴 값이라 타입을 강제하지 않는다
   (Mongo Date 는 JSON.stringify 가 ISO 문자열로 바꾼다 — 원본 Postgres timestamptz 와 같은 모양). */
export type StateRow = { key: string; data: unknown; updatedAt: unknown }
export type StateIndexRow = { key: string; updatedAt: unknown }

export interface StateStore {
  listIndex(): Promise<StateIndexRow[]>
  getMany(keys: string[]): Promise<StateRow[]>
  put(key: string, data: unknown): Promise<void>
  del(key: string): Promise<void>
}
