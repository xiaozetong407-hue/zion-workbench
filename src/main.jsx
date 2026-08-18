import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import RecoveryScreen from './components/RecoveryScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { db } from './store/db.js'
import './styles.css'

// 启动门禁（P1 硬性约束 C）：
//   - 先安全加载并校验业务数据
//   - 加载失败 -> 渲染 RecoveryScreen（导出原始/导入备份/恢复上一次备份/重试），
//     绝不渲染主 App、绝不执行 ensureSeed、绝不生成默认数据
//   - 加载成功 -> 显式执行 ensureSeed（纳入统一安全写边界）后再渲染主 App
function Root() {
  const [boot, setBoot] = useState(() => {
    const b = db.bootstrap()
    if (b.ok) {
      try {
        db.ensureSeed()
      } catch (e) {
        // 数据已加载成功；seed 失败不阻塞进入主应用（仅记录）
        console.warn('[zion] ensureSeed 失败（不影响已有数据）：', e)
      }
    }
    return b
  })

  if (!boot.ok) {
    return <RecoveryScreen error={boot.error} onRetry={() => setBoot(db.bootstrap())} />
  }

  return <App />
}

// ErrorBoundary 包在最外层：运行时渲染异常也不白屏（架构收尾）
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
)
