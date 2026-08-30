import React, { useState, useEffect, useRef } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { monthKey, yearKey, getMonthsBack, getYearsBack, isLastDayOfMonth, addDays, mmdd } from '../utils/date.js'
import Modal from './Modal.jsx'

// 拖拽交互参数：长按进入拖动，避免正常滑动列表时误触排序
const LONG_PRESS_MS = 450 // 按住多少毫秒后进入可拖动状态
const MOVE_CANCEL = 12 // 长按等待期内移动超过此像素则取消（视为滑动浏览）
const MOVE_START = 6 // 长按激活后，移动超过此像素才真正开始排序

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="round" />
    </svg>
  )
}

// 由开始时刻 + 预期分钟计算结束时刻（跨天标记 +1 天）
function computeEnd(start, estMin) {
  if (!start || !estMin) return null
  const [h, m] = start.split(':').map(Number)
  let total = h * 60 + m + Number(estMin)
  const nextDay = Math.floor(total / 1440)
  total = ((total % 1440) + 1440) % 1440
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return { str: hh + ':' + mm, nextDay }
}

// 任务时间标签：开始 / 结束 / 仅预计（无时间字段则返回空，不显示虚假默认时间）
function timeLabel(t) {
  const end = computeEnd(t.start, t.estMin)
  if (t.start && end) {
    return `开始 ${t.start} → 结束 ${end.str}${end.nextDay ? '（+1天）' : ''}`
  }
  if (t.start) return `开始 ${t.start}`
  if (t.estMin) return `预计 ${t.estMin} 分钟`
  return ''
}

// 多行编辑框自动撑高（需求 3：长文本原地编辑不缩成单行）
function autoGrow(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// 单个周期计划编辑器：仅保留左侧周期下拉，去掉「2026年7月计划」等标题文字
function PlanEditor({ periods, value, onPeriod, onValue }) {
  return (
    <div className="plan-field">
      <select
        className="plan-select plan-select--left"
        value={value.period}
        onChange={(e) => onPeriod(e.target.value)}
      >
        {periods.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <textarea
        className="plan-area"
        value={value.text}
        placeholder="写写这个周期的计划…"
        rows={3}
        onChange={(e) => onValue(e.target.value)}
      />
    </div>
  )
}

function Tasks({ date, onNav }) {
  // 今日待办以「记录日」为当日主键（与复盘一致）：手动点「下一天」才推进，
  // 切换时当日数据已按日期存档（每次勾选/增删即写入），不会丢失。
  const [day, setDay] = useState(() => db.getRecordDay('task'))
  const [tasks, setTasks] = useState(db.getTasks(day))
  useLive(() => setTasks(db.getTasks(day)))
  const [input, setInput] = useState('')
  // 需求 1：默认不设置时间（空值；只有用户主动设置才保存）
  const [startInput, setStartInput] = useState('')
  const [estInput, setEstInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  // 想做的事（灵感池）：跨记录日，随手记临时想法
  const [idea, setIdea] = useState('')
  const [ideas, setIdeas] = useState(db.getIdeas())
  useLive(() => setIdeas(db.getIdeas()))
  // 1.1.3：想做的事默认收起（避免占屏，需要时点击展开）
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [editText, setEditText] = useState('')
  const drag = useRef(null)
  const longPressTimer = useRef(null)
  const listRef = useRef(null)
  const [dragId, setDragId] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const [armedId, setArmedId] = useState(null)

  // ---- 周期计划状态（按月/年/五年，各自独立选周期）----
  const curMonth = monthKey(date)
  const curYear = yearKey(date)
  const [planSel, setPlanSel] = useState({
    month: curMonth,
    year: curYear,
    fiveYear: curYear,
  })
  const [planText, setPlanText] = useState({
    month: db.getPlan('month', curMonth),
    year: db.getPlan('year', curYear),
    fiveYear: db.getPlan('fiveYear', curYear),
  })

  const monthPeriods = getMonthsBack(12).map((m) => {
    const [y, mm] = m.split('-').map(Number)
    return { value: m, label: `${y}年${mm}月` }
  })
  const yearPeriods = getYearsBack(6).map((y) => ({ value: y, label: `${y}年` }))
  const fivePeriods = getYearsBack(6).map((y) => {
    const n = Number(y)
    return { value: y, label: `${y}–${n + 4}` }
  })

  function planTitle(kind, period) {
    if (kind === 'month') {
      const [y, mm] = period.split('-').map(Number)
      return `${y}年${mm}月计划`
    }
    if (kind === 'year') return `${period}年度计划`
    const n = Number(period)
    return `${n}–${n + 4} 五年计划`
  }

  function onPlanPeriod(kind, period) {
    setPlanSel((s) => ({ ...s, [kind]: period }))
    setPlanText((t) => ({ ...t, [kind]: db.getPlan(kind, period) }))
  }
  function onPlanValue(kind, text) {
    setPlanText((t) => ({ ...t, [kind]: text }))
    db.setPlan(kind, planSel[kind], text)
  }

  // ---- 月度复盘弹窗（每月最后一天自动弹出，当天仅一次）----
  const [showMonthReview, setShowMonthReview] = useState(false)
  const [mr, setMr] = useState({ summary: '', lack: '', nextFocus: '' })

  useEffect(() => {
    const period = monthKey(date)
    if (isLastDayOfMonth(date) && !db.isPrompted('month', period)) {
      const existing = db.getMonthReview(period) || {}
      setMr({
        summary: existing.summary || '',
        lack: existing.lack || '',
        nextFocus: existing.nextFocus || '',
      })
      setShowMonthReview(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  function saveMonthReview() {
    db.setMonthReview(monthKey(date), mr)
    db.markPrompted('month', monthKey(date))
    setShowMonthReview(false)
  }
  function closeMonthReview() {
    db.markPrompted('month', monthKey(date))
    setShowMonthReview(false)
  }

  // 今日待办：以「记录日」为准载入；不再做 6 点自动滚动清空
  useEffect(() => {
    setTasks(db.getTasks(day))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = tasks.length
  const done = tasks.filter((t) => t.done).length
  const undone = total - done
  const rate = total ? Math.round((done / total) * 100) : 0

  function refresh() {
    setTasks(db.getTasks(day))
  }

  // 下一天：当日数据已按日期存档（勾选/增删即写入），仅推进记录日
  function nextDay() {
    const next = addDays(day, 1)
    setDay(next)
    db.setRecordDay('task', next)
    setTasks(db.getTasks(next))
  }

  // ---- 需求 5：上一周周复盘（上周一~上周日，基于记录日所在周；数据源=周日复盘里的 weekly 字段）----
  const dayMonday = (() => {
    const d = new Date(day + 'T00:00:00')
    const wd = d.getDay()
    return addDays(day, wd === 0 ? -6 : -(wd - 1))
  })()
  const lastMonday = addDays(dayMonday, -7)
  const lastSunday = addDays(dayMonday, -1)
  const lastWeekReview =
    (db.get().reviews && db.get().reviews[lastSunday] && db.get().reviews[lastSunday].weekly) || null

  function handleAdd() {
    if (!input.trim()) return
    db.addTask(day, input, startInput, estInput)
    setInput('')
    setStartInput('')
    setEstInput('')
    refresh()
  }

  function handleToggle(id) {
    db.toggleTask(id)
    refresh()
  }

  function handleDelete(id) {
    db.deleteTask(id)
    refresh()
  }

  function handleAddIdea() {
    if (!idea.trim()) return
    db.addIdea(idea)
    setIdea('')
    setIdeas(db.getIdeas())
  }

  function handleDeleteIdea(id) {
    db.deleteIdea(id)
    setIdeas(db.getIdeas())
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditText(t.title)
  }

  function saveEdit() {
    const v = editText.trim()
    if (editingId && v) db.editTask(editingId, v)
    setEditingId(null)
    setEditText('')
    refresh()
  }

  // 拖拽排序：长按左侧手柄进入拖动（保留手柄小点）；
  // 落点用「指针 Y 与各自行中线比较」判定，绕开移动端 elementFromPoint 的判定错乱。
  function visibleIndexAtY(clientY) {
    const list = listRef.current
    if (!list) return null
    const rows = Array.from(list.querySelectorAll('.task-item'))
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return rows.length - 1
  }

  function onGripDown(e, visibleIdx) {
    if (editingId) return
    e.preventDefault()
    const id = tasks[visibleIdx].id
    drag.current = {
      id,
      from: visibleIdx,
      startY: e.clientY,
      armed: false, // 长按是否激活
      moved: false,
      over: visibleIdx,
    }
    // 按住达到时长才进入可拖动状态；等待期内移动过多则视为滑动浏览
    longPressTimer.current = setTimeout(() => {
      const d = drag.current
      if (d && d.id === id && !d.armed) {
        d.armed = true
        setArmedId(id)
        try {
          navigator.vibrate && navigator.vibrate(15)
        } catch {
          /* 不支持震动忽略 */
        }
      }
    }, LONG_PRESS_MS)
  }

  function onGripMove(e) {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.startY
    // 尚未长按激活：移动过多则取消（当作滚动/滑动，不进入拖动）
    if (!d.armed) {
      if (Math.abs(dy) > MOVE_CANCEL) {
        clearTimeout(longPressTimer.current)
        drag.current = null
      }
      return
    }
    // 已激活：超过阈值才真正开始排序
    if (!d.moved && Math.abs(dy) < MOVE_START) return
    d.moved = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 某些环境不支持指针捕获，忽略 */
    }
    setDragId(d.id)
    const idx = visibleIndexAtY(e.clientY)
    if (idx != null && idx !== d.over) {
      d.over = idx
      setOverIdx(idx)
    }
  }

  function onGripUp() {
    const d = drag.current
    if (!d) return
    clearTimeout(longPressTimer.current)
    if (d.armed && d.moved && d.over != null && d.over !== d.from) {
      db.reorderTask(day, d.from, d.over)
      refresh()
    }
    drag.current = null
    setDragId(null)
    setOverIdx(null)
    setArmedId(null)
  }

  return (
    <div className="page tasks-page">
      {/* 想做的事（灵感池）：随手记临时想法，不绑定记录日 */}
      <div className="card idea-card">
        <div className="card-title">
          想做的事
          <span className="idea-head-right">
            <span className="idea-count">{ideas.length} 条</span>
            <button className="checkin-link" onClick={() => setIdeaOpen((o) => !o)}>
              {ideaOpen ? '收起' : '展开'}
            </button>
          </span>
        </div>
        {ideaOpen && (
          <>
            <div className="idea-add">
              <input
                className="idea-input"
                value={idea}
                placeholder="临时想法、想做的事…（回车添加）"
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddIdea()}
              />
              <button className="idea-add__btn" onClick={handleAddIdea}>
                添加
              </button>
            </div>
            <div className="idea-list">
              {ideas.length === 0 ? (
                <div className="muted">还没有记录，想到什么随时记一笔。</div>
              ) : (
                ideas.map((it) => (
                  <div className="idea-item" key={it.id}>
                    <span className="idea-text">{it.text}</span>
                    <button
                      className="idea-del"
                      onClick={() => handleDeleteIdea(it.id)}
                      aria-label="删除"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* 今日待办 */}
      <div className="card">
        <div className="card-title">
          今日待办
          <span className="task-head-right">
            <span className="task-rate">
              {done}/{total}
              <em>{rate}%</em>
            </span>
            <button className="checkin-link" onClick={() => onNav('taskHistory')}>
              历史任务 →
            </button>
          </span>
        </div>

        {/* 记录日 + 下一天（手动推进，切换时当日数据已存档） */}
        <div className="task-dayrow">
          <span className="task-daylabel">记录日</span>
          <span className="task-dayval">{mmdd(day)}</span>
          <button className="task-nextday" onClick={nextDay}>
            下一天 →
          </button>
        </div>

        {total > 0 && (
          <div className="task-progress">
            <div className="task-progress__fill" style={{ width: `${rate}%` }} />
          </div>
        )}

        <div className="task-add">
          <input
            className="task-input"
            value={input}
            placeholder="添加一件待办…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="task-add__btn" onClick={handleAdd}>
            添加
          </button>
        </div>

        <div className="task-time-row">
          <label className="task-time-field">
            <span>开始</span>
            <input
              type="time"
              className="task-time-input"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
            />
          </label>
          <label className="task-time-field">
            <span>预计(分)</span>
            <input
              type="number"
              min="0"
              className="task-est-input"
              value={estInput}
              placeholder="如 60"
              onChange={(e) => setEstInput(e.target.value)}
            />
          </label>
        </div>

        <div className="task-list" ref={listRef}>
          {total === 0 && (
            <div className="muted">还没有待办，上面添加一件吧。</div>
          )}
          {tasks.map((t, i) => (
            <div
              key={t.id}
              data-visible={i}
              className={
                'task-item' +
                (t.done ? ' done' : '') +
                (armedId === t.id ? ' arming' : '') +
                (dragId === t.id ? ' dragging' : '') +
                (overIdx === i && dragId && dragId !== t.id ? ' drop-over' : '')
              }
            >
              {/* 拖拽交互区（需求 2）：视觉手柄已删除，保留左侧透明 hit-area，长按仍可拖动排序 */}
              <span
                className="task-grip"
                role="button"
                aria-label="拖动排序（长按）"
                onPointerDown={(e) => onGripDown(e, i)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
              />
              <button
                className="task-check"
                onClick={() => handleToggle(t.id)}
                aria-label="切换完成"
              >
                {t.done && <CheckIcon />}
              </button>
              {editingId === t.id ? (
                <textarea
                  className="task-edit-input"
                  value={editText}
                  autoFocus
                  rows={1}
                  ref={(el) => { if (el) autoGrow(el) }}
                  onChange={(e) => { setEditText(e.target.value); autoGrow(e.target) }}
                  onKeyDown={(e) => {
                    // Enter 换行，Ctrl/⌘+Enter 保存（需求 3：多行编辑）
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      saveEdit()
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setEditText('')
                    }
                  }}
                  onBlur={saveEdit}
                />
              ) : (
                <div className="task-main" onClick={() => startEdit(t)}>
                  <span className="task-title">{t.title}</span>
                  {timeLabel(t) && <span className="task-time">{timeLabel(t)}</span>}
                </div>
              )}
              <button
                className="task-del"
                onClick={() => handleDelete(t.id)}
                aria-label="删除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 需求 5：上一周周复盘（今日待办下方 / 长期计划上方；0.32.1 只展示「下周重点」） */}
      <div className="card weekly-review-card">
        <div className="card-title">
          上一周周复盘
          <span className="wr-range">{mmdd(lastMonday)} ~ {mmdd(lastSunday)}</span>
          <button className="checkin-link" onClick={() => onNav('retrospect', { focusWeek: lastSunday })}>
            完整周复盘 →
          </button>
        </div>
        {lastWeekReview && lastWeekReview.next ? (
          <div className="wr-body">
            {/* 1.1.3：去掉灰色「下周重点」标签，只保留内容本身 */}
            <div className="wr-field"><div className="wr-value">{lastWeekReview.next}</div></div>
          </div>
        ) : (
          <div className="muted">上周还没有写下周重点</div>
        )}
      </div>

      {/* 长期计划（按月 / 年 / 五年周期存储，可切换周期回顾） */}
      <div className="card">
        <div className="card-title">
          长期计划
          <button className="checkin-link" onClick={() => onNav('retrospect')}>
            历史回顾 →
          </button>
        </div>
        <PlanEditor
          periods={monthPeriods}
          value={{ period: planSel.month, text: planText.month }}
          onPeriod={(p) => onPlanPeriod('month', p)}
          onValue={(v) => onPlanValue('month', v)}
        />
        <PlanEditor
          periods={yearPeriods}
          value={{ period: planSel.year, text: planText.year }}
          onPeriod={(p) => onPlanPeriod('year', p)}
          onValue={(v) => onPlanValue('year', v)}
        />
        <PlanEditor
          periods={fivePeriods}
          value={{ period: planSel.fiveYear, text: planText.fiveYear }}
          onPeriod={(p) => onPlanPeriod('fiveYear', p)}
          onValue={(v) => onPlanValue('fiveYear', v)}
        />
      </div>

      {/* 月度复盘弹窗：每月最后一天自动弹出 */}
      {showMonthReview && (
        <Modal title={`月度复盘 · ${planTitle('month', monthKey(date))}`} onClose={closeMonthReview}>
          <div className="review-fields">
            <label className="field">
              <span>本月小结</span>
              <textarea
                value={mr.summary}
                onChange={(e) => setMr((p) => ({ ...p, summary: e.target.value }))}
                placeholder="这个月推进了什么？"
              />
            </label>
            <label className="field">
              <span>本月不足</span>
              <textarea
                value={mr.lack}
                onChange={(e) => setMr((p) => ({ ...p, lack: e.target.value }))}
                placeholder="哪些地方没做好？"
              />
            </label>
            <label className="field">
              <span>下月重点</span>
              <textarea
                value={mr.nextFocus}
                onChange={(e) => setMr((p) => ({ ...p, nextFocus: e.target.value }))}
                placeholder="下个月最该盯住的一件事"
              />
            </label>
            <button className="primary" onClick={saveMonthReview}>
              保存月度复盘
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default Tasks
