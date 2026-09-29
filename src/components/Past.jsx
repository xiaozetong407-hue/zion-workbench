import React, { useState } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { addDays, todayStr } from '../utils/date.js'
import { buildReport } from '../utils/report.js'
import DateRangePicker from './DateRangePicker.jsx'

// 「YYYY-MM-DD」-> 拆分展示所需片段（报告列表用）
function parts(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), day: String(d.getDate()).padStart(2, '0') }
}

// 报告区间 "from ~ to" -> { from, to }
function parsePeriod(period) {
  if (!period) return { from: '', to: '' }
  const [a, b] = period.split('~').map((s) => (s || '').trim())
  return { from: a, to: b || a }
}

// 报告类型 -> 徽标字符（周 / 月 / 自）与配色键
function kindMeta(r) {
  const k = r.kind || (r.title === '周报' ? 'week' : r.title === '月报' ? 'month' : 'custom')
  if (k === 'week') return { key: 'week', char: '周' }
  if (k === 'month') return { key: 'month', char: '月' }
  return { key: 'custom', char: '自' }
}

function cnDate(dateStr) {
  const p = parts(dateStr)
  return p ? `${p.m}月${p.d}日` : ''
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
  const [pickerOpen, setPickerOpen] = useState(false)
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
    if (start > end) return
    buildAndSave('custom', start, end)
  }

  // 区间选择器确认：一次回填开始与结束
  function applyRange(from, to) {
    setStart(from)
    setEnd(to)
    setPickerOpen(false)
  }

  const rangeDays = start && end ? Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) + 1 : 0

  return (
    <div className="page">
      <div className="card">
        <div className="card-title">生成报告</div>

        {/* 1.1.7：开始/结束合并为一次选择——点开同一张月历选好区间 */}
        <button className="range-field" onClick={() => setPickerOpen(true)}>
          <span className="range-field__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
              <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
            </svg>
          </span>
          <span className="range-field__main">
            <span className="range-field__label">报告区间</span>
            <span className="range-field__value">{cnDate(start)} — {cnDate(end)}</span>
          </span>
          <span className="range-field__days">共 {rangeDays} 天</span>
          <span className="range-field__caret" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 5.5L16 12l-6.5 6.5" />
            </svg>
          </span>
        </button>

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
      </div>

      <div className="card">
        <div className="card-title">历史报告（{reports.length}）</div>
        {reports.length === 0 && <div className="muted">还没有报告，点上面生成</div>}
        <ul className="report-list">
          {reports.map((r) => {
            const km = kindMeta(r)
            const { from, to } = parsePeriod(r.period)
            const pf = parts(from)
            const pt = parts(to)
            const open = openId === r.id
            return (
              <li key={r.id} className="report-item">
                <div className="report-head">
                  {/* 有色圆圈：周 / 月 / 自，下方小号年份 */}
                  <div className={'report-badge is-' + km.key}>
                    <span className="report-badge__kind">{km.char}</span>
                    <span className="report-badge__year">{(pt || pf || {}).y || ''}</span>
                  </div>

                  {/* 主体：1.1.10 改为方框框起的紧凑区间「9.14-9.20」，月份加粗即可 */}
                  <div className="report-dates">
                    <span className="report-range">
                      <b>{pf ? pf.m : '-'}</b>.{pf ? pf.day : '-'}
                      <span className="report-range__sep">–</span>
                      <b>{pt ? pt.m : '-'}</b>.{pt ? pt.day : '-'}
                    </span>
                  </div>

                  <button className="report-view" onClick={() => setOpenId(open ? null : r.id)}>
                    {open ? '收起' : '查看'}
                  </button>
                </div>

                {open && (
                  <div className="report-body">
                    <ReportViz r={r} />
                    <button className="ledger-del report-del" onClick={() => { db.deletePastReport(r.id); setReports(db.getPastReports()) }}>
                      删除此报告
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {pickerOpen && (
        <DateRangePicker
          start={start}
          end={end}
          onClose={() => setPickerOpen(false)}
          onConfirm={applyRange}
        />
      )}
    </div>
  )
}
