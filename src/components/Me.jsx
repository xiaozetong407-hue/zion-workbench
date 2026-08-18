import React, { useState, useRef } from 'react'
import { db } from '../store/db.js'
import { monthKey } from '../utils/date.js'

// 用户信条（来自用户本人，逐字呈现）
const CREED = '用最宝贵的东西——生命创造价值，度过幸福精彩的一生，不枉过这一生。睡前记录三类事，安排一段时间远离屏幕'

const MANTRAS = [
  '时间惩罚愚蠢时毫不留情。为了半年后的自己！！',
  '这是我的战争，把自己从那些软件里抢回来！',
  '现在浪费的时间日积月累，消耗的是未来5年，10年更好的生活，更好的发展',
  '去他妈的幸存者偏差',
  '我永远都不会丢掉我的心气，意气与勇气',
]

const STUDY_TRACKS = [
  { key: 'job', label: '求职' },
  { key: 'media', label: '自媒体' },
  { key: 'english', label: '英语' },
  { key: 'korean', label: '韩语' },
]

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
  const s = db.getStatus(date) || {}
  const ledger = db.getLedger()
  const books = db.getBooks()
  const checkIn = db.getCheckIn(date) || {}
  const tasks = db.getTasks(date)
  const plans = (db.get() || {}).studyPlans || {}

  const height = Number(settings.height) || 0
  const weight = Number(s.weight) || 0
  const age = Number(settings.age) || 0
  const gender = settings.gender || 'male'
  const bmi = bmiOf(height, weight)
  const bf = bfOf(bmi, age, gender)

  const month = monthKey(date)
  const monthItems = ledger.filter((it) => monthKey(it.date) === month)
  const expTotal = monthItems.filter((it) => it.type === 'exp').reduce((a, it) => a + it.amount, 0)
  const incTotal = monthItems.filter((it) => it.type === 'inc').reduce((a, it) => a + it.amount, 0)

  const reading = books.find((b) => b.progress > 0 && b.progress < 100)
  const doneTasks = tasks.filter((t) => t.done).length
  const studyRows = STUDY_TRACKS.map((t) => {
    const p = plans[t.key] || {}
    const ms = p.milestones || []
    const done = ms.filter((m) => m.done).length
    return { label: t.label, done, total: ms.length }
  })

  const checkItems = db.CHECKIN_ITEMS || []
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

      {/* 今日概览：关联状态栏核心数据 */}
      <div className="me-overview">
        <div className="me-ov-cell"><span>睡眠</span><b>{s.sleepHours ? s.sleepHours + 'h' : '—'}</b></div>
        <div className="me-ov-cell"><span>步数</span><b>{s.steps || '—'}</b></div>
        <div className="me-ov-cell"><span>运动</span><b>{s.exerciseMin ? s.exerciseMin + 'h' : '—'}</b></div>
        <div className="me-ov-cell"><span>卡路里</span><b>{s.calories || '—'}</b></div>
      </div>

      {/* 身体指标 + 今日打卡 */}
      <div className="me-bodies">
        <div className="me-body"><span>BMI</span><b>{bmi > 0 ? bmi.toFixed(1) : '—'}</b></div>
        <div className="me-body"><span>体脂率</span><b>{bf ? bf.toFixed(1) + '%' : '—'}</b></div>
        <div className="me-checks">
          {checkItems.map((c) => (
            <span key={c.key} className={'me-cdot' + (checkIn[c.key] ? ' on' : '')} title={c.label}>{c.short}</span>
          ))}
        </div>
      </div>

      {/* 关联概览：来自账本 / 读书 / 学习 / 任务 */}
      <div className="me-links">
        <div className="me-link">
          <span className="me-link__k">账本</span>
          <span className="me-link__v">月支出 <b>¥{expTotal.toFixed(0)}</b> · 月收入 <b>¥{incTotal.toFixed(0)}</b></span>
        </div>
        <div className="me-link">
          <span className="me-link__k">读书</span>
          <span className="me-link__v">{reading ? `${reading.title} ${reading.progress}%` : '—'}</span>
        </div>
        <div className="me-link">
          <span className="me-link__k">学习</span>
          <span className="me-link__v">
            {studyRows.map((r) => (
              <span key={r.label} className="me-study">{r.label}{r.total ? ` ${r.done}/${r.total}` : ''}</span>
            ))}
          </span>
        </div>
        <div className="me-link">
          <span className="me-link__k">任务</span>
          <span className="me-link__v">{tasks.length ? <>今日完成 <b>{doneTasks}/{tasks.length}</b></> : '暂无任务'}</span>
        </div>
      </div>

      {/* 人生信条 */}
      <div className="me-creed">
        <p>{CREED}</p>
      </div>

      {/* 自我激励（统一左侧样式） */}
      <div className="me-mantras">
        {MANTRAS.map((m, i) => (
          <div key={i} className="me-mantra">
            <p className="me-mantra__text">{m}</p>
          </div>
        ))}
      </div>

      {/* 数据备份：导出到本机 / 从备份恢复 */}
      <div className="card data-tools">
        <div className="card-title">数据备份</div>
        <p className="muted">数据仅存于本机浏览器。建议定期导出备份，换手机或清缓存后可用备份恢复。</p>
        <div className="task-add">
          <button className="task-add__btn" onClick={exportData}>导出备份</button>
          <button
            className="task-add__btn"
            style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' }}
            onClick={() => fileRef.current && fileRef.current.click()}
          >恢复备份</button>
          <button
            className="task-add__btn"
            style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' }}
            onClick={restoreLastBackup}
          >恢复上一次备份</button>
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
    </div>
  )
}
