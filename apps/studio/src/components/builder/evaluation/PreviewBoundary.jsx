import React from 'react'

/* 케이스 페이지 실제 렌더의 에러 경계 — 컴포넌트 하나가 깨져도 평가는 계속된다 */
export default class PreviewBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(previousProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="sb-qa-live-preview__fallback">
          이 컴포넌트의 미리보기를 표시할 수 없습니다. 평가는 계속할 수 있어요.
        </div>
      )
    }
    return this.props.children
  }
}
