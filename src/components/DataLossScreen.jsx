import React, { useRef, useState } from 'react'
import { db } from '../store/db.js'

// 数据异常恢复提示（1.1.1）：仅在「本地正式数据不存在 + 检测到过去使用痕迹」时渲染。
// 硬性约束（与 RecoveryScreen 同一纪律）：
//   - 绝不自动执行 ensureSeed / 绝不静默生成默认数据覆盖现状
//   - 只有用户明确选择「继续使用空白数据」才初始化；明确选择「恢复」才写数据
//   - 导入走 db.importData()（内部自动备份 + 校验 + 失败自动回滚）
export default function DataLossScreen({ onReady }) {
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  function importFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setBusy(true)
        db.importData(String(reader.result))
        setMsg('备份已恢复，正在进入工作台…')
        setTimeout(() => onReady && onReady(), 400)
      } catch (err) {
        setMsg('导入失败（当前状态未被破坏）：' + (err && err.message ? err.message : '未知错误'))
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
      setMsg('已恢复上一次备份，正在进入工作台…')
      setTimeout(() => onReady && onReady(), 400)
    } catch (err) {
      setMsg('恢复失败：' + (err && err.message ? err.message : '没有可用备份，请选择「导入备份」'))
    } finally {
      setBusy(false)
    }
  }

  function startFresh() {
    try {
      setBusy(true)
      db.ensureSeed()
      setMsg('已按空白状态初始化，正在进入工作台…')
      setTimeout(() => onReady && onReady(), 400)
    } catch (err) {
      setMsg('初始化失败：' + (err && err.message ? err.message : err))
      setBusy(false)
    }
  }

  return (
    <div className="recovery-screen">
      <div className="recovery-card">
        <div className="recovery-title">检测到本地数据异常</div>
        <p className="recovery-desc">
          Zion 没有找到原有的数据文件，但检测到本浏览器曾有使用记录。
          这可能是浏览器清理站点数据导致的（Zion 的数据默认保存在本机浏览器中）。
          <br />
          <b>请先检查备份文件，再选择继续：</b>若你导出过 JSON 备份，选择「导入备份」即可完整找回。
        </p>

        <div className="recovery-actions">
          <button className="primary" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
            导入备份（推荐）
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
          <button className="primary" onClick={startFresh} disabled={busy}>
            继续使用空白数据
          </button>
        </div>

        {msg && <div className="recovery-msg">{msg}</div>}
        <div className="recovery-foot muted">
          此页面不会自动覆盖或初始化任何数据；导入失败会自动回滚。选择「继续使用空白数据」前，请确认无需恢复备份。
        </div>
      </div>
    </div>
  )
}
