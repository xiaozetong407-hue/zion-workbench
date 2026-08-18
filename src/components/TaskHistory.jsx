import React, { useState, useEffect } from 'react'
import { db } from '../store/db.js'
import { formatDateShort } from '../utils/date.js'

function TaskDetailMark({ done }) {
  return (
    <span className={'task-detail__mark' + (done ? ' done' : '')}>
      {done && (
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
          <path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

export default function TaskHistory({ onBack }) {
  const [days, setDays] = useState([])
  const [open, setOpen] = useState({})

  useEffect(() => {
    const all = db.getAllTasks()
    const map = {}
    all.forEach((t) => {
      ;(map[t.date] = map[t.date] || []).push(t)
    })
    const list = Object.entries(map)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 30)
      .map(([date, arr]) => {
        const done = arr.filter((t) => t.done).length
        const total = arr.length
        return {
          date,
          total,
          done,
          undone: total - done,
          rate: total ? Math.round((done / total) * 100) : 0,
          tasks: arr,
        }
      })
    setDays(list)
  }, [])

  function toggle(date) {
    setOpen((o) => ({ ...o, [date]: !o[date] }))
  }

  return (
    <div className="page history-page">
      <div className="history-top">
        <h2>历史任务</h2>
        <button className="back-btn" onClick={onBack}>
          返回
        </button>
      </div>

      <div className="history-list">
        {days.map((d) => (
          <div key={d.date} className="history-row">
            <div className="history-row__top">
              <span className="history-row__date">{formatDateShort(d.date)}</span>
              <button className="task-stat-toggle" onClick={() => toggle(d.date)}>
                <span>
                  任务 {d.total} · 完成 <b>{d.done}</b> · 未完成 {d.undone} ·{' '}
                  <b className="task-stat-rate">{d.rate}%</b>
                </span>
                <span className="task-stat-caret">
                  {open[d.date] ? '收起' : '展开'}
                </span>
              </button>
            </div>
            {open[d.date] && (
              <ul className="task-detail">
                {d.tasks.map((t) => (
                  <li key={t.id} className={t.done ? 'done' : ''}>
                    <TaskDetailMark done={t.done} />
                    <span className="task-detail__title">{t.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {days.length === 0 && <div className="muted">还没有任务记录。</div>}
      </div>
    </div>
  )
}
