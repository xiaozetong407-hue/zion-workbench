import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import RecoveryScreen from './components/RecoveryScreen.jsx'
import DataLossScreen from './components/DataLossScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { db } from './store/db.js'
import { hasUsageTraces, requestPersist } from './store/storageGuard.js'
import './styles.css'

// 启动门禁（P1 硬性约束 C + 1.1.1 数据可靠性升级）：
//   - 先安全加载并校验业务数据
//   - 加载失败 -> 渲染 RecoveryScreen（导出原始/导入备份/恢复上一次备份/重试），
//     绝不渲染主 App、绝不执行 ensureSeed、绝不生成默认数据
//   - 加载成功 -> 显式执行 ensureSeed（纳入统一安全写边界）后再渲染主 App
//   - 1.1.1：数据为空 + 检测到使用痕迹 -> 不再静默 seed，渲染 DataLossScreen
//     （区分「真正首次使用」与「疑似历史数据被浏览器清除」，宁可多提醒也不静默覆盖）
function Root() {
  const [boot, setBoot] = useState(() => {
    const b = db.bootstrap()
    if (b.ok) {
      const blank = !b.data || Object.keys(b.data).length === 0
      if (blank && hasUsageTraces()) {
        // 疑似历史数据丢失：绝不自动 seed，交由用户选择（恢复备份 / 空白开始）
        return { ok: true, dataLoss: true, data: b.data }
      }
      try {
        db.ensureSeed()
      } catch (e) {
        // 数据已加载成功；seed 失败不阻塞进入主应用（仅记录）
        console.warn('[zion] ensureSeed 失败（不影响已有数据）：', e)
      }
    }
    return b
  })

  // 1.1.1：启动时请求持久化存储保护（后台执行，不阻塞、不抛错；降低浏览器自动清理风险）
  useEffect(() => {
    requestPersist().catch(() => {})
  }, [])

  if (!boot.ok) {
    return <RecoveryScreen error={boot.error} onRetry={() => setBoot(db.bootstrap())} />
  }

  // 数据异常恢复提示：用户完成「恢复备份 / 空白开始」后重新走启动门禁
  if (boot.dataLoss) {
    return <DataLossScreen onReady={() => setBoot(db.bootstrap())} />
  }

  return <App />
}

// ErrorBoundary 包在最外层：运行时渲染异常也不白屏（架构收尾）
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
)
