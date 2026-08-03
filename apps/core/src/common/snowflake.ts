/*
 * 스노우플레이크 threadId 생성기 — 64비트: [41b ms 타임스탬프][10b 워커][12b 시퀀스].
 * 분산환경 유니크 + 생성 시각순 정렬이 목적.
 *
 * 에포크를 2010-01-01로 둔 이유: 타임스탬프가 이미 1e18을 넘어 십진 문자열이
 * **항상 19자리 고정**이다 (41비트 소진 시점인 2079년경까지). 길이가 같으니 문자열
 * 사전순 정렬 = 숫자 정렬 = 시간순이라, DB·와이어 모두 text로 다뤄도 정렬이 안전하다.
 *
 * 워커 id는 SNOWFLAKE_WORKER_ID(0~1023)로 고정하거나, 서버리스처럼 인스턴스 식별자가
 * 없으면 콜드스타트마다 무작위 배정한다 — 같은 ms에 같은 워커 id가 뽑힐 확률만 충돌 여지로 남는다.
 */

const EPOCH = 1262304000000n // 2010-01-01T00:00:00Z
const WORKER_BITS = 10n
const SEQ_BITS = 12n
const MAX_WORKER = (1n << WORKER_BITS) - 1n // 1023
const MAX_SEQ = (1n << SEQ_BITS) - 1n // 4095 (ms당 4096개)

function resolveWorkerId(): bigint {
  const env = process.env.SNOWFLAKE_WORKER_ID
  if (env !== undefined && env !== '') {
    const n = Number(env)
    if (!Number.isInteger(n) || n < 0 || n > Number(MAX_WORKER)) {
      throw new Error(`SNOWFLAKE_WORKER_ID는 0~${MAX_WORKER} 정수여야 합니다: ${env}`)
    }
    return BigInt(n)
  }
  return BigInt(Math.floor(Math.random() * Number(MAX_WORKER + 1n)))
}

export class Snowflake {
  private lastMs = 0n
  private seq = 0n

  constructor(private readonly workerId: bigint = resolveWorkerId()) {}

  /** 19자리 십진 문자열 id — 사전순 정렬이 곧 생성 시각순 */
  next(): string {
    let now = BigInt(Date.now())
    if (now < this.lastMs) now = this.lastMs // 시계 역행 보정 — 같은 ms로 취급해 시퀀스로 흡수
    if (now === this.lastMs) {
      this.seq = (this.seq + 1n) & MAX_SEQ
      if (this.seq === 0n) {
        // ms당 4096개 소진 — 다음 ms까지 대기
        while (BigInt(Date.now()) <= this.lastMs) {
          /* spin */
        }
        now = BigInt(Date.now())
      }
    } else {
      this.seq = 0n
    }
    this.lastMs = now
    const id = ((now - EPOCH) << (WORKER_BITS + SEQ_BITS)) | (this.workerId << SEQ_BITS) | this.seq
    return id.toString()
  }
}

/** 프로세스(인스턴스)당 1개 — 시퀀스 상태를 공유해야 유니크가 보장된다 */
export const snowflake = new Snowflake()
