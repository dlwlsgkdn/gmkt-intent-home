import { z } from 'zod'

/*
 * 관리(admin) 계약 — 스튜디오 #admin 페이지 ↔ BFF `/api/admin/*` ↔ core 설정 KV.
 * 관리 페이지는 유저 진입점에 노출되지 않으며, x-admin-token 헤더(ADMIN_TOKEN)로 보호된다.
 */

/* ── core 설정 KV (internal API) ─────────────────────────────────────── */

/** 설정 키는 소문자·숫자·하이픈 — 예: 'llm-model' */
export const SETTING_KEY_PATTERN = /^[a-z0-9-]{1,64}$/
export const SettingKey = z.string().regex(SETTING_KEY_PATTERN, '설정 키는 소문자·숫자·하이픈 1~64자입니다')
export type SettingKey = z.infer<typeof SettingKey>

export const PutSettingBody = z.object({
  /** jsonb로 저장되는 값 — core는 내용을 해석하지 않는다 */
  value: z.unknown(),
})
export type PutSettingBody = z.infer<typeof PutSettingBody>

export const SettingWire = z.object({
  key: SettingKey,
  value: z.unknown(),
  updatedAt: z.string(),
})
export type SettingWire = z.infer<typeof SettingWire>

/* ── BFF admin — LLM 모델 관리 ───────────────────────────────────────── */

/** 관리 페이지에 노출되는 선택지 하나 — 카탈로그는 BFF(llm.service)가 소유한다 */
export const AdminModelOption = z.object({
  id: z.string(),
  label: z.string(),
  note: z.string().optional(),
  /** output_config.effort 지원 여부 — false면 BFF가 effort를 빼고 호출한다 (예: haiku) */
  supportsEffort: z.boolean(),
})
export type AdminModelOption = z.infer<typeof AdminModelOption>

export const AdminModelWire = z.object({
  /** 지금 생성에 쓰이는 모델 (설정값 또는 기본값) */
  current: z.string(),
  /** 설정이 없을 때의 코드 기본값 */
  defaultModel: z.string(),
  /** 설정 저장소에서 읽은 원본 값 — 없으면 null (= 기본값 사용 중) */
  configured: z.string().nullable(),
  options: z.array(AdminModelOption),
})
export type AdminModelWire = z.infer<typeof AdminModelWire>

export const PutAdminModelBody = z.object({
  /** 카탈로그에 있는 모델 id — null이면 설정을 지우고 기본값으로 되돌린다 */
  model: z.string().nullable(),
})
export type PutAdminModelBody = z.infer<typeof PutAdminModelBody>
