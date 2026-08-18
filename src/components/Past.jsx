import React, { useState } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { addDays, todayStr } from '../utils/date.js'

// 枚举 [from, to] 闭区间内的所有日期（含两端，安全上限 400 天）
function enumerateDates(from, to) {
  const out = []
  let d = from
  for (let i = 0; i < 400; i++) {
    out.push(d)
    if (d >= to) break
    d = addDays(d, 1)
  }
  return out
}

async function buildReport(kind, from, to) {
  const dates = enumerateDates(from, to)
  const n = dates.length
  const datesSet = new Set(dates)

  const checkIns = db.getAllCheckIns()
  const tasksAll = db.getAllTasks()
  const reviews = db.get().reviews || {}
  const statusAll = db.getAllStatus()
  const ledger = db.getLedger()

  // 打卡完成率
  const ciDates = dates.filter((d) => checkIns[d])
  const totalItems = db.CHECKIN_ITEMS.length
  const ciDone = ciDates.reduce(
    (s, d) => s + db.CHECKIN_ITEMS.filter((it) => checkIns[d][it.key]).length,
    0,
  )
  const ciTotal = ciDates.length * totalItems
  const ciRate = ciTotal ? Math.round((ciDone / ciTotal) * 100) : 0

  // 各项完成天数（具体 6 项分别统计）
  const ciItems = db.CHECKIN_ITEMS.map((it) => ({
    key: it.key,
    label: it.label,
    done: dates.filter((d) => checkIns[d] && checkIns[d][it.key]).length,
  }))

  // 每日打卡明细（6 项逐日）
  const dailyCI = dates.map((d) => {
    const ci = checkIns[d] || {}
    return {
      date: d,
      items: db.CHECKIN_ITEMS.map((it) => ({ key: it.key, short: it.short, done: !!ci[it.key] })),
    }
  })

  // 任务完成率
  const tasks = tasksAll.filter((t) => datesSet.has(t.date))
  const tDone = tasks.filter((t) => t.done).length
  const tTotal = tasks.length
  const tRate = tTotal ? Math.round((tDone / tTotal) * 100) : 0

  // 睡眠 / 步数 / 卡路里平均
  const st = dates.map((d) => statusAll[d]).filter(Boolean)
  const avgSleep = st.length ? (st.reduce((s, x) => s + Number(x.sleepHours || 0), 0) / st.length).toFixed(1) : '—'
  const avgSteps = st.length ? Math.round(st.reduce((s, x) => s + Number(x.steps || 0), 0) / st.length) : '—'
  const avgCal = st.length ? Math.round(st.reduce((s, x) => s + Number(x.calories || 0), 0) / st.length) : '—'

  // 账本
  const led = ledger.filter((l) => datesSet.has(l.date))
  const exp = led.filter((l) => l.type === 'exp').reduce((s, l) => s + l.amount, 0)
  const inc = led.filter((l) => l.type === 'inc').reduce((s, l) => s + l.amount, 0)
  const balance = inc - exp

  // 复盘（仅累计游戏时长入统计，不展示复盘天数）
  const revDates = dates.filter((d) => reviews[d])
  const topThings = revDates.map((d) => reviews[d].tomorrow).filter(Boolean)
  const gameMin = revDates.reduce((s, d) => s + Number(reviews[d].gameMinutes || 0), 0)

  return {
    kind,
    title: kind === 'week' ? '周报' : kind === 'month' ? '月报' : '自定义报告',
    period: `${from} ~ ${to}`,
    createdAt: Date.now(),
    metrics: {
      ciRate, ciDone, ciTotal,
      ciItems,
      tRate, tDone, tTotal,
      avgSleep, avgSteps, avgCal,
      exp, inc, balance,
      gameMin,
      days: n,
    },
    dailyCI,
    highlights: topThings.slice(0, 3),
  }
}

// 环形进度（纯 SVG，描边风格）
function Ring({ pct, color, label, sub }) {
  const r = 26
  const c = 2 * Math.PI * r
  const off = c * (1 - pct / 100)
  return (
    <div className="rep-ring">
      <svg viewBox="0 0 64 64" width="88" height="88" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#eef1f7" strokeWidth="7" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 32 32)"
        />
        <text x="32" y="32" textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="800" fill="var(--ink)">{pct}%</text>
      </svg>
      <div className="rep-ring__label">{label}</div>
      <div className="rep-ring__sub">{sub}</div>
    </div>
  )
}

function ReportViz({ r }) {
  // 兼容旧版（仅有 lines 文本）数据
  if (!r.metrics) {
    return (
      <div className="rep-viz">
        {r.lines.map((l, i) => (
          <div key={i} className="report-line">· {l}</div>
        ))}
        {r.highlights && r.highlights.length > 0 && (
          <div className="rep-hl">重点事项：{r.highlights.join(' / ')}</div>
        )}
      </div>
    )
  }
  const m = r.metrics
  return (
    <div className="rep-viz">
      <div className="rep-period">{r.period} · 覆盖 {m.days || '-'} 天</div>

      <div className="rep-rings">
        <Ring pct={m.ciRate} color="#4f7cff" label="打卡完成率" sub={`${m.ciDone}/${m.ciTotal} 项`} />
        <Ring pct={m.tRate} color="#27c08a" label="任务完成率" sub={`${m.tDone}/${m.tTotal} 条`} />
      </div>

      {/* 6 项打卡：各项完成率（完成天数/总天数） */}
      {m.ciItems && m.ciItems.length > 0 && (
        <div className="rep-ci-summary">
          {m.ciItems.map((it) => (
            <div className="rep-ci-sum" key={it.key}>
              <span className="rep-ci-sum__label">{it.label}</span>
              <span className="rep-ci-sum__val">{it.done}<i>/{m.days}</i></span>
            </div>
          ))}
        </div>
      )}

      {/* 每日打卡明细：仅周报 / 短区间（≤7 天）展示；月报等长区间折叠以免冗长 */}
      {r.dailyCI && r.dailyCI.length > 0 && m.days <= 7 && (
        <>
          <div className="rep-ci-title">每日打卡明细</div>
          <div className={'rep-ci-daily' + (m.days > 14 ? ' is-scroll' : '')}>
            {r.dailyCI.map((day) => (
              <div className="rep-ci-row" key={day.date}>
                <div className="rep-ci-date">{day.date.slice(5)}</div>
                <div className="rep-ci-items">
                  {day.items.map((it) => (
                    <span key={it.key} className={'rep-ci-chip' + (it.done ? ' is-done' : '')} title={it.label}>{it.short}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rep-stats is-3">
        <div className="rep-stat"><span>平均睡眠</span><b>{m.avgSleep} <i>小时</i></b></div>
        <div className="rep-stat"><span>平均步数</span><b>{m.avgSteps} <i>步</i></b></div>
        <div className="rep-stat"><span>平均卡路里</span><b>{m.avgCal} <i>kcal</i></b></div>
      </div>

      <div className="rep-stats is-3">
        <div className="rep-stat"><span>累计游戏</span><b>{m.gameMin} <i>分钟</i></b></div>
        <div className="rep-stat"><span>支出</span><b>¥{m.exp.toFixed(2)}</b></div>
        <div className="rep-stat"><span>收入</span><b>¥{m.inc.toFixed(2)}</b></div>
      </div>

      {r.highlights.length > 0 && (
        <div className="rep-hl">重点事项：{r.highlights.join(' / ')}</div>
      )}
    </div>
  )
}

export default function Past({ date }) {
  const [reports, setReports] = useState(db.getPastReports())
  useLive(() => setReports(db.getPastReports()))
  const [openId, setOpenId] = useState(null)
  const [genLoading, setGenLoading] = useState(false)
  // 默认区间：到昨天为止（今天数据尚未完成）；周报=最近 7 天 / 月报=最近 30 天
  const [start, setStart] = useState(() => addDays(addDays(todayStr(), -1), -6))
  const [end, setEnd] = useState(() => addDays(todayStr(), -1))

  async function buildAndSave(kind, from, to) {
    if (genLoading) return
    setGenLoading(true)
    try {
      const rep = await buildReport(kind, from, to)
      db.addPastReport(rep)
      setReports(db.getPastReports())
    } finally {
      setGenLoading(false)
    }
  }

  // 预设：周报 / 月报——区间末尾固定为昨天
  function genPreset(kind) {
    const yesterday = addDays(todayStr(), -1)
    const from = kind === 'week' ? addDays(yesterday, -6) : addDays(yesterday, -29)
    setStart(from)
    setEnd(yesterday)
    buildAndSave(kind, from, yesterday)
  }

  // 自定义区间：用当前起止日期生成
  function genCustom() {
    if (!start || !end) return
    if (start > end) { alert('开始日期不能晚于结束日期'); return }
    buildAndSave('custom', start, end)
  }

  return (
    <div className="page">
      <div className="card">
        <div className="card-title">生成报告</div>
        <div className="past-range">
          <label className="past-range__field">
            <span>开始</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="past-range__field">
            <span>结束</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="ledger-input">
          <button className="primary" onClick={() => genPreset('week')} disabled={genLoading}>
            {genLoading ? '生成中…' : '生成周报'}
          </button>
          <button className="primary" onClick={() => genPreset('month')} disabled={genLoading}>
            {genLoading ? '生成中…' : '生成月报'}
          </button>
        </div>
        <button className="past-custom" onClick={genCustom} disabled={genLoading}>
          {genLoading ? '生成中…' : '生成所选区间'}
        </button>
        <div className="muted">截止日期默认到前一天（今天数据尚未完成）。周报=最近 7 天、月报=最近 30 天，均到昨天为止；也可自选任意区间。</div>
      </div>

      <div className="card">
        <div className="card-title">历史报告（{reports.length}）</div>
        {reports.length === 0 && <div className="muted">还没有报告，点上面生成</div>}
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id} className="report-item">
              <button className="report-head-btn" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span className="report-title">{r.title} · {r.period}</span>
                <span className="report-caret">{openId === r.id ? '收起' : '查看'}</span>
              </button>
              {openId === r.id && (
                <div className="report-body">
                  <ReportViz r={r} />
                  <button className="ledger-del report-del" onClick={() => { db.deletePastReport(r.id); setReports(db.getPastReports()) }}>
                    删除此报告
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
