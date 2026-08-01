import React from 'react'

/*
 * AI 다이얼로그 머리말 배지 — "여기서 만들어지지 않는다"를 첫 화면에서 못 박는다.
 *
 * 버튼에 ✦를 달고 "만들기"라고 적어 두면 누르는 순간 결과가 나올 것처럼 읽힌다.
 * 실제로는 프롬프트를 들고 밖으로 나갔다 와야 하므로, 그 사실을 숨기지 않는 게
 * 기다리다 실망하는 것보다 낫다. 세 AI 다이얼로그가 같은 문구를 쓴다.
 */
export default function AiRoundTripNote({ children }) {
  return (
    <p className="sb-ai-note">
      <span className="sb-ai-note__mark" aria-hidden="true">⇄</span>
      <span>
        <b>스튜디오는 AI를 호출하지 않아요.</b>{' '}
        {children || '프롬프트를 복사해 쓰던 AI에 붙여넣고, 받은 결과를 다시 가져오면 됩니다.'}
      </span>
    </p>
  )
}
