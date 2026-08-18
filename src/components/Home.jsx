import React, { useState, useEffect } from 'react'
import { db } from '../store/db.js'
import { addDays, mmdd, formatDateCN, getLunarString, getRemaining, getWeekCN, todayStr } from '../utils/date.js'

function useNow(intervalMs) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function greetingOf(h) {
  if (h < 5) return '凌晨好'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  if (h < 23) return '晚上好'
  return '夜深了'
}

// 描边 SVG 勾选图标（遵循 P0：禁止 emoji 作功能图标）
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  )
}

// ---- 打卡草稿：单项打卡先暂存到本地，切界面/刷新都不会丢，点「保存打卡」才写入历史 ----
const CHECKIN_DRAFT_KEY = 'zion-checkin-draft'
function loadCheckInDrafts() {
  try { return JSON.parse(localStorage.getItem(CHECKIN_DRAFT_KEY)) || {} } catch { return {} }
}
const checkInDrafts = loadCheckInDrafts()
function getCheckInDraft(d) {
  if (checkInDrafts[d]) return checkInDrafts[d]
  const c = db.getCheckIn(d) || {}
  const { note, ...ci } = c
  return { ci, note: note || '' }
}
function setCheckInDraft(d, patch) {
  checkInDrafts[d] = { ...(checkInDrafts[d] || {}), ...patch }
  localStorage.setItem(CHECKIN_DRAFT_KEY, JSON.stringify(checkInDrafts))
}

// ---- 人生倒计时条（深色=已度过，每分钟动态）----
const LIFE_DEFS = [
  { key: 'life', label: '人生还剩', cls: 'red' },
  { key: 'year', label: '今年还剩', cls: 'green' },
  { key: 'month', label: '本月还剩', cls: 'blue' },
  { key: 'today', label: '今日还剩', cls: 'orange' },
]

function LifeRemaining() {
  const [rem, setRem] = useState(null)

  useEffect(() => {
    const settings = db.getSettings()
    const birthDate = settings.birthDate || '2002-12-02'
    const lifeExp = settings.lifeExpectancy || 80
    const tick = () => setRem(getRemaining(birthDate, lifeExp))
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  if (!rem) return null

  return (
    <div className="life-remaining">
      {LIFE_DEFS.map((d) => {
        const item = rem[d.key]
        return (
          <div key={d.key} className={`life-bar life-bar--${d.cls}`}>
            <div className="life-bar__fill" style={{ width: `${item.elapsed * 100}%` }} />
            <span className="life-bar__label">{d.label}</span>
            <span className="life-bar__value">{item.value}{item.unit}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---- 首页打卡（并行网格；手动保存：记录日只在点击「保存打卡」后 +1，可改日期补录任意一天）----
function CheckInPanel({ onNav }) {
  const items = db.CHECKIN_ITEMS
  const [day, setDay] = useState(() => db.getRecordDay('checkIn'))
  const init = getCheckInDraft(day)
  const [ci, setCi] = useState(init.ci)
  const [note, setNote] = useState(init.note)

  function loadDay(d) {
    const dr = getCheckInDraft(d)
    setCi(dr.ci)
    setNote(dr.note)
  }

  // 切换记录日（可回补已删除/缺失的某一天，如 2026-07-29）
  function onDayChange(e) {
    const d = e.target.value || day
    setDay(d)
    db.setRecordDay('checkIn', d)
    loadDay(d)
  }

  // 单项打卡只暂存到草稿（本地），不立即写入历史；切界面/刷新都不会丢，保存后才入库
  function toggle(key) {
    const next = { ...ci, [key]: !ci[key] }
    setCi(next)
    setCheckInDraft(day, { ci: next, note })
  }

  function onNote(e) {
    const v = e.target.value
    setNote(v)
    setCheckInDraft(day, { ci, note: v })
  }

  // 手动保存：写入当前记录日历史，清空草稿，记录日推进到次日
  function saveCheckIn() {
    db.setCheckIn(day, { ...ci, note })
    delete checkInDrafts[day]
    localStorage.setItem(CHECKIN_DRAFT_KEY, JSON.stringify(checkInDrafts))
    const next = addDays(day, 1)
    setDay(next)
    db.setRecordDay('checkIn', next)
    loadDay(next)
  }

  const doneCount = items.filter((it) => !!ci[it.key]).length

  return (
    <div className="card checkin-panel">
      <div className="checkin-head">
        <span className="card-title">每日打卡</span>
        <span className="checkin-count"><b>{doneCount}</b>/{items.length}</span>
      </div>

      {/* 记录日 + 日期选择（可补录任意一天） */}
      <div className="checkin-dayrow">
        <span className="checkin-daychip">
          <span className="checkin-daychip__label">记录日</span>
          <span className="checkin-daychip__val">{mmdd(day)}</span>
        </span>
        <input type="date" className="checkin-datepicker" value={day} onChange={onDayChange} title="补录任意一天" />
      </div>

      <div className="checkin-grid">
        {items.map((it) => (
          <button
            key={it.key}
            className={'checkin-cell' + (ci[it.key] ? ' done' : '')}
            onClick={() => toggle(it.key)}
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="checkin-note">
        <input
          className="book-input checkin-note__input"
          placeholder="打卡小结 / 未完成原因…"
          value={note}
          onChange={onNote}
        />
      </div>

      <div className="checkin-actions">
        <button className="primary checkin-save" onClick={saveCheckIn}>
          <CheckIcon /> 保存打卡
        </button>
      </div>

      {/* 历史打卡入口：固定在右下角 */}
      <div className="checkin-footrow">
        <button className="checkin-link" onClick={() => onNav('history')}>历史打卡 →</button>
      </div>
    </div>
  )
}

// ---- Zion 个人宣言（1.0.0 正式版视觉：大关键词 + 小陈述，Editorial / Manifesto Poster 排版）----
// 原文必须完整保留（完整句为小字正文）；大字为提炼的核心表达，形成「总纲 + 战斗宣言」层级
function Manifesto() {
  return (
    <div className="card manifesto">
      {/* ① 总纲：超大字 + 完整陈述 */}
      <section className="mf-block mf-block--lead">
        <h1 className="mf-big">活在未来</h1>
        <p className="mf-small">长期主义，量化成果，进步记录，不是简单重复！</p>
      </section>

      {/* ② 时间 / 惩罚 */}
      <section className="mf-block">
        <div className="mf-big mf-big--md">惩罚愚蠢</div>
        <p className="mf-small">时间惩罚愚蠢时毫不留情。为了半年后的自己！！</p>
      </section>

      {/* ③ 战争（左侧大字 + 强调字） */}
      <section className="mf-block">
        <div className="mf-big mf-big--md">
          战争<span className="mf-accent"> · 抢</span>
        </div>
        <p className="mf-small">这是我的战争，把自己从那些软件里抢回来！</p>
      </section>

      {/* ④ 巨大数字：5年 / 10年 作为视觉主体 */}
      <section className="mf-block">
        <div className="mf-years"><span>5年</span><i>/</i><span>10年</span></div>
        <p className="mf-small">现在浪费的时间日积月累，消耗的是未来5年，10年更好的生活，更好的发展</p>
      </section>

      {/* ⑤ 三词横向排列 */}
      <section className="mf-block">
        <div className="mf-words"><span>心气</span><span>意气</span><span>勇气</span></div>
        <p className="mf-small">我永远都不会丢掉我的心气，意气与勇气</p>
      </section>

      {/* ⑥ 眼见为实 */}
      <section className="mf-block">
        <div className="mf-big mf-big--md">眼见为实</div>
        <p className="mf-small">去他妈的幸存者偏差，永远不甘失败不服输，做出改变让自己更强大，眼见为实。</p>
      </section>
    </div>
  )
}

// ---- 首页主组件 ----
export default function Home({ onNav, date }) {
  const now = useNow(60000)
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')

  const reviews = db.get().reviews || {}
  const yesterday = addDays(date, -1)
  const topThing =
    (reviews[date] && reviews[date].tomorrow) ||
    (reviews[yesterday] && reviews[yesterday].tomorrow) ||
    ''

  const todayStrVal = todayStr(now)

  return (
    <div className="page home-page">
      {/* 顶部：日期星期（上）+ 问候（下），右侧时钟 */}
      <div className="hero">
        <div className="hero-left">
          <div className="hero-date">
            <span className="date-main">{formatDateCN(todayStrVal)}</span>
            <span className="weekday">{getWeekCN(todayStrVal)}</span>
          </div>
          <div className="lunar">{getLunarString(todayStrVal)}</div>
          <div className="hero-greet">{greetingOf(now.getHours())}</div>
        </div>
        <div className="hero-clock">{hh}:{mm}</div>
      </div>

      {/* Zion 个人宣言（1.0.0 核心总纲；原文保留，极简宣言排版） */}
      <Manifesto />

      {/* 今天最重要的事 */}
      <div className="card">
        <div className="card-title">今天最重要的事</div>
        {topThing ? (
          <div className="big-thing">{topThing}</div>
        ) : (
          <div className="muted">还没设定</div>
        )}
      </div>

      {/* 打卡（并行网格） */}
      <CheckInPanel onNav={onNav} />

      {/* 人生倒计时（动态进度条） */}
      <LifeRemaining />
    </div>
  )
}
