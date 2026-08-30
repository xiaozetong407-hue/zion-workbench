import React, { useMemo, useRef, useState } from 'react'
import { db } from '../store/db.js'
import { todayStr, addDays } from '../utils/date.js'
import Modal from './Modal.jsx'

const W = 320
const PAD = 14
const BLOCK_TOP0 = 34
const BLOCK_STEP = 98
const CH = 72 // 单图高度
const COLORS_STYLE = `
  .w-line{fill:none;stroke:#4f7cff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .b-line{fill:none;stroke:#7c5cff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .s-line{fill:none;stroke:#4f7cff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .c-line{fill:none;stroke:#ff9800;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .sl-line{fill:none;stroke:#42a5f5;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .ex-line{fill:none;stroke:#27c08a;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .bmi-line{fill:none;stroke:#26a69a;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .bar-s{fill:#4f7cff}
  .bar-c{fill:#ff9800}
  .bar-sl{fill:#42a5f5}
  .bar-ex{fill:#27c08a}
  .dot{stroke:#fff;stroke-width:1.5}
  .ax{stroke:#eef1f7;stroke-width:1}
  .lbl{fill:#8a93a6;font-size:9px}
  .lbl-r{fill:#8a93a6;font-size:9px;text-anchor:end}
  .ttl{fill:#1c2333;font-size:11px;font-weight:700}
  .val{fill:#8a93a6;font-size:8px}
  .empty{fill:#8a93a6;font-size:10px}
`
// 配色与 token 对齐（蓝/紫/橙/蓝/绿），定义在 svg 内 <style> 以便导出图片仍正确着色
function LineBlock({ top, title, pts, cls }) {
  const n = pts.length
  if (n < 2) {
    return (
      <g>
        <text x={PAD} y={top + 12} className="ttl">{title}</text>
        <text x={PAD} y={top + 18 + CH / 2} className="empty">数据不足，先记录几天</text>
      </g>
    )
  }
  const vals = pts.map((p) => p.v)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const xs = (i) => PAD + (i / (n - 1)) * (W - 2 * PAD)
  const ys = (i) => top + 18 + (CH - ((vals[i] - min) / span) * CH)
  const last = pts[n - 1]
  return (
    <g>
      <text x={PAD} y={top + 12} className="ttl">{title}</text>
      <line x1={PAD} y1={top + 18 + CH} x2={W - PAD} y2={top + 18 + CH} className="ax" />
      <polyline className={cls} points={pts.map((_, i) => `${xs(i)},${ys(i)}`).join(' ')} />
      {pts.map((_, i) => (
        <circle key={i} className={`dot ${cls}`} cx={xs(i)} cy={ys(i)} r={2.4} />
      ))}
      <text x={PAD} y={top + 14 + CH} className="lbl">{min}</text>
      <text x={W - PAD} y={top + 14 + CH} className="lbl-r">{max}</text>
      <text x={W - PAD} y={top + 12} className="lbl-r">{last.v}</text>
    </g>
  )
}

function BarBlock({ top, title, pts, cls, unit }) {
  const n = pts.length
  if (n === 0) {
    return (
      <g>
        <text x={PAD} y={top + 12} className="ttl">{title}</text>
        <text x={PAD} y={top + 18 + CH / 2} className="empty">暂无数据</text>
      </g>
    )
  }
  const vals = pts.map((p) => p.v)
  const max = Math.max(...vals, 1)
  const slot = (W - 2 * PAD) / n
  const bw = Math.min(slot * 0.6, 18)
  const baseY = top + 18 + CH
  return (
    <g>
      <text x={PAD} y={top + 12} className="ttl">{title}</text>
      <line x1={PAD} y1={baseY} x2={W - PAD} y2={baseY} className="ax" />
      {pts.map((p, i) => {
        const h = (p.v / max) * CH
        const x = PAD + (i + 0.5) * slot - bw / 2
        const y = baseY - h
        return (
          <g key={i}>
            <rect className={cls} x={x} y={y} width={bw} height={Math.max(h, 1)} rx={2} />
            <text x={x + bw / 2} y={y - 2} className="val" textAnchor="middle">{p.label}</text>
          </g>
        )
      })}
    </g>
  )
}

// 小工具：把 label 取末两位日期（MM-DD）
function dayLabel(d) {
  return d.slice(5)
}

// 1.1.3：睡眠按「X小时Y分钟」显示。
// 优先用精确的整分钟字段 sleepMinutes（1.1.3 起新记录），老数据无该字段时按 sleepHours 小数反算。
function fmtSleepHM(sleepMinutes, sleepHours) {
  let total = Number(sleepMinutes)
  if (!total || total <= 0) total = Math.round((Number(sleepHours) || 0) * 60)
  if (!total || total <= 0) return '-'
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0 && m > 0) return `${h}小时${m}分钟`
  if (h > 0) return `${h}小时`
  return `${m}分钟`
}

// 平均卡片（平均视图用）
function AvgCard({ label, value, unit }) {
  return (
    <div className="sh-avg__card">
      <div className="sh-avg__label">{label}</div>
      <div className="sh-avg__value">
        {value == null ? '-' : value}
        {value != null && unit ? <span className="sh-avg__unit">{unit}</span> : null}
      </div>
    </div>
  )
}

export default function StatusHistory({ onClose }) {
  const [range, setRange] = useState('30')
  const [view, setView] = useState('average') // 'chart' | 'detail' | 'average'
  const [avgPeriod, setAvgPeriod] = useState('month') // 'week' | 'month' | 'year'（默认近一月）
  const [avgStart, setAvgStart] = useState('') // 自定义开始日期（YYYY-MM-DD），空则用预设
  const [avgEnd, setAvgEnd] = useState('') // 自定义结束日期，空则用预设
  const [edit, setEdit] = useState(null) // 新增/编辑状态记录
  const [version, setVersion] = useState(0) // 增改后刷新
  const svgRef = useRef(null)
  const [saved, setSaved] = useState(false)

  const data = useMemo(() => {
    const all = db.getAllStatus()
    const settings = db.getSettings()
    const height = Number(settings.height) || 0
    let days = Object.keys(all).sort()
    if (range === '30') days = days.slice(-30)
    const weight = []
    const bmi = []
    const steps = []
    const calories = []
    const sleep = []
    const exercise = []
    days.forEach((d) => {
      const s = all[d] || {}
      const w = Number(s.weight) || 0
      if (w > 0) {
        weight.push({ label: dayLabel(d), v: w })
        if (height > 0) {
          const b = w / Math.pow(height / 100, 2)
          bmi.push({ label: dayLabel(d), v: Math.round(b * 10) / 10 })
        }
      }
      const st = Number(s.steps) || 0
      if (st > 0) steps.push({ label: dayLabel(d), v: st })
      const ca = Number(s.calories) || 0
      if (ca > 0) calories.push({ label: dayLabel(d), v: ca })
      const sl = Number(s.sleepHours) || 0
      if (sl > 0) sleep.push({ label: dayLabel(d), v: sl })
      // 需求 7：活动统一按「小时」展示（数据源为分钟，换算保留 1 位）
      // 活动：exerciseMin 字段实际语义为「小时」（输入框即小时，历史命名遗留），直接使用原值
      const exMin = Number(s.exerciseMin) || 0
      if (exMin > 0) exercise.push({ label: dayLabel(d), v: Math.round(exMin * 10) / 10 })
    })
    return { weight, bmi, steps, calories, sleep, exercise, count: days.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, version])

  // 明细表：逐日具体数据（降序，近的在前）
  const rows = useMemo(() => {
    const all = db.getAllStatus()
    let days = Object.keys(all).sort()
    if (range === '30') days = days.slice(-30)
    return days.reverse().map((d) => {
      const s = all[d] || {}
      return {
        date: d,
        weight: s.weight != null ? s.weight : '',
        sleepHours: s.sleepHours != null ? s.sleepHours : '',
        // 1.1.3：精确整分钟（新记录有），用于「X小时Y分钟」显示
        sleepMinutes: s.sleepMinutes != null ? s.sleepMinutes : '',
        steps: s.steps != null ? s.steps : '',
        calories: s.calories != null ? s.calories : '',
        exerciseMin: s.exerciseMin != null ? s.exerciseMin : '',
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, version])

  // 平均视图：按所选周期（自定义起止 / 周 / 月 / 年）统计各指标平均值（仅统计填写了该项的日期）
  const avgRange = useMemo(() => {
    if (avgStart && avgEnd && avgStart <= avgEnd) return [avgStart, avgEnd]
    const spanMap = { week: 7, month: 30, year: 365 }
    const span = spanMap[avgPeriod] || 30
    const to = todayStr()
    return [addDays(to, -(span - 1)), to]
  }, [avgStart, avgEnd, avgPeriod])
  const averages = useMemo(() => {
    const all = db.getAllStatus()
    const settings = db.getSettings()
    const height = Number(settings.height) || 0
    const [from, to] = avgRange
    const days = Object.keys(all).filter((d) => d >= from && d <= to).sort()
    const sum = { weight: 0, sleep: 0, sleepMin: 0, steps: 0, calories: 0, exercise: 0, bmi: 0 }
    const cnt = { weight: 0, sleep: 0, steps: 0, calories: 0, exercise: 0, bmi: 0 }
    days.forEach((d) => {
      const s = all[d] || {}
      const w = Number(s.weight) || 0
      if (w > 0) {
        sum.weight += w
        cnt.weight += 1
        if (height > 0) {
          sum.bmi += w / Math.pow(height / 100, 2)
          cnt.bmi += 1
        }
      }
      const sl = Number(s.sleepHours) || 0
      if (sl > 0) {
        sum.sleep += sl; cnt.sleep += 1
        // 1.1.3：优先用精确整分钟，老数据按小数小时反算
        sum.sleepMin += Number(s.sleepMinutes) || Math.round(sl * 60)
      }
      const st = Number(s.steps) || 0
      if (st > 0) { sum.steps += st; cnt.steps += 1 }
      const ca = Number(s.calories) || 0
      if (ca > 0) { sum.calories += ca; cnt.calories += 1 }
      const exMin = Number(s.exerciseMin) || 0
      if (exMin > 0) { sum.exercise += exMin; cnt.exercise += 1 } // 字段语义=小时，原值累加
    })
    const round1 = (v) => Math.round(v * 10) / 10
    const avg = (k) => (cnt[k] ? sum[k] / cnt[k] : 0)
    return {
      count: days.length,
      windowFrom: from,
      windowTo: to,
      weight: cnt.weight ? round1(avg('weight')) : null,
      bmi: cnt.bmi ? round1(avg('bmi')) : null,
      sleep: cnt.sleep ? round1(avg('sleep')) : null,
      // 1.1.3：平均睡眠的「X小时Y分钟」文本
      sleepHM: cnt.sleep ? fmtSleepHM(Math.round(sum.sleepMin / cnt.sleep), 0) : null,
      steps: cnt.steps ? Math.round(avg('steps')) : null,
      calories: cnt.calories ? Math.round(avg('calories')) : null,
      exercise: cnt.exercise ? round1(avg('exercise')) : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avgRange, version])

  // 需求 7：明细顶部「过去一周平均值」（最近 7 天，仅统计有记录的日期；不含体重/BMI）
  const weekAvg = useMemo(() => {
    const all = db.getAllStatus()
    const to = todayStr()
    const from = addDays(to, -6)
    const days = Object.keys(all).filter((d) => d >= from && d <= to).sort()
    const sum = { sleep: 0, sleepMin: 0, steps: 0, calories: 0, exercise: 0 }
    const cnt = { sleep: 0, steps: 0, calories: 0, exercise: 0 }
    days.forEach((d) => {
      const s = all[d] || {}
      const sl = Number(s.sleepHours) || 0
      if (sl > 0) {
        sum.sleep += sl; cnt.sleep += 1
        // 1.1.3：优先用精确整分钟，老数据按小数小时反算
        sum.sleepMin += Number(s.sleepMinutes) || Math.round(sl * 60)
      }
      const st = Number(s.steps) || 0
      if (st > 0) { sum.steps += st; cnt.steps += 1 }
      const ca = Number(s.calories) || 0
      if (ca > 0) { sum.calories += ca; cnt.calories += 1 }
      const exMin = Number(s.exerciseMin) || 0
      if (exMin > 0) { sum.exercise += exMin; cnt.exercise += 1 } // 字段语义=小时
    })
    const round1 = (v) => Math.round(v * 10) / 10
    return {
      from, to, days: days.length,
      sleep: cnt.sleep ? round1(sum.sleep / cnt.sleep) : null,
      // 1.1.3：近 7 日平均睡眠的「X小时Y分钟」文本
      sleepHM: cnt.sleep ? fmtSleepHM(Math.round(sum.sleepMin / cnt.sleep), 0) : null,
      steps: cnt.steps ? Math.round(sum.steps / cnt.steps) : null,
      calories: cnt.calories ? Math.round(sum.calories / cnt.calories) : null,
      exercise: cnt.exercise ? round1(sum.exercise / cnt.exercise) : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  function saveImage() {
    const svg = svgRef.current
    if (!svg) return
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const dataStr = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([dataStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = svg.clientWidth * scale
      canvas.height = svg.clientHeight * scale
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `zion-状态历史-${range === '30' ? '近30天' : '全部'}.png`
        a.click()
        URL.revokeObjectURL(a.href)
        setSaved(true)
        setTimeout(() => setSaved(false), 1800)
      }, 'image/png')
    }
    img.onerror = () => alert('保存失败，请重试')
    img.src = url
  }

  function openEdit(r) {
    setEdit({
      date: r.date,
      weight: r.weight ?? '',
      sleepHours: r.sleepHours ?? '',
      steps: r.steps ?? '',
      calories: r.calories ?? '',
      exerciseMin: r.exerciseMin ?? '',
      isNew: false,
    })
  }
  function openNew() {
    setEdit({
      date: todayStr(),
      weight: '',
      sleepHours: '',
      steps: '',
      calories: '',
      exerciseMin: '',
      isNew: true,
    })
  }
  function saveEdit() {
    if (!edit) return
    const d = edit.date
    if (!d) { alert('请选择日期'); return }
    db.setStatus(d, {
      weight: edit.weight === '' ? '' : Number(edit.weight),
      sleepHours: edit.sleepHours === '' ? '' : Number(edit.sleepHours),
      steps: edit.steps === '' ? '' : Number(edit.steps),
      calories: edit.calories === '' ? '' : Number(edit.calories),
      exerciseMin: edit.exerciseMin === '' ? '' : Number(edit.exerciseMin),
    })
    setEdit(null)
    setVersion((v) => v + 1)
  }

  const blocks = []
  // 需求 7：体重/BMI 变化缓慢不绘制；仅保留 步数/卡路里/睡眠/活动 折线图（活动单位为小时）
  blocks.push({ type: 'line', title: '步数', pts: data.steps, cls: 's-line' })
  blocks.push({ type: 'line', title: '卡路里 (kcal)', pts: data.calories, cls: 'c-line' })
  blocks.push({ type: 'line', title: '睡眠 (小时)', pts: data.sleep, cls: 'sl-line' })
  blocks.push({ type: 'line', title: '活动 (小时)', pts: data.exercise, cls: 'ex-line' })
  const H = BLOCK_TOP0 + blocks.length * BLOCK_STEP + 6

  return (
    <div className="sh-modal" onClick={onClose}>
      <div className="sh-card" onClick={(e) => e.stopPropagation()}>
        <div className="sh-head">
          <span className="sh-title">历史状态</span>
          <button className="sh-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="sh-toolbar">
          <div className="sh-view">
            <button className={'sh-view__btn' + (view === 'chart' ? ' is-active' : '')} onClick={() => setView('chart')}>图表</button>
            <button className={'sh-view__btn' + (view === 'detail' ? ' is-active' : '')} onClick={() => setView('detail')}>明细</button>
            <button className={'sh-view__btn' + (view === 'average' ? ' is-active' : '')} onClick={() => setView('average')}>平均</button>
          </div>
          {view === 'average' ? (
            <div className="sh-range">
              <button className={'sh-range__btn' + (!avgStart && !avgEnd && avgPeriod === 'week' ? ' is-active' : '')} onClick={() => { setAvgPeriod('week'); setAvgStart(''); setAvgEnd('') }}>周</button>
              <button className={'sh-range__btn' + (!avgStart && !avgEnd && avgPeriod === 'month' ? ' is-active' : '')} onClick={() => { setAvgPeriod('month'); setAvgStart(''); setAvgEnd('') }}>月</button>
              <button className={'sh-range__btn' + (!avgStart && !avgEnd && avgPeriod === 'year' ? ' is-active' : '')} onClick={() => { setAvgPeriod('year'); setAvgStart(''); setAvgEnd('') }}>年</button>
            </div>
          ) : (
            <div className="sh-range">
              <button className={'sh-range__btn' + (range === '30' ? ' is-active' : '')} onClick={() => setRange('30')}>近 30 天</button>
              <button className={'sh-range__btn' + (range === 'all' ? ' is-active' : '')} onClick={() => setRange('all')}>全部</button>
            </div>
          )}
          {view === 'detail' ? (
            <button className="sh-add" onClick={openNew}>＋新增</button>
          ) : view === 'chart' ? (
            <button className="sh-save" onClick={saveImage}>
              {saved ? '已保存 ✓' : '保存图片'}
            </button>
          ) : null}
        </div>

        {view === 'average' ? (
          <div className="sh-avg">
            <div className="sh-avg__head">
              <span className="sh-avg__period">平均数据</span>
              <span className="sh-avg__range">
                {averages.windowFrom.slice(5)} ~ {averages.windowTo.slice(5)}
              </span>
            </div>
            <div className="sh-avg__rangepick">
              <label className="sh-avg__date">
                <span>开始</span>
                <input type="date" value={avgStart} max={avgEnd || todayStr()} onChange={(e) => setAvgStart(e.target.value)} />
              </label>
              <label className="sh-avg__date">
                <span>结束</span>
                <input type="date" value={avgEnd} min={avgStart || undefined} max={todayStr()} onChange={(e) => setAvgEnd(e.target.value)} />
              </label>
            </div>
            {averages.count === 0 ? (
              <div className="muted" style={{ padding: '24px 4px', textAlign: 'center' }}>
                该时间段内还没有状态记录
              </div>
            ) : (
              <div className="sh-avg__grid">
                {/* 需求 7：平均栏不展示平均体重 / 平均 BMI */}
                {/* 1.1.3：平均睡眠改为「X小时Y分钟」 */}
                <AvgCard label="平均睡眠" value={averages.sleepHM} unit="" />
                <AvgCard label="平均步数" value={averages.steps} unit="步" />
                <AvgCard label="平均卡路里" value={averages.calories} unit="kcal" />
                <AvgCard label="平均活动" value={averages.exercise} unit="小时" />
              </div>
            )}
            {averages.count > 0 && (
              <div className="sh-avg__note muted">
                基于本时间段内 {averages.count} 天有记录的数据计算（每项仅统计填写了该日期的记录）
              </div>
            )}
          </div>
        ) : view === 'detail' ? (
          <div className="sh-detail">
            {/* 0.32.1：逐日明细置顶；过去一周平均作为表格第一行（最新一天之上），不单独成行 */}
            {rows.length === 0 ? (
              <div className="muted" style={{ padding: '14px 4px' }}>该范围内还没有状态记录</div>
            ) : (
              <table className="sh-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>睡眠</th>
                    <th>步数</th>
                    <th>卡路里</th>
                    <th>活动</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 过去一周平均（有记录的近 7 天，按项统计；不含体重/BMI） */}
                  <tr className="sh-table__avg">
                    <td>近7日平均</td>
                    <td>{weekAvg.sleepHM ?? '-'}</td>
                    <td>{weekAvg.steps ?? '-'}</td>
                    <td>{weekAvg.calories ?? '-'}</td>
                    <td>{weekAvg.exercise ?? '-'}</td>
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.date} onClick={() => openEdit(r)}>
                      <td>{r.date.slice(5)}</td>
                      <td>{fmtSleepHM(r.sleepMinutes, r.sleepHours)}</td>
                      <td>{r.steps === '' ? '-' : r.steps}</td>
                      <td>{r.calories === '' ? '-' : r.calories}</td>
                      <td>{r.exerciseMin === '' ? '-' : Math.round(Number(r.exerciseMin) * 10) / 10}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="sh-scroll">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
              <style>{COLORS_STYLE}</style>
              <text x={PAD} y={20} className="ttl">覆盖 {data.count} 天</text>

              {blocks.map((b, i) => {
                const top = BLOCK_TOP0 + i * BLOCK_STEP
                return b.type === 'line' ? (
                  <LineBlock key={i} top={top} title={b.title} pts={b.pts} cls={b.cls} />
                ) : (
                  <BarBlock key={i} top={top} title={b.title} pts={b.pts} cls={b.cls} />
                )
              })}
            </svg>
          </div>
        )}

        <div className="sh-foot muted">数据来源于你填写的每日状态，已存储在本机；「明细」可逐日查看、点击编辑或新增。</div>
      </div>

      {/* 新增 / 编辑 状态记录 */}
      {edit && (
        <Modal title={edit.isNew ? '新增状态记录' : `编辑状态 · ${edit.date.slice(5)}`} onClose={() => setEdit(null)}>
          <div className="review-fields">
            <label className="field">
              <span>日期</span>
              <input
                type="date"
                value={edit.date}
                disabled={!edit.isNew}
                onChange={(e) => setEdit((p) => ({ ...p, date: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>体重 (kg)</span>
              <input type="number" step="0.1" min="0" inputMode="decimal" value={edit.weight} onChange={(e) => setEdit((p) => ({ ...p, weight: e.target.value }))} />
            </label>
            <label className="field">
              <span>睡眠 (小时，如 7.5)</span>
              <input type="number" step="0.1" min="0" inputMode="decimal" value={edit.sleepHours} onChange={(e) => setEdit((p) => ({ ...p, sleepHours: e.target.value }))} />
            </label>
            <label className="field">
              <span>步数</span>
              <input type="number" min="0" inputMode="numeric" value={edit.steps} onChange={(e) => setEdit((p) => ({ ...p, steps: e.target.value }))} />
            </label>
            <label className="field">
              <span>卡路里 (kcal)</span>
              <input type="number" min="0" inputMode="numeric" value={edit.calories} onChange={(e) => setEdit((p) => ({ ...p, calories: e.target.value }))} />
            </label>
            <label className="field">
              <span>活动 (小时)</span>
              <input type="number" min="0" inputMode="numeric" value={edit.exerciseMin} onChange={(e) => setEdit((p) => ({ ...p, exerciseMin: e.target.value }))} />
            </label>
            <button className="primary" onClick={saveEdit}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
