import React from 'react'

// 未实现模块的占位页：让入口可点开，避免 404/空白
function DraftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M8 8h8M8 12h8M8 16h4" />
    </svg>
  )
}

export default function Placeholder({ label }) {
  return (
    <div className="page">
      <div className="card placeholder-card">
        <div className="card-title">{label}</div>
        <div className="placeholder-body">
          <div className="placeholder-illus"><DraftIcon /></div>
          <div className="placeholder-badge">建设中</div>
          <p className="muted">{label}模块正在开发，敬请期待。</p>
        </div>
      </div>
    </div>
  )
}
