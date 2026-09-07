/* 워크스페이스 상태 API — 원본은 api/state.js (Vercel 함수, Neon 전용).
   여기서는 저장소를 StateService 가 쥐고, 이 컨트롤러는 그 위에
   원본과 같은 요청/응답 계약만 구현한다. 응답 JSON 의 모양·키 이름은 FE(hooks/remote/)가
   그대로 기대하므로 절대 바꾸지 않는다 — 주석 상단 문서는 api/state.js 를 그대로 참고. */
import { Body, Controller, Delete, Get, Patch, Post, Put, Query, Res } from '@nestjs/common'
import { StateService } from './state.service'
import {
  bootWantedKeys,
  isValidKey,
  normalizeBootId,
  parseKeysParam,
  pickBootFallbackKey,
} from './state-logic'

/* express 타입 패키지(@types/express)가 리포에 없어 Response 를 any 로 받는다 —
   @Res() 로 상태 코드·헤더를 원본(api/state.js)과 똑같이 통제하려는 목적뿐이라
   무해하다 (tagging.controller.ts 는 @Res() 를 안 쓰므로 이 문제가 없었다). */
type ResLike = any

function toRowMap(rows: { key: string; data: unknown; updatedAt: unknown }[]) {
  const out: Record<string, { data: unknown; updatedAt: unknown }> = {}
  for (const r of rows) out[r.key] = { data: r.data, updatedAt: r.updatedAt }
  return out
}

@Controller('state')
export class StateController {
  constructor(private readonly state: StateService) {}

  @Get()
  async get(@Query() query: Record<string, unknown>, @Res() res: ResLike) {
    try {
      const store = this.state.store()
      const { key, keys, index, boot } = query

      if (index) {
        const rows = await store.listIndex()
        res.status(200).json(rows.map((r) => ({ key: r.key, updatedAt: r.updatedAt })))
        return
      }

      if (boot !== undefined) {
        const all = await store.listIndex()
        const allKeys = all.map((r) => r.key)
        const bootId = normalizeBootId(boot)
        const wanted = bootWantedKeys(bootId, allKeys)
        let rows = await store.getMany(wanted)
        const fallback = pickBootFallbackKey(rows, allKeys, rows.find((r) => r.key === 'accounts-meta')?.data)
        if (fallback) rows = rows.concat(await store.getMany([fallback]))
        res.status(200).json({
          index: all.map((r) => ({ key: r.key, updatedAt: r.updatedAt })),
          rows: toRowMap(rows),
        })
        return
      }

      if (keys) {
        const parsed = parseKeysParam(keys)
        if (!parsed.ok) {
          res.status(400).json({ error: '알 수 없는 keys 형식이에요. (쉼표 구분, 최대 32개)' })
          return
        }
        const rows = await store.getMany(parsed.list)
        res.status(200).json(toRowMap(rows))
        return
      }

      if (key) {
        if (!isValidKey(key)) {
          res.status(400).json({ error: '알 수 없는 key 형식이에요.' })
          return
        }
        const rows = await store.getMany([key])
        res.status(200).json(toRowMap(rows))
        return
      }

      const rows = await store.getMany((await store.listIndex()).map((r) => r.key))
      res.status(200).json(toRowMap(rows))
    } catch (e) {
      this.fail(res, e)
    }
  }

  @Put()
  async put(@Body() body: unknown, @Res() res: ResLike) {
    await this.upsert(body, res)
  }

  @Post()
  async post(@Body() body: unknown, @Res() res: ResLike) {
    await this.upsert(body, res)
  }

  private async upsert(body: unknown, res: ResLike) {
    try {
      const { key, data } = (body as { key?: unknown; data?: unknown }) || {}
      if (!isValidKey(key) || data === undefined) {
        res.status(400).json({ error: 'key와 data가 필요해요. (삭제는 data: null)' })
        return
      }
      const store = this.state.store()
      if (data === null) {
        await store.del(key)
        res.status(200).json({ ok: true, deleted: true })
        return
      }
      await store.put(key, data)
      res.status(200).json({ ok: true })
    } catch (e) {
      this.fail(res, e)
    }
  }

  /* 그 밖 메서드 → 405 (원본과 같은 Allow 헤더). Nest 는 메서드 데코레이터를 하나만
     반영하므로(둘을 겹쳐 달면 나중에 적용된 것만 남는다) 핸들러를 따로 둔다. */
  @Delete()
  notAllowedDelete(@Res() res: ResLike) {
    this.notAllowed(res)
  }

  @Patch()
  notAllowedPatch(@Res() res: ResLike) {
    this.notAllowed(res)
  }

  private notAllowed(res: ResLike) {
    res.setHeader('Allow', 'GET, PUT, POST')
    res.status(405).json({ error: 'method not allowed' })
  }

  private fail(res: ResLike, e: unknown) {
    const status = typeof (e as any)?.getStatus === 'function' ? (e as any).getStatus() : 500
    const message = (e as any)?.message || String(e)
    res.status(status).json({ error: message })
  }
}
