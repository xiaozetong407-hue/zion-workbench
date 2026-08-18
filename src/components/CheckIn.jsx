import React, { useState, useEffect } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { formatDateCN } from '../utils/date.js'

const TOGGLE_ITEMS = [
  { key: 'english', label: '英语学习' },
  { key: 'reading', label: '阅读30min' },
  { key: 'earlySleep', label: '早睡' },
]

export default function CheckIn({ date }) {
  const [ci, setCi] = useState(db.getCheckIn(date) || {})
  useLive(() => setCi(db.getCheckIn(date) || {}))

  useEffect(() => {
    setCi(db.getCheckIn(date) || {})
  }, [date])

  function toggle(key) {
    const next = !ci[key]
    setCi((prev) => ({ ...prev, [key]: next }))
    db.setCheckIn(date, { [key]: next })
  }

  function setExercise(v) {
    setCi((prev) => ({ ...prev, exercise: v }))
    db.setCheckIn(date, { exercise: v })
  }

  return (
    <div className="page">
      <h2>打卡 · {formatDateCN(date)}</h2>

      <div className="card">
        {TOGGLE_ITEMS.map((it) => (
          <label key={it.key} className="row">
            <span>{it.label}</span>
            <input
              type="checkbox"
              checked={!!ci[it.key]}
              onChange={() => toggle(it.key)}
            />
          </label>
        ))}

        <label className="row col">
          <span>运动指标（运动时长 分钟）</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={ci.exercise ?? ''}
            placeholder="0"
            onChange={(e) => setExercise(e.target.value)}
          />
        </label>
      </div>

      <div className="muted">
        数据保存在本机浏览器。后续版本会按周 / 月自动汇总进周报、月报。
      </div>
    </div>
  )
}
