import React from 'react'

// React 运行时错误边界（架构收尾）：任何渲染异常不再直接白屏。
// 仅捕获渲染期错误；数据仍安全保存在本机，不会因异常被改写。
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[zion] ErrorBoundary 捕获异常：', error, info)
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error
      return (
        <div className="recovery-screen">
          <div className="recovery-card">
            <div className="recovery-title">界面出错（数据安全）</div>
            <p className="recovery-desc">
              页面渲染时发生异常，已暂停界面以防止误写数据。
              你的数据仍安全保存在本机浏览器中。
            </p>
            <div className="recovery-err">
              错误：{err && err.message ? err.message : String(err)}
            </div>
            <div className="recovery-actions">
              <button className="primary" onClick={() => window.location.reload()}>
                刷新重试
              </button>
              <button
                className="primary"
                onClick={() => {
                  try {
                    // 极端兜底：仅重置 UI 状态类缓存（非业务数据），然后重载
                    localStorage.removeItem('zion-tab')
                  } catch { /* ignore */ }
                  window.location.reload()
                }}
              >
                重置界面后重试
              </button>
            </div>
            <div className="recovery-foot muted">
              若反复出现，请在「我 → 数据备份」中导出备份；数据不会被本页面删除或修改。
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
