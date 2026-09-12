import React, { useMemo, useState } from 'react'
import Modal from './Modal.jsx'
import { addDays, todayStr } from '../utils/date.js'

// 1.1.7：单界面日期区间选择器
// 交互：进入后在同一张月历里点两下——第一下定开始，第二下定结束（若先点的更晚，自动对调）；
// 区间内高亮、两端实心圆，底部实时显示「X月X日 — X月X日 · 共 N 天」，确认后一次性回填。

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function parse(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }
}

function toStr(y, m, d) {
  return todayStr(new Date(y, m, d))
}

function cn(dateStr) {
  if (!dateStr) return ''
  const p = parse(dateStr)
  return `${p.m + 1}月${p.d}日`
}

function dayCount(from, to) {
  if (!from || !to) return 0
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to + 'T00:00:00')
  return Math.round((b - a) / 86400000) + 1
}

// 快捷区间：一律截止到「昨天」（今天数据尚未完成，与报告统计口径一致）
function presets() {
  const yesterday = addDays(todayStr(), -1)
  const now = new Date()
  const monthStart = toStr(now.getFullYear(), now.getMonth(), 1)
  const thisMonth = yesterday < monthStart ? [monthStart, todayStr()] : [monthStart, yesterday]
  return [
    { label: '近7天', from: addDays(yesterday, -6), to: yesterday },
    { label: '近14天', from: addDays(yesterday, -13), to: yesterday },
    { label: '近30天', from: addDays(yesterday, -29), to: yesterday },
    { label: '本月', from: thisMonth[0], to: thisMonth[1] },
  ]
}

function Chevron({ dir }) {
  const d = dir === 'left' ? 'M14.5 5.5L8 12l6.5 6.5' : 'M9.5 5.5L16 12l-6.5 6.5'
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export default function DateRangePicker({ start, end, onClose, onConfirm }) {
  const [from, setFrom] = useState(start || '')
  const [to, setTo] = useState(end || '')
  const [cursor, setCursor] = useState(() => {
    const p = parse(start || todayStr())
    return { y: p.y, m: p.m }
  })

  const today = todayStr()

  const cells = useMemo(() => {
    const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay()
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
    const out = []
    for (let i = 0; i < firstWeekday; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(toStr(cursor.y, cursor.m, d))
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [cursor])

  // 点了两下就成区间：先点结束再点开始也能自动对调
  function pick(day) {
    if (!from || (from && to)) {
      setFrom(day)
      setTo('')
      return
    }
    if (day < from) {
      setTo(from)
      setFrom(day)
    } else {
      setTo(day)
    }
  }

  function shiftMonth(n) {
    const d = new Date(cursor.y, cursor.m + n, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  function applyPreset(p) {
    setFrom(p.from)
    setTo(p.to)
    const c = parse(p.from)
    setCursor({ y: c.y, m: c.m })
  }

  const activePreset = presets().find((p) => p.from === from && p.to === to)
  const ready = !!(from && to)

  return (
    <Modal title="选择报告区间" onClose={onClose}>
      <div className="drp">
        <div className="drp-presets">
          {presets().map((p) => (
            <button
              key={p.label}
              className={'drp-preset' + (activePreset && activePreset.label === p.label ? ' is-active' : '')}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="drp-nav">
          <button className="drp-nav__btn" onClick={() => shiftMonth(-1)} aria-label="上一个月">
            <Chevron dir="left" />
          </button>
          <span className="drp-nav__label">{cursor.y} 年 {cursor.m + 1} 月</span>
          <button className="drp-nav__btn" onClick={() => shiftMonth(1)} aria-label="下一个月">
            <Chevron dir="right" />
          </button>
        </div>

        <div className="drp-week">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="drp-grid">
          {cells.map((day, i) => {
            if (!day) return <span key={'e' + i} className="drp-day is-empty" />
            const isStart = day === from
            const isEnd = day === to
            const isBetween = !!(from && to && day > from && day < to)
            const cls =
              'drp-day' +
              (isBetween ? ' is-in' : '') +
              (isStart ? ' is-start' : '') +
              (isEnd ? ' is-end' : '') +
              (isStart && isEnd ? ' is-single' : '') +
              (day === today ? ' is-today' : '')
            return (
              <button key={day} className={cls} onClick={() => pick(day)}>
                <span className="drp-day__num">{parse(day).d}</span>
              </button>
            )
          })}
        </div>

        <div className="drp-summary">
          {ready ? (
            <>
              <span className="drp-summary__range">{cn(from)} — {cn(to)}</span>
              <span className="drp-summary__days">共 {dayCount(from, to)} 天</span>
            </>
          ) : (
            <span className="drp-summary__hint">{from ? '已选开始日期，再点一下结束日期' : '点一下开始日期，再点一下结束日期'}</span>
          )}
        </div>

        <div className="drp-actions">
          <button className="drp-btn" onClick={onClose}>取消</button>
          <button className="drp-btn is-primary" disabled={!ready} onClick={() => onConfirm(from, to)}>确定</button>
        </div>
      </div>
    </Modal>
  )
}
