/* 클립보드 복사 — Clipboard API가 막힌 환경(비-HTTPS 등)에서는 임시 textarea로 폴백.
   권한이 없거나 실패하면 false를 돌려주고, 호출부가 "직접 복사해주세요" 안내를 띄운다. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
    return true
  } catch {
    return false
  }
}
