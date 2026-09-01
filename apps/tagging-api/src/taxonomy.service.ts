import { Injectable } from '@nestjs/common'
import { readFileSync, statSync } from 'node:fs'

/* 사전의 원천은 Python 저장소의 taxonomy.json이다(그쪽 /taxonomy 승격이 이 파일에 쓴다).
   사본을 만들면 조용히 갈라지므로 경로로 읽고 mtime이 바뀔 때만 다시 읽는다. */
@Injectable()
export class TaxonomyService {
  private cache: { mtimeMs: number; data: unknown } | null = null

  read(): unknown | null {
    const path = process.env.TAXONOMY_PATH
    if (!path) return null
    try {
      const { mtimeMs } = statSync(path)
      if (this.cache?.mtimeMs === mtimeMs) return this.cache.data
      const data = JSON.parse(readFileSync(path, 'utf8'))
      this.cache = { mtimeMs, data }
      return data
    } catch (err) {
      console.error('[taxonomy] 읽기 실패:', (err as Error).message)
      return null
    }
  }
}
