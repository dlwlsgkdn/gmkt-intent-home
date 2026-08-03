/* 브라우저 파일 입출력 유틸 — JSON 내보내기 다운로드와 파일 텍스트 읽기.
   가져온 내용의 파싱·분류는 여기 소관이 아니다 (store/persistence.js의 classifyImportPayload 등). */

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('파일을 읽을 수 없음'))
    reader.readAsText(file)
  })
}
