import { Injectable, Logger } from '@nestjs/common'
import { ImageEditError, type ImageEditPort, type ImageEditRequest, type ImageEditResult } from '@ddak/pipeline'

/*
 * ImageEditPort의 1차 구현 — OpenAI images.edits (gpt-image 계열).
 *
 * 왜 여기만 다른 프로바이더인가: Anthropic API에는 이미지 편집·생성이 없다(이미지는 입력으로
 * 읽기만 한다). 그래서 "룩을 실제로 발라 보여주는" 이 한 가지만 다른 프로바이더를 쓰고,
 * 나머지 생성 파이프라인은 그대로 Claude다. 계약(ImageEditPort)이 중립이라 교체는 이 파일만 바꾼다.
 *
 * 키(OPENAI_API_KEY)가 없으면 image_not_configured — 호출부는 이 상태를 정상 상태로 다룬다
 * (정밀 렌더는 부가 기능이고, 화면에는 기기 안에서 만든 랜드마크 합성이 이미 떠 있다).
 */

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MODEL = 'gpt-image-2'
/** 편집은 복잡한 지시문에서 최대 2분까지 걸린다(문서 기준) — 넉넉히 잡되 무한정 기다리지 않는다 */
const TIMEOUT_MS = 150_000

@Injectable()
export class ImageEditService implements ImageEditPort {
  private readonly logger = new Logger(ImageEditService.name)

  get configured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY)
  }

  async edit(req: ImageEditRequest): Promise<ImageEditResult> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new ImageEditError(
        'image_not_configured',
        '정밀 렌더가 아직 준비되지 않았어요. 지금은 기기에서 만든 미리보기로 보여드릴게요.',
        false,
      )
    }
    const baseUrl = process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL
    const model = process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL

    const bytes = Buffer.from(req.imageBase64, 'base64')
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', req.prompt)
    form.append('image', new Blob([bytes], { type: req.mediaType }), `photo.${extOf(req.mediaType)}`)

    const startedAt = Date.now()
    let res: Response
    try {
      res = await fetch(`${baseUrl}/v1/images/edits`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      throw new ImageEditError('image_failed', '정밀 렌더 요청이 끝나지 않았어요. 잠시 후 다시 시도해 주세요.', true)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      this.logger.warn(`이미지 편집 실패 ${res.status}: ${text.slice(0, 400)}`)
      // 4xx는 요청 자체가 거절된 것(정책·형식·모델 접근) — 재시도해도 같다. 5xx·429만 재시도 가치가 있다
      const retryable = res.status >= 500 || res.status === 429
      throw new ImageEditError(
        retryable ? 'image_failed' : 'image_refused',
        retryable
          ? '정밀 렌더 서버가 잠시 바빠요. 조금 뒤에 다시 시도해 주세요.'
          : '이 사진으로는 정밀 렌더를 만들지 못했어요. 기기에서 만든 미리보기로 보여드릴게요.',
        retryable,
        `HTTP ${res.status} — ${summarizeUpstream(text)}`,
      )
    }
    const json = (await res.json()) as { data?: { b64_json?: string }[] }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) {
      throw new ImageEditError('image_failed', '정밀 렌더 결과를 받지 못했어요. 다시 시도해 주세요.', true)
    }
    return {
      imageBase64: b64,
      mediaType: 'image/png',
      meta: { model, latencyMs: Date.now() - startedAt },
    }
  }
}

/** 프로바이더 오류 본문 → 한 줄 요약. JSON이면 error.message만, 아니면 앞부분만 자른다 */
function summarizeUpstream(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } }
    const e = json.error
    if (e?.message) return [e.message, e.code, e.type].filter(Boolean).join(' · ').slice(0, 300)
  } catch {
    /* JSON이 아니면 원문 */
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function extOf(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}
