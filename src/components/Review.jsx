import React, { useState, useEffect, useRef } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { addDays, formatDateCN, mmdd, yearKey, isLastDayOfYear, getWeekCN } from '../utils/date.js'
import Modal from './Modal.jsx'

// 未保存草稿持久化：切出复盘栏再切回，已填未保存的数据仍在（日复盘）
const REVIEW_DRAFT_KEY = 'zion-review-draft'
function getReviewDraft(day) {
  try {
    const raw = localStorage.getItem(REVIEW_DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return d.day === day ? d.r : null
  } catch {
    return null
  }
}
function setReviewDraft(day, r) {
  try { localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ day, r })) } catch {}
}
function clearReviewDraft() {
  try { localStorage.removeItem(REVIEW_DRAFT_KEY) } catch {}
}

// 周复盘草稿（1.1.5：独立于日复盘草稿，以周日日期为键）
const WEEKLY_DRAFT_KEY = 'zion-weekly-draft'
function getWeeklyDraft(sunday) {
  try {
    const raw = localStorage.getItem(WEEKLY_DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return d.day === sunday ? d.w : null
  } catch {
    return null
  }
}
function setWeeklyDraft(sunday, w) {
  try { localStorage.setItem(WEEKLY_DRAFT_KEY, JSON.stringify({ day: sunday, w })) } catch {}
}
function clearWeeklyDraft() {
  try { localStorage.removeItem(WEEKLY_DRAFT_KEY) } catch {}
}

// 计算某日期是周几（0=周日），用本地时间解析避免 UTC 偏移
function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay()
}

export default function Review({ date, onNav }) {
  // 复盘以「记录日」为当日主键：手动保存后推进到次日（去除 6 点自动清空）
  const [day, setDay] = useState(() => db.getRecordDay('review'))
  const [r, setR] = useState(() => getReviewDraft(day) || db.getReview(day) || {})
  const clearedRef = useRef(false)
  useLive(() => { if (!clearedRef.current) setR(getReviewDraft(day) || db.getReview(day) || {}) })
  const [saved, setSaved] = useState(false)

  // ---- 年度复盘（每年最后一天自动新增并弹窗，当年仅一次）----
  const [showYearReview, setShowYearReview] = useState(false)
  const [yr, setYr] = useState({ summary: '', lack: '', nextFocus: '' })

  useEffect(() => {
    const y = yearKey(date)
    if (isLastDayOfYear(date)) {
      db.ensureYearReview(y)
      if (!db.isPrompted('year', y)) {
        const existing = db.getYearReview(y) || {}
        setYr({
          summary: existing.summary || '',
          lack: existing.lack || '',
          nextFocus: existing.nextFocus || '',
        })
        setShowYearReview(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  function saveYearReview() {
    const y = yearKey(date)
    db.setYearReview(y, yr)
    db.markPrompted('year', y)
    setShowYearReview(false)
  }
  function closeYearReview() {
    db.markPrompted('year', yearKey(date))
    setShowYearReview(false)
  }

  useEffect(() => {
    setR(getReviewDraft(day) || db.getReview(day) || {})
    setSaved(false)
  }, [day])

  function update(patch) {
    setR((prev) => {
      const np = { ...prev, ...patch }
      setReviewDraft(day, np)
      return np
    })
  }

  // ---- 1.1.5 周复盘与日复盘彻底分离 ----
  // 周复盘目标日：周日当天 = 当天（当周复盘）；周一~周六 = 最近一个已过去的周日
  // （若该周日的周复盘未保存，则显示「补写周复盘」卡片，保存后消失——记录日推进也不会弄丢周复盘）
  const dow = dayOfWeek(day)
  const isSunday = dow === 0
  const weeklyTarget = addDays(day, -dow)
  const weekRange = `${mmdd(addDays(weeklyTarget, -6))} ~ ${mmdd(weeklyTarget)}`
  const weeklySavedInDb = !!((db.getReview(weeklyTarget) || {}).weekly)

  // 周复盘字段独立状态 + 独立草稿（不再寄生在日复盘 r.weekly 里）
  const [w, setW] = useState(() => getWeeklyDraft(weeklyTarget) || (db.getReview(weeklyTarget) || {}).weekly || {})
  const [weeklySaved, setWeeklySaved] = useState(false)
  const [weeklyErr, setWeeklyErr] = useState('')
  useEffect(() => {
    setW(getWeeklyDraft(weeklyTarget) || (db.getReview(weeklyTarget) || {}).weekly || {})
    setWeeklySaved(false)
    setWeeklyErr('')
  }, [weeklyTarget])

  function updateWeekly(field, v) {
    setW((prev) => {
      const np = { ...prev, [field]: v }
      setWeeklyDraft(weeklyTarget, np)
      return np
    })
  }

  // 周复盘独立保存：三项都填写后才能保存；只写入 weekly 字段，不推进记录日、不触碰日复盘
  function saveWeekly() {
    const a = (w.advanced || '').trim()
    const i = (w.issue || '').trim()
    const n = (w.next || '').trim()
    if (!a || !i || !n) {
      setWeeklyErr('a / b / c 三项都填写后才能保存周复盘')
      return
    }
    setWeeklyErr('')
    db.setReview(weeklyTarget, { weekly: { advanced: a, issue: i, next: n } })
    clearWeeklyDraft()
    setWeeklySaved(true)
  }

  // 上一周周复盘参考 = 目标周日的上一个周日
  const refSunday = addDays(weeklyTarget, -7)
  const lastWeekly = (db.getReview(refSunday) || {}).weekly || null
  const lastWeekRange = `${mmdd(addDays(refSunday, -6))} ~ ${mmdd(refSunday)}`
  const [lastWeeklyOpen, setLastWeeklyOpen] = useState(false)

  // ---- 1.1.5 日复盘保存：四项都必填；且绝不写入 weekly（与周复盘彻底分离）----
  const [saveErr, setSaveErr] = useState('')
  function save() {
    const missing = []
    if (!(r.closer || '').trim()) missing.push('①推进了什么')
    if (!(r.pleasure || '').trim()) missing.push('②及时快乐/分心')
    if (r.gameMinutes == null || r.gameMinutes === '') missing.push('游戏时长')
    if (!(r.tomorrow || '').trim()) missing.push('③明天最重要的事')
    if (missing.length) {
      setSaveErr(`还有未填写的项：${missing.join('、')}——填写后才能保存`)
      return
    }
    setSaveErr('')
    // 关键修复：日复盘保存只写日复盘字段，weekly 一律不随日复盘提交
    const { weekly, ...dailyOnly } = r
    db.setReview(day, dailyOnly)
    clearReviewDraft()
    setSaved(true)
    clearedRef.current = true
    setR({})
    const next = addDays(day, 1)
    setDay(next)
    db.setRecordDay('review', next)
  }

  // 周复盘卡片可见性：周日恒显示当周；周一~周六在上周日周复盘未保存时显示补写卡；
  // 刚保存完保持可见以展示成功提示（切走再回来由数据决定）
  const showWeeklyCard = isSunday || !weeklySavedInDb || weeklySaved

  // ---- 1.1.6 今日任务参考：任务栏当前记录日的任务，只读展示，方便写复盘时对照 ----
  const taskDay = db.getRecordDay('task')
  const todayTasks = db.getTasks(taskDay)
  const taskDoneCount = todayTasks.filter((t) => t.done).length

  return (
    <div className="page">
      <div className="card">
        <div className="review-head">
          <h2>复盘 · {mmdd(day)}</h2>
          <button className="checkin-link" onClick={() => onNav && onNav('retrospect')}>
            历史回顾 →
          </button>
        </div>

        <label className="field">
          <span>1. 今天推进了什么内容让未来更近？</span>
          <textarea
            value={r.closer || ''}
            onChange={(e) => update({ closer: e.target.value })}
          />
        </label>

        <label className="field">
          <span>2. 今天什么事是及时快乐 / 因什么事分心失控？</span>
          <textarea
            value={r.pleasure || ''}
            onChange={(e) => update({ pleasure: e.target.value })}
          />
        </label>

        <label className="field">
          <span>今天在游戏上花了多久？（分钟）</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={r.gameMinutes ?? ''}
            onChange={(e) => update({ gameMinutes: e.target.value })}
          />
        </label>

        <label className="field">
          <span>3. 明天最重要的事情是什么？</span>
          <input
            type="text"
            value={r.tomorrow || ''}
            onChange={(e) => update({ tomorrow: e.target.value })}
          />
        </label>

        <button className="primary" onClick={save}>
          保存复盘
        </button>
        {saveErr && <div className="save-err">{saveErr}</div>}
        {saved && !saveErr && (
          <div className="ok">
            <svg className="ok__check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4 10-10" /></svg>
            已保存，明天首页将显示「明天最重要的事」
          </div>
        )}
      </div>

      {/* 1.1.6：今日任务（任务栏当前记录日），只读展示，写复盘时对照 */}
      <div className="card">
        <div className="review-head">
          <h2>今日任务 · {mmdd(taskDay)}</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {todayTasks.length ? `已完成 ${taskDoneCount}/${todayTasks.length}` : '任务栏今天还没有任务'}
          </span>
        </div>
        {todayTasks.length > 0 && (
          <div className="task-list">
            {todayTasks.map((t) => (
              <div key={t.id} className={'task-item' + (t.done ? ' done' : '')} style={{ cursor: 'default' }}>
                <span className="task-check" style={{ cursor: 'default' }} aria-hidden="true">
                  {t.done && (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4 10-10" /></svg>
                  )}
                </span>
                <span className="task-title">{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 周复盘：周日显示当周复盘；周一~周六若上周日未保存则显示补写卡（与日复盘保存完全分离） */}
      {showWeeklyCard && (
        <div className="card weekly-review-card">
          <div className="review-head">
            <h2>{isSunday ? '周复盘' : '补写周复盘'} · {weekRange}</h2>
            <span className="muted" style={{ fontSize: 12 }}>{isSunday ? '本周一至周日' : '上周日还没保存周复盘，补写保存后此卡消失'}</span>
          </div>

          <label className="field">
            <span>a. 本周推进了什么内容？</span>
            <textarea
              value={w.advanced || ''}
              onChange={(e) => updateWeekly('advanced', e.target.value)}
            />
          </label>

          <label className="field">
            <span>b. 有什么事没有做好 / 被什么事分心比较多？为什么，如何改进？</span>
            <textarea
              value={w.issue || ''}
              onChange={(e) => updateWeekly('issue', e.target.value)}
            />
          </label>

          <label className="field">
            <span>c. 下周重推进什么事？</span>
            <textarea
              value={w.next || ''}
              onChange={(e) => updateWeekly('next', e.target.value)}
            />
          </label>

          {/* 周复盘独立保存按钮：三项必填，只写 weekly 字段，不推进记录日 */}
          <button className="primary" onClick={saveWeekly}>
            保存周复盘
          </button>
          {weeklyErr && <div className="save-err">{weeklyErr}</div>}
          {weeklySaved && !weeklyErr && (
            <div className="ok">
              <svg className="ok__check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4 10-10" /></svg>
              周复盘已保存（不影响日复盘，记录日不推进）
            </div>
          )}

          {/* 上一周周复盘附在下方供参考（默认收起，点击展开） */}
          <div className="wr-ref">
            <button className="checkin-link wr-ref__toggle" onClick={() => setLastWeeklyOpen((o) => !o)}>
              参考上一周周复盘（{lastWeekRange}）{lastWeeklyOpen ? '收起' : '展开'}
            </button>
            {lastWeeklyOpen && (
              <div className="wr-ref__body">
                {lastWeekly ? (
                  <>
                    <div className="wr-field">
                      <div className="wr-label">a. 本周推进了什么内容？</div>
                      <div className="wr-value">{lastWeekly.advanced || '—'}</div>
                    </div>
                    <div className="wr-field">
                      <div className="wr-label">b. 没做好 / 分心的事</div>
                      <div className="wr-value">{lastWeekly.issue || '—'}</div>
                    </div>
                    <div className="wr-field">
                      <div className="wr-label">c. 下周重推进什么事？</div>
                      <div className="wr-value">{lastWeekly.next || '—'}</div>
                    </div>
                  </>
                ) : (
                  <div className="muted">上一周还没有填写周复盘</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 年度复盘弹窗：每年最后一天自动弹出 */}
      {showYearReview && (
        <Modal title={`年度复盘 · ${yearKey(date)}年`} onClose={closeYearReview}>
          <div className="review-fields">
            <label className="field">
              <span>年度成果</span>
              <textarea
                value={yr.summary}
                onChange={(e) => setYr((p) => ({ ...p, summary: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>年度不足</span>
              <textarea
                value={yr.lack}
                onChange={(e) => setYr((p) => ({ ...p, lack: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>明年重点</span>
              <textarea
                value={yr.nextFocus}
                onChange={(e) => setYr((p) => ({ ...p, nextFocus: e.target.value }))}
              />
            </label>
            <button className="primary" onClick={saveYearReview}>
              保存年度复盘
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
