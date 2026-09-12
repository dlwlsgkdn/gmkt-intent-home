import React, { useEffect, useRef, useState } from 'react'

/*
 * 크로스페이드 — stamp 가 바뀌면 이전 내용은 제자리에서 흐려지고 새 내용이 겹쳐 떠오른다(홈 인사말·추천 칩이
 * 기본값 → 개인화 결과로 바뀔 때). 층은 grid 한 칸에 겹쳐 쌓여(styles/home.css .sb-xfade) 전환 중 높이는 둘 중 큰 쪽이고,
 * 전환이 끝나면 새 층만 남는다. 현재 층은 언제나 최신 children 을 그리고(stamp 가 같아도 재렌더 반영), 떠나는 층은
 * 바뀌던 순간의 스냅샷을 든다. 첫 렌더는 애니메이션 없이 그대로.
 */
export default function CrossFade({ stamp, className = '', duration = 650, children }) {
  const [layers, setLayers] = useState(() => [{ key: stamp, node: children, state: 'idle' }])
  const prevRef = useRef(stamp)
  useEffect(() => {
    if (stamp === prevRef.current) return undefined
    prevRef.current = stamp
    setLayers((prev) => [
      ...prev.filter((layer) => layer.state !== 'leaving').map((layer) => ({ ...layer, state: 'leaving' })),
      { key: stamp, node: children, state: 'entering' },
    ])
    const timer = setTimeout(() => {
      setLayers((prev) => prev.filter((layer) => layer.state !== 'leaving').map((layer) => ({ ...layer, state: 'idle' })))
    }, duration)
    return () => clearTimeout(timer)
    // children 은 stamp 와 함께 바뀐다 — stamp 만 감시
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, duration])
  return (
    <div className={'sb-xfade' + (className ? ` ${className}` : '')}>
      {layers.map((layer) => (
        <div
          key={layer.key}
          className={'sb-xfade__layer' + (layer.state === 'leaving' ? ' is-leaving' : layer.state === 'entering' ? ' is-entering' : '')}
          aria-hidden={layer.state === 'leaving' ? 'true' : undefined}
        >
          {layer.key === stamp ? children : layer.node}
        </div>
      ))}
    </div>
  )
}
