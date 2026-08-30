import React, { useState, useRef, useEffect } from 'react'
import { db } from '../store/db.js'
import { getPersistence } from '../store/storageGuard.js'
import { runStorageDiagnostic } from '../store/storageDiag.js'

// 用户信条（来自用户本人，逐字呈现）
const CREED = '用最宝贵的东西——生命创造价值，度过幸福精彩的一生，不枉过这一生。睡前记录三类事，安排一段时间远离屏幕'

// ---- Zion 个人宣言（大关键词 + 小完整陈述，Editorial / Manifesto 排版；原文一字不改）----
// ⑥ 段：第一句为总纲，其余为战斗宣言；每块视觉各异形成节奏
function Manifesto() {
  return (
    <div className="card manifesto">
      <section className="mf-block mf-block--lead">
        <h1 className="mf-big">活在未来</h1>
        <p className="mf-small">长期主义，量化成果，进步记录，不是简单重复！</p>
      </section>

      <section className="mf-block">
        <div className="mf-big mf-big--md">惩罚愚蠢</div>
        <p className="mf-small">时间惩罚愚蠢时毫不留情。为了半年后的自己！！</p>
      </section>

      <section className="mf-block">
        <div className="mf-big mf-big--md">
          战争<span className="mf-accent"> · 抢</span>
        </div>
        <p className="mf-small">这是我的战争，把自己从那些软件里抢回来！</p>
      </section>

      <section className="mf-block">
        <div className="mf-years"><span>5年</span><i>/</i><span>10年</span></div>
        <p className="mf-small">现在浪费的时间日积月累，消耗的是未来5年，10年更好的生活，更好的发展</p>
      </section>

      <section className="mf-block">
        <div className="mf-words"><span>心气</span><span>意气</span><span>勇气</span></div>
        <p className="mf-small">我永远都不会丢掉我的心气，意气与勇气</p>
      </section>

      <section className="mf-block">
        <div className="mf-big mf-big--md">眼见为实</div>
        <p className="mf-small">去他妈的幸存者偏差，永远不甘失败不服输，做出改变让自己更强大，眼见为实。</p>
      </section>
    </div>
  )
}

function bmiOf(height, weight) {
  return height > 0 && weight > 0 ? weight / Math.pow(height / 100, 2) : 0
}
function bfOf(bmi, age, gender) {
  if (!bmi || !age) return null
  const base = 1.2 * bmi + 0.23 * age
  return gender === 'female' ? base - 5.4 : base - 16.2
}

export default function Me({ onBack, date }) {
  const settings = db.getSettings()
  const [proxyBase, setProxyBase] = useState(settings.wereadProxyBase || '')
  // 1.1.1：持久化存储保护状态（异步查询；任何环境不报错）
  const [persistence, setPersistence] = useState('unknown')
  useEffect(() => {
    let alive = true
    getPersistence().then((s) => { if (alive) setPersistence(s) }).catch(() => { if (alive) setPersistence('normal') })
    return () => { alive = false }
  }, [])
  // 1.1.2：一键存储诊断（只读，不修改任何数据）
  const [diag, setDiag] = useState(null)
  const [diagBusy, setDiagBusy] = useState(false)
  async function runDiag() {
    setDiagBusy(true)
    try {
      setDiag(await runStorageDiagnostic())
    } catch (e) {
      setDiag({ summary: '诊断异常：' + (e && e.message), lines: [] })
    } finally {
      setDiagBusy(false)
    }
  }
  const fileRef = useRef(null)
  function exportData() {
    const blob = new Blob([db.exportData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zion-backup-${date}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  function importData(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        // P1：导入前自动备份当前数据 + 校验 + 失败自动回滚
        db.importData(String(reader.result))
        if (typeof window !== 'undefined') window.location.reload()
      } catch (err) {
        alert('恢复失败（原数据已自动保留）：' + (err && err.message ? err.message : '文件格式不正确'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }
  function restoreLastBackup() {
    try {
      db.restoreLastBackup()
      alert('已恢复上一次备份，正在刷新…')
      if (typeof window !== 'undefined') window.location.reload()
    } catch (err) {
      alert('恢复失败：' + (err && err.message ? err.message : '没有可用备份'))
    }
  }

  return (
    <div className="page me-page">
      {/* 极简头部 */}
      <div className="me-top">
        <div className="me-brand">zion</div>
        <div className="me-date">{date}</div>
      </div>

      {/* Zion 个人宣言（大关键词 + 小陈述；一进来就是宣言，无打卡展示） */}
      <Manifesto />

      {/* 人生信条 */}
      <div className="me-creed">
        <p>{CREED}</p>
      </div>

      {/* 数据备份：导出到本机 / 从备份恢复 */}
      <div className="card data-tools">
        <div className="card-title">数据备份</div>
        <p className="muted">数据仅存于本机浏览器。建议定期导出备份，换手机或清缓存后可用备份恢复。</p>
        {/* 1.1.1：存储保护状态 + 备份状态（持久化保护 ≠ 备份） */}
        {(() => {
          const last = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('zion-last-backup-at') : 0) || 0
          const lastText = last > 0 ? new Date(last).toLocaleDateString('zh-CN') : null
          const days = last > 0 ? Math.floor((Date.now() - last) / 86400000) : -1
          const pMap = {
            persisted: ['已获得持久化保护 ✅', '浏览器已为 Zion 的站点存储提供持久化保护，可降低因浏览器自动清理导致的数据丢失风险。'],
            normal: ['普通模式 ⚠️', '当前浏览器未授予持久化存储保护，建议定期导出备份。'],
            unsupported: ['当前浏览器不支持', '当前浏览器不支持该存储保护能力，请依赖定期备份。'],
            unknown: ['检测中…', ''],
          }
          const p = pMap[persistence] || pMap.unknown
          return (
            <div className="storage-status">
              <div className={'storage-status__row' + (persistence === 'persisted' ? ' is-ok' : persistence === 'normal' ? ' is-warn' : '')}>
                数据存储：{p[0]}
                {p[1] && <span className="storage-status__desc"> {p[1]}</span>}
              </div>
              <div className={'storage-status__row' + (lastText ? ' is-ok' : ' is-warn')}>
                上次备份：{lastText || '尚未备份 ⚠️'}
                <span className="storage-status__desc"> 持久化保护不等于备份，请定期导出。</span>
              </div>
              {days >= 7 && <div className="backup-remind">距上次导出备份已 {days} 天，建议现在导出</div>}
              {last === 0 && <div className="backup-remind backup-remind--new">数据仅存在本机，建议先导出一份备份</div>}
            </div>
          )
        })()}
        <div className="task-add">
          <button className="task-add__btn" onClick={exportData}>导出备份</button>
          <button
            className="task-add__btn"
            style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' }}
            onClick={() => fileRef.current && fileRef.current.click()}
          >恢复备份</button>
          <button
            className="task-add__btn"
            style={{ background: 'transparent', color: 'var(--accent, #2b6cff)', border: '1px solid var(--accent, #2b6cff)' }}
            onClick={runDiag}
            disabled={diagBusy}
          >{diagBusy ? '诊断中…' : '存储诊断（持久化）'}</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importData} />
        </div>
      </div>

      {/* 微信读书代理（高级）：纯静态部署下 weread 需经代理转发 */}
      <div className="card data-tools">
        <div className="card-title">微信读书代理（高级）</div>
        <p className="muted">微信读书需经代理转发（绕开跨域）。三种方式任选：① 电脑运行 <code>npm run serve</code> 后用同一 WiFi 的手机打开（自动生效）；② 把项目里的 <code>weread-proxy-worker.js</code> 粘贴到 Cloudflare Workers（免费，2 分钟），将得到的 <code>*.workers.dev</code> 地址填这里；③ 自有可访问的代理地址填这里。填好后回到读书栏点「重新同步」即可连接。</p>
        <input
          className="book-input"
          placeholder="代理地址，留空用默认"
          value={proxyBase}
          onChange={(e) => { setProxyBase(e.target.value); db.setSettings({ wereadProxyBase: e.target.value }) }}
        />
      </div>

      <div className="me-foot">—— 不枉过这一生 ——</div>

      {diag && (
        <div className="diag-mask" onClick={() => setDiag(null)}>
          <div className="diag-box" onClick={(e) => e.stopPropagation()}>
            <div className="diag-box__title">
              存储诊断（持久化）
              <span className="diag-box__close" onClick={() => setDiag(null)}>×</span>
            </div>
            <div className="diag-box__summary">{diag.summary}</div>
            <div className="diag-box__lines">
              {diag.lines.map((it, i) => (
                <div className="diag-line" key={i}>
                  <span className="diag-line__k">{it[0]}</span>
                  <span className="diag-line__v">{it[1]}</span>
                </div>
              ))}
            </div>
            <div className="diag-box__tip">仅读取，未修改任何数据。截图保存即可。</div>
          </div>
        </div>
      )}
    </div>
  )
}
