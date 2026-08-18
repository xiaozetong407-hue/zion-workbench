import React, { useRef, useState } from 'react'
import { db } from '../store/db.js'

// 数据恢复模式：仅在启动门禁（main.jsx）数据加载失败时渲染。
// 硬性隔离约束：
//   - 不依赖任何已解析成功的业务数据（JSON 损坏时也能渲染）
//   - 绝不触发 ensureSeed / 默认数据生成 / 普通业务初始化
//   - 导出原始数据直接读取 localStorage.getItem('zion-data-v1')（一字不改）
//   - 导入 / 恢复均走 db.importData()（内部自动备份 + 校验 + 失败回滚）
const RAW_KEY = 'zion-data-v1'

export default function RecoveryScreen({ error, onRetry }) {
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  function exportRaw() {
    try {
      const raw = localStorage.getItem(RAW_KEY)
      if (raw == null) {
        setMsg('未找到本地原始数据（可能为空库）')
        return
      }
      const blob = new Blob([raw], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zion-raw-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg('原始数据已导出（未经任何修改）。请妥善保存后，再尝试导入/重试。')
    } catch (e) {
      setMsg('导出失败：' + (e && e.message ? e.message : e))
    }
  }

  function importFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setBusy(true)
        db.importData(String(reader.result))
        setMsg('导入成功。点击「重试」重新进入应用。')
      } catch (err) {
        setMsg('导入失败（原数据已自动恢复）：' + (err && err.message ? err.message : '未知错误'))
      } finally {
        setBusy(false)
      }
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  function restoreLast() {
    try {
      setBusy(true)
      db.restoreLastBackup()
      setMsg('已恢复上一次备份。点击「重试」重新进入应用。')
    } catch (err) {
      setMsg('恢复失败：' + (err && err.message ? err.message : '没有可用备份'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="recovery-screen">
      <div className="recovery-card">
        <div className="recovery-title">数据恢复模式</div>
        <p className="recovery-desc">
          本地数据未能正常加载，为保护数据，已暂停进入工作台。
          请先导出原始数据妥善保存，或导入备份后重试。
          <br />
          <span className="recovery-err">原因：{error && error.message ? error.message : String(error)}</span>
        </p>

        <div className="recovery-actions">
          <button className="primary" onClick={exportRaw} disabled={busy}>
            导出原始数据
          </button>
          <button className="primary" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
            导入备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={importFile}
          />
          <button className="primary" onClick={restoreLast} disabled={busy}>
            恢复上一次备份
          </button>
          <button className="primary" onClick={onRetry} disabled={busy}>
            重试
          </button>
        </div>

        {msg && <div className="recovery-msg">{msg}</div>}
        <div className="recovery-foot muted">
          此页面不会修改、删除或覆盖任何本地数据；导入失败会自动回滚到导入前的状态。
        </div>
      </div>
    </div>
  )
}
