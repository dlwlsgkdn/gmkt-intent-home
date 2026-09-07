/* 워크스페이스 상태 저장소 인터페이스 — Postgres(Neon)·Mongo 어댑터가 공유한다.
   updatedAt 은 그대로 JSON 응답에 실릴 값이라 타입을 강제하지 않는다
   (Postgres timestamptz → Date, Mongo Date 모두 JSON.stringify 가 알아서 ISO 문자열로 바꾼다). */
export type StateRow = { key: string; data: unknown; updatedAt: unknown }
export type StateIndexRow = { key: string; updatedAt: unknown }

export interface StateStore {
  listIndex(): Promise<StateIndexRow[]>
  getMany(keys: string[]): Promise<StateRow[]>
  put(key: string, data: unknown): Promise<void>
  del(key: string): Promise<void>
}
