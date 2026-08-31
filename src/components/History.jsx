import React, { useState, useEffect, useRef } from 'react'
import { db } from '../store/db.js'
import { formatDateShort } from '../utils/date.js'

export default function History({ onBack }) {
  const items = db.CHECKIN_ITEMS
  const [rows, setRows] = useState([])
  const [notes, setNotes] = useState({})
  const [editing, setEditing] = useState({}) // 哪些日期的备注框被展开（含空）
  const [delTarget, setDelTarget] = useState(null) // 长按待删除的日期
  const pressTimer = useRef(null)

  useEffect(() => {
    const all = db.getAllCheckIns()
    const list = Object.entries(all)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 60)
    setRows(list.map(([dateStr, c]) => ({ date: dateStr, c })))
    const n = {}
    list.forEach(([dateStr, c]) => { n[dateStr] = c.note || '' })
    setNotes(n)
  }, [])

  function saveNote(dateStr, val) {
    setNotes((p) => ({ ...p, [dateStr]: val }))
    db.setCheckIn(dateStr, { note: val })
  }

  function toggleItem(dateStr, key, current) {
    const next = !current
    setRows((rs) => rs.map((r) => (r.date === dateStr ? { ...r, c: { ...r.c, [key]: next } } : r)))
    db.setCheckIn(dateStr, { [key]: next })
  }

  function startPress(dateStr) {
    clearPress()
    pressTimer.current = setTimeout(() => setDelTarget(dateStr), 550)
  }
  function clearPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  function confirmDelete() {
    if (!delTarget) return
    db.deleteCheckIn(delTarget) // 真正删除该日打卡记录（note 一并清除）
    setRows((rs) => rs.filter((r) => r.date !== delTarget))
    setNotes((p) => { const n = { ...p }; delete n[delTarget]; return n })
    setDelTarget(null)
  }

  return (
    <div className="page history-page">
      <div className="history-top">
        <h2>历史打卡</h2>
        <button className="back-btn" onClick={onBack}>返回</button>
      </div>

      <div className="history-list">
        {rows.map(({ date: dateStr, c }) => {
          const done = items.filter((it) => !!c[it.key]).length
          const noteVal = notes[dateStr] || ''
          const hasNote = !!noteVal.trim()
          const isEditing = !!editing[dateStr]
          return (
            <div
              key={dateStr}
              className="history-row"
              onPointerDown={() => startPress(dateStr)}
              onPointerUp={clearPress}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
            >
              {/* 第一行：日期 +（无备注时的「＋备注」入口，行内不占行）+ 完成度 */}
              <div className="history-row__top">
                <span className="history-row__date">{formatDateShort(dateStr)}</span>
                {!hasNote && !isEditing && (
                  <button
                    className="history-addnote"
                    onClick={() => { setEditing((p) => ({ ...p, [dateStr]: true })); setNotes((p) => ({ ...p, [dateStr]: '' })) }}
                  >＋备注</button>
                )}
                <span className="history-row__count"><b>{done}</b>/{items.length}</span>
              </div>

              {/* 备注：编辑态显示输入框；非编辑态有备注时以纯文本另起一行展示，点击可再改；无备注则省略 */}
              {isEditing ? (
                <input
                  className="history-note"
                  autoFocus
                  placeholder="打卡小结 / 未完成原因…"
                  value={noteVal}
                  onChange={(e) => saveNote(dateStr, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                  onBlur={(e) => {
                    setEditing((p) => { const n = { ...p }; delete n[dateStr]; return n })
                    if (!e.target.value.trim()) {
                      setNotes((p) => ({ ...p, [dateStr]: '' }))
                      db.setCheckIn(dateStr, { note: '' })
                    }
                  }}
                />
              ) : hasNote ? (
                <div
                  className="history-note-text"
                  onClick={() => setEditing((p) => ({ ...p, [dateStr]: true }))}
                >{noteVal}</div>
              ) : null}

              {/* 圆点可点击：直接修改某一天的打卡项 */}
              <div className="history-row__dots">
                {items.map((it) => (
                  <button
                    key={it.key}
                    className={'h-dot' + (c[it.key] ? ' done' : '')}
                    title={it.label}
                    onClick={() => toggleItem(dateStr, it.key, !!c[it.key])}
                  >{it.short}</button>
                ))}
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <div className="muted">还没有打卡记录。</div>}
      </div>

      {delTarget && (
        <div className="sh-modal" onClick={() => setDelTarget(null)}>
          <div className="sh-card sh-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="sh-confirm__title">删除 {formatDateShort(delTarget)} 的打卡？</div>
            <div className="muted">删除后该日记录不可恢复。</div>
            <div className="sh-confirm__actions">
              <button className="sh-save sh-save--ghost" onClick={() => setDelTarget(null)}>取消</button>
              <button className="sh-del" onClick={confirmDelete}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
