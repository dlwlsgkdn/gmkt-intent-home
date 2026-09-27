import type { SettingWire } from '../db/wire'

/*
 * 운영 설정 KV 의 계약 = DI 토큰 — core 는 값을 해석하지 않는다(저장·조회·삭제만). 구현은 저장소별로 둘
 * (settings.neon.service.ts · settings.mongo.service.ts), SettingsModule 이 STORE 에 따라 하나를 꽂는다.
 */
export abstract class SettingsService {
  abstract get(key: string): Promise<SettingWire>
  abstract put(key: string, value: unknown): Promise<SettingWire>
  /** 설정 제거 — 없는 키 삭제도 성공으로 본다 (멱등) */
  abstract remove(key: string): Promise<{ ok: boolean }>
}
