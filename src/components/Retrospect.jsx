import React, { useState, useRef, useMemo, useEffect } from 'react'
import { db } from '../store/db.js'
import { formatDateCN, todayStr, addDays, mmdd } from '../utils/date.js'
import { getReviewGamePeriod } from '../utils/gamePeriod.js'
import Modal from './Modal.jsx'

// 把 keyed 对象转为 [{key, title, text}]，按 key 倒序（最新在前）
function toList(obj, titleOf) {
  return Object.keys(obj || {})
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({ key, title: titleOf(key), text: obj[key] || '' }))
}

function planTitle(kind, period) {
  if (kind === 'month') {
    const [y, mm] = period.split('-').map(Number)
    return `${y}年${mm}月计划`
  }
  if (kind === 'year') return `${period}年度计划`
  const n = Number(period)
  return `${n}–${n + 4} 五年计划`
}

function reviewTitle(kind, period) {
  if (kind === 'month') {
    const [y, mm] = period.split('-').map(Number)
    return `${y}年${mm}月复盘`
  }
  return `${period}年复盘`
}

// 复盘对象 -> 单行摘要（月/年复盘用 summary/lack/nextFocus）
function reviewSnippet(o) {
  if (!o) return ''
  const parts = [o.summary, o.lack, o.nextFocus].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return ''
}

// 每日复盘对象 -> 四字段合并摘要（确保历史回顾里 4 个文本框内容都可见）
function dailySnippet(o) {
  if (!o) return ''
  const parts = []
  if (o.closer) parts.push(o.closer)
  if (o.pleasure) parts.push(o.pleasure)
  if (o.gameMinutes) parts.push(`游戏 ${o.gameMinutes} 分钟`)
  if (o.tomorrow) parts.push(o.tomorrow)
  const s = parts.join(' · ')
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

// 全文检索辅助
function dailyText(o) {
  return [o.closer, o.pleasure, o.gameMinutes != null ? `游戏${o.gameMinutes}分钟` : '', o.tomorrow]
    .filter(Boolean).join(' ').toLowerCase()
}
function reviewText(o) {
  return [o.summary, o.lack, o.nextFocus].filter(Boolean).join(' ').toLowerCase()
}
function planText(text) {
  return (text || '').toLowerCase()
}
function matchQuery(title, text, q) {
  if (!q) return true
  const s = (title + ' ' + (text || '')).toLowerCase()
  return s.includes(q.toLowerCase())
}

// 分钟 -> 人类可读时长
function fmtDur(min) {
  const m = Math.round(Number(min) || 0)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h} 小时 ${mm} 分` : `${h} 小时`
}

// 周期范围：周=周一~周日，月=自然月，年=自然年
function rangeOf(kind) {
  const t = todayStr()
  const d = new Date(t + 'T00:00:00')
  if (kind === 'week') {
    const day = d.getDay() // 0=周日 .. 6=周六
    const monOffset = day === 0 ? -6 : -(day - 1)
    const thisMonday = addDays(t, monOffset)
    const thisSunday = addDays(t, monOffset + 6)
    return { from: thisMonday, to: thisSunday, label: `${thisMonday.slice(5)} ~ ${thisSunday.slice(5)}（本周一至本周日）` }
  }
  if (kind === 'month') {
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const mm = String(m).padStart(2, '0')
    const last = new Date(y, m, 0).getDate()
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}`, label: `${y}年${m}月` }
  }
  const y = d.getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}年` }
}

// 在 [from,to] 内统计游戏时长：累计分钟 + 记录天数 + 日均
function gameStatFor(dailyList, from, to) {
  let total = 0
  let days = 0
  dailyList.forEach((it) => {
    if (it.key >= from && it.key <= to) {
      const g = Number(it.o.gameMinutes)
      if (!isNaN(g)) {
        total += g
        days += 1
      }
    }
  })
  return { total, days, avg: days ? Math.round(total / days) : 0 }
}

function Caret({ open }) {
  return (
    <span className={'retro-caret' + (open ? ' is-open' : '')} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
    </span>
  )
}

// 每日复盘：按 年 -> 月 分组（降序），用于可收起的层级结构
function groupByYearMonth(list) {
  const years = {}
  list.forEach((it) => {
    const y = it.key.slice(0, 4)
    const m = it.key.slice(0, 7)
    years[y] = years[y] || { months: {} }
    years[y].months[m] = years[y].months[m] || []
    years[y].months[m].push(it)
  })
  return Object.keys(years)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((y) => ({
      year: y,
      months: Object.keys(years[y].months)
        .sort((a, b) => (a < b ? 1 : -1))
        .map((m) => ({ month: m, items: years[y].months[m] })),
    }))
}

// 每日复盘单行：默认收起（仅显示日期 + 一行预览），点按展开四字段；长按进入编辑
function DailyReviewRow({ item, open, onToggle, onEdit }) {
  const o = item.o
  const preview = dailySnippet(o)
  const pressTimer = useRef(null)
  const longFired = useRef(false)
  function onDown() {
    longFired.current = false
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => {
      longFired.current = true
      onEdit(item)
    }, 500)
  }
  function onUp() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }
  function handleClick() {
    if (longFired.current) { longFired.current = false; return }
    onToggle()
  }
  return (
    <div className={'retro-row retro-row--daily' + (open ? ' is-open' : '')}>
      <button
        className="retro-row__head"
        onClick={handleClick}
        onTouchStart={onDown}
        onTouchEnd={onUp}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={onUp}
      >
        <div className="retro-row__main">
          <div className="retro-row__title">
            {formatDateCN(item.key)}
            {item.o.gameMinutes !== '' && item.o.gameMinutes != null ? (
              <span className="retro-row__game">{fmtDur(item.o.gameMinutes)}</span>
            ) : null}
          </div>
          {!open && (
            <div className="retro-row__text">
              {preview ? preview : <span className="muted">未填写</span>}
            </div>
          )}
        </div>
        <Caret open={open} />
      </button>
      {open && (
        <div className="retro-row__detail">
          <div className="dr-field"><div className="dr-label">1. 今天做了什么让未来更近？</div><div className="dr-value">{o.closer || <span className="muted">未填写</span>}</div></div>
          <div className="dr-field"><div className="dr-label">2. 今天在什么事上是及时快乐？</div><div className="dr-value">{o.pleasure || <span className="muted">未填写</span>}</div></div>
          <div className="dr-field"><div className="dr-label">今天游戏时长</div><div className="dr-value">{o.gameMinutes ? `${o.gameMinutes} 分钟` : <span className="muted">未填写</span>}</div></div>
          <div className="dr-field"><div className="dr-label">3. 明天最重要的事情是什么？</div><div className="dr-value">{o.tomorrow || <span className="muted">未填写</span>}</div></div>
        </div>
      )}
    </div>
  )
}

// 计划行：默认收起（标题 + 一行预览），点按展开全文；每条独立收起
// anchor：可选定位锚点（data-anchor），供外部「跳到对应条目」使用
function PlanRow({ title, text, open, onToggle, anchor }) {
  const raw = (text || '').replace(/\s+/g, ' ').trim()
  const preview = raw.length > 50 ? raw.slice(0, 50) + '…' : raw
  return (
    <div className={'retro-row retro-row--plan' + (open ? ' is-open' : '')} data-anchor={anchor}>
      <button className="retro-row__head" onClick={onToggle}>
        <div className="retro-row__main">
          <div className="retro-row__title">{title}</div>
          {!open && (
            <div className="retro-row__text">
              {raw ? preview : <span className="muted">未填写</span>}
            </div>
          )}
        </div>
        <Caret open={open} />
      </button>
      {open && (
        <div className="retro-row__detail retro-row__text">
          {text ? text : <span className="muted">未填写</span>}
        </div>
      )}
    </div>
  )
}

// 计划卡片（标题 + 计数 + 空态 + 可单独收起的计划列表）
// anchorPrefix：若提供，则为每条渲染 data-anchor = anchorPrefix + item.key
function PlanCard({ title, list, openMap, onToggle, anchorPrefix }) {
  return (
    <div className="card retro-section">
      <div className="card-title">{title}{list.length ? ` · ${list.length}` : ''}</div>
      {list.length === 0 ? (
        <div className="muted">还没有任何{title}记录</div>
      ) : (
        <div className="retro-list">
          {list.map((i) => (
            <PlanRow
              key={i.pk}
              title={i.title}
              text={i.text}
              open={!!openMap[i.pk]}
              onToggle={() => onToggle(i.pk)}
              anchor={anchorPrefix ? anchorPrefix + i.key : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// 普通分区（月/年复盘）
function Section({ title, list, emptyText }) {
  return (
    <div className="card retro-section">
      <div className="card-title">{title}{list.length ? ` · ${list.length}` : ''}</div>
      {list.length === 0 ? (
        <div className="muted">{emptyText}</div>
      ) : (
        <div className="retro-list">
          {list.map((item) => (
            <div className="retro-row" key={item.key}>
              <div className="retro-row__title">{item.title}</div>
              <div className="retro-row__text">
                {item.text ? item.text : <span className="muted">未填写</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Retrospect({ onBack, focusWeek }) {
  const plansMonth = db.getAllPlans('month')
  const plansYear = db.getAllPlans('year')
  const plansFive = db.getAllPlans('fiveYear')
  const monthReviews = db.getAllMonthReviews()
  const yearReviews = db.getAllYearReviews()
  const daily = (db.get() && db.get().reviews) || {}
  const [expanded, setExpanded] = useState({})
  const [q, setQ] = useState('')
  const [editItem, setEditItem] = useState(null)

  // 年 / 月 / 计划 收起状态：默认展开「当年 / 当月」，其余收起，避免篇幅过长
  const now = new Date()
  // 0.32.1：每日复盘默认收起（每次进入历史回顾都恢复默认，不继承上次状态；搜索时自动全展开）
  const [openYears, setOpenYears] = useState(() => ({}))
  const [openMonths, setOpenMonths] = useState(() => ({}))
  // 0.32.1 定位：若从任务栏「完整周复盘」带 focusWeek 进入，初始展开对应那条周复盘
  const [openPlans, setOpenPlans] = useState(() => (focusWeek ? { ['week:' + focusWeek]: true } : {}))
  const [gamePeriod, setGamePeriod] = useState('week') // 'week' | 'month' | 'year'

  // 定位：聚焦到指定周复盘条目（展开 + 滚动到可视区）
  useEffect(() => {
    if (!focusWeek) return
    const anchor = 'week:' + focusWeek
    setOpenPlans((p) => ({ ...p, [anchor]: true }))
    const t = setTimeout(() => {
      const el = document.querySelector('[data-anchor="' + anchor + '"]')
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 60)
    return () => clearTimeout(t)
  }, [focusWeek])

  const dailyList = Object.keys(daily)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({ key, o: daily[key] }))

  const gameStat = useMemo(() => {
    // 需求 6：周周期用 getReviewGamePeriod（周一整天回看上一周，周二起本周）；月/年沿用 rangeOf
    const r =
      gamePeriod === 'week'
        ? (() => {
            const p = getReviewGamePeriod(todayStr())
            return { from: p.periodStart, to: p.periodEnd, label: p.label }
          })()
        : rangeOf(gamePeriod)
    return { ...gameStatFor(dailyList, r.from, r.to), range: r }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyList, gamePeriod])

  const dailyFiltered = dailyList.filter((it) => matchQuery(formatDateCN(it.key), dailyText(it.o), q))
  const groups = groupByYearMonth(dailyFiltered)
  const searching = !!q.trim()

  const monthList = toList(monthReviews, (k) => reviewTitle('month', k))
    .map((i) => ({ ...i, text: reviewSnippet(monthReviews[i.key]) }))
    .filter((i) => matchQuery(i.title, i.text, q))
  const yearList = toList(yearReviews, (k) => reviewTitle('year', k))
    .map((i) => ({ ...i, text: reviewSnippet(yearReviews[i.key]) }))
    .filter((i) => matchQuery(i.title, i.text, q))

  // ---- 需求 4：独立周复盘（数据源=每日复盘里周日填写的 weekly 字段，零冗余）----
  // 0.32.1：每条周复盘独立收起/展开（默认收起），复用 PlanRow 的可收起交互
  const weeklyList = dailyList
    .filter((it) => it.o && it.o.weekly)
    .map((it) => {
      const w = it.o.weekly
      const mon = addDays(it.key, -6)
      const title = `周复盘 · ${mmdd(mon)} ~ ${mmdd(it.key)}`
      const text = [w.advanced, w.issue, w.next].filter(Boolean).join(' · ')
      return { key: it.key, title, text: text || '未填写', pk: 'week:' + it.key }
    })
    .filter((i) => matchQuery(i.title, i.text, q))
  const planMonthList = toList(plansMonth, (k) => planTitle('month', k))
    .map((i) => ({ ...i, text: i.text, pk: 'month:' + i.key }))
    .filter((i) => matchQuery(i.title, planText(i.text), q))
  const planYearList = toList(plansYear, (k) => planTitle('year', k))
    .map((i) => ({ ...i, text: i.text, pk: 'year:' + i.key }))
    .filter((i) => matchQuery(i.title, planText(i.text), q))
  const planFiveList = toList(plansFive, (k) => planTitle('fiveYear', k))
    .map((i) => ({ ...i, text: i.text, pk: 'fiveYear:' + i.key }))
    .filter((i) => matchQuery(i.title, planText(i.text), q))

  function toggleYear(y) { setOpenYears((p) => ({ ...p, [y]: !p[y] })) }
  function toggleMonth(m) { setOpenMonths((p) => ({ ...p, [m]: !p[m] })) }
  function togglePlan(pk) { setOpenPlans((p) => ({ ...p, [pk]: !p[pk] })) }

  function saveEdit() {
    if (!editItem) return
    db.setReview(editItem.key, editItem.o)
    setEditItem(null)
  }

  return (
    <div className="page history-page">
      <div className="history-top">
        <button className="back-btn" onClick={onBack}>
          ← 返回
        </button>
        <span className="card-title">历史回顾</span>
      </div>

      {/* 搜索框 */}
      <div className="retro-search-wrap">
        <input
          className="retro-search"
          placeholder="搜索复盘 / 计划内容…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* 游戏时长统计：周 / 月 / 年（固定按钮，周=周一至周日） */}
      <div className="card retro-section">
        <div className="card-title">游戏时长统计</div>
        <div className="retro-game__tabs">
          <button className={'retro-game__tab' + (gamePeriod === 'week' ? ' is-active' : '')} onClick={() => setGamePeriod('week')}>每周</button>
          <button className={'retro-game__tab' + (gamePeriod === 'month' ? ' is-active' : '')} onClick={() => setGamePeriod('month')}>每月</button>
          <button className={'retro-game__tab' + (gamePeriod === 'year' ? ' is-active' : '')} onClick={() => setGamePeriod('year')}>每年</button>
        </div>
        <div className="retro-game__range">{gameStat.range.label}</div>
        {gameStat.days === 0 ? (
          <div className="muted" style={{ padding: '6px 2px 0' }}>该周期内还没有游戏时长记录</div>
        ) : (
          <div className="retro-game__stats">
            <div className="retro-game__cell">
              <div className="retro-game__val">{fmtDur(gameStat.total)}</div>
              <div className="retro-game__lbl">总时长</div>
            </div>
            <div className="retro-game__cell">
              <div className="retro-game__val">{fmtDur(gameStat.avg)}</div>
              <div className="retro-game__lbl">日均</div>
            </div>
            <div className="retro-game__cell">
              <div className="retro-game__val">{gameStat.days} 天</div>
              <div className="retro-game__lbl">记录天数</div>
            </div>
          </div>
        )}
      </div>

      {/* 每日复盘置顶：按 年 -> 月 两级收起（搜索时自动全展开） */}
      <div className="card retro-section">
        <div className="card-title">每日复盘{dailyFiltered.length ? ` · ${dailyFiltered.length}` : ''}</div>
        {dailyFiltered.length === 0 ? (
          <div className="muted">{q ? '没有匹配的内容' : '还没有任何每日复盘记录'}</div>
        ) : (
          <div className="retro-groups">
            {groups.map((y) => {
              const yOpen = openYears[y.year] || searching
              const yCount = y.months.reduce((s, m) => s + m.items.length, 0)
              return (
                <div className="retro-year" key={y.year}>
                  <button className="retro-group__head" onClick={() => toggleYear(y.year)}>
                    <span className="retro-group__title">{y.year} 年</span>
                    <span className="retro-group__count">{yCount} 篇</span>
                    <Caret open={yOpen} />
                  </button>
                  {yOpen && (
                    <div className="retro-year__body">
                      {y.months.map((m) => {
                        const mOpen = openMonths[m.month] || searching
                        const mm = Number(m.month.slice(5))
                        return (
                          <div className="retro-month" key={m.month}>
                            <button className="retro-group__head retro-group__head--sub" onClick={() => toggleMonth(m.month)}>
                              <span className="retro-group__title">{mm} 月</span>
                              <span className="retro-group__count">{m.items.length} 篇</span>
                              <Caret open={mOpen} />
                            </button>
                            {mOpen && (
                              <div className="retro-list">
                                {m.items.map((it) => (
                                  <DailyReviewRow
                                    key={it.key}
                                    item={it}
                                    open={!!expanded[it.key]}
                                    onToggle={() => setExpanded((p) => ({ ...p, [it.key]: !p[it.key] }))}
                                    onEdit={setEditItem}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 需求 4：独立周复盘（数据源=周日复盘的 weekly 字段；0.32.1 起每条默认收起、点击展开） */}
      <PlanCard title="周复盘" list={weeklyList} openMap={openPlans} onToggle={togglePlan} anchorPrefix="week:" />

      {/* 月复盘 / 年复盘 跟随 */}
      <Section title="月复盘" emptyText="还没有任何月度复盘记录" list={monthList} />
      <Section title="年复盘" emptyText="还没有任何年度复盘记录" list={yearList} />

      {/* 计划：每条独立收起 */}
      <PlanCard title="月计划" list={planMonthList} openMap={openPlans} onToggle={togglePlan} />
      <PlanCard title="年度计划" list={planYearList} openMap={openPlans} onToggle={togglePlan} />
      <PlanCard title="五年计划" list={planFiveList} openMap={openPlans} onToggle={togglePlan} />

      {/* 长按每日复盘 -> 编辑弹窗 */}
      {editItem && (
        <Modal title={`编辑复盘 · ${formatDateCN(editItem.key)}`} onClose={() => setEditItem(null)}>
          <div className="review-fields">
            <label className="field">
              <span>1. 今天做了什么让未来更近？</span>
              <textarea
                value={editItem.o.closer || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, o: { ...p.o, closer: e.target.value } }))}
              />
            </label>
            <label className="field">
              <span>2. 今天在什么事上是及时快乐？</span>
              <textarea
                value={editItem.o.pleasure || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, o: { ...p.o, pleasure: e.target.value } }))}
              />
            </label>
            <label className="field">
              <span>今天在游戏上花了多久？（分钟）</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={editItem.o.gameMinutes ?? ''}
                onChange={(e) => setEditItem((p) => ({ ...p, o: { ...p.o, gameMinutes: e.target.value } }))}
              />
            </label>
            <label className="field">
              <span>3. 明天最重要的事情是什么？</span>
              <input
                type="text"
                value={editItem.o.tomorrow || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, o: { ...p.o, tomorrow: e.target.value } }))}
              />
            </label>
            <button className="primary" onClick={saveEdit}>保存修改</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
