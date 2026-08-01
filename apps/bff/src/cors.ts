/** ALLOWED_ORIGINS(쉼표 구분)이 있으면 그 오리진만, 없으면 전부 허용(개발 편의) */
export function corsOptions() {
  const raw = (process.env.ALLOWED_ORIGINS ?? '').trim()
  const origins = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : true
  return { origin: origins, credentials: false }
}
