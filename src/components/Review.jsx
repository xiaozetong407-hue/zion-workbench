import React, { useState, useEffect, useRef } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { addDays, formatDateCN, mmdd, yearKey, isLastDayOfYear, getWeekCN } from '../utils/date.js'
import Modal from './Modal.jsx'

// 未保存草稿持久化：切出复盘栏再切回，已填未保存的数据仍在
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

export default function Review({ date, onNav }) {
  // 复盘以「记录日」为当日主键：手动保存后推进到次日（去除 6 点自动清空）
  const [day, setDay] = useState(() => db.getRecordDay('review'))
  const [r, setR] = useState(() => getReviewDraft(day) || db.getReview(day) || {})
  const clearedRef = useRef(false)
  useLive(() => { if (!clearedRef.current) setR(getReviewDraft(day) || db.getReview(day) || {}) })
  const [saved, setSaved] = useState(false)

  // 周日才显示「周复盘」：覆盖本周一 ~ 本周日（周日当天）
  const isSunday = getWeekCN(day) === '周日'
  const weekMonday = addDays(day, -6)
  const weekRange = `${mmdd(weekMonday)} ~ ${mmdd(day)}`

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

  // 周复盘字段（仅周日显示），存放在 r.weekly 下
  function updateWeekly(field, v) {
    setR((prev) => {
      const np = { ...prev, weekly: { ...(prev.weekly || {}), [field]: v } }
      setReviewDraft(day, np)
      return np
    })
  }

  // 1.1.3：周复盘独立保存——只写入 weekly 字段，不推进记录日、不触碰日复盘内容
  const [weeklySaved, setWeeklySaved] = useState(false)
  function saveWeekly() {
    const w = r.weekly || {}
    if (!w.advanced && !w.issue && !w.next) return
    db.setReview(day, { weekly: w })
    setWeeklySaved(true)
  }

  // 1.1.3：上一周周复盘（上个周日的 weekly 字段），写作时附在下方供参考
  const lastSundayKey = addDays(day, -7)
  const lastWeekly = (db.getReview(lastSundayKey) || {}).weekly || null
  const lastWeekRange = `${mmdd(addDays(lastSundayKey, -6))} ~ ${mmdd(lastSundayKey)}`
  const [lastWeeklyOpen, setLastWeeklyOpen] = useState(false)

  function save() {
    db.setReview(day, r)
    clearReviewDraft()
    setSaved(true)
    clearedRef.current = true
    setR({})
    const next = addDays(day, 1)
    setDay(next)
    db.setRecordDay('review', next)
  }

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
        {saved && (
          <div className="ok">
            <svg className="ok__check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4 10-10" /></svg>
            已保存，明天首页将显示「明天最重要的事」
          </div>
        )}
      </div>

      {/* 周复盘：仅当复盘日期为周日时显示（覆盖本周一~周日） */}
      {isSunday && (
        <div className="card weekly-review-card">
          <div className="review-head">
            <h2>周复盘 · {weekRange}</h2>
            <span className="muted" style={{ fontSize: 12 }}>本周一至周日</span>
          </div>

          <label className="field">
            <span>a. 本周推进了什么内容？</span>
            <textarea
              value={(r.weekly && r.weekly.advanced) || ''}
              onChange={(e) => updateWeekly('advanced', e.target.value)}
            />
          </label>

          <label className="field">
            <span>b. 有什么事没有做好 / 被什么事分心比较多？为什么，如何改进？</span>
            <textarea
              value={(r.weekly && r.weekly.issue) || ''}
              onChange={(e) => updateWeekly('issue', e.target.value)}
            />
          </label>

          <label className="field">
            <span>c. 下周重推进什么事？</span>
            <textarea
              value={(r.weekly && r.weekly.next) || ''}
              onChange={(e) => updateWeekly('next', e.target.value)}
            />
          </label>

          {/* 1.1.3：周复盘独立保存按钮，与日复盘「保存复盘」互不干扰 */}
          <button className="primary" onClick={saveWeekly}>
            保存周复盘
          </button>
          {weeklySaved && (
            <div className="ok">
              <svg className="ok__check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4 10-10" /></svg>
              周复盘已保存（不影响日复盘，记录日不推进）
            </div>
          )}

          {/* 1.1.3：上一周周复盘附在下方供参考（默认收起，点击展开） */}
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
