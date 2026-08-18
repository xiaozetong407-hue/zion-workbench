import React, { useState, useEffect, useRef } from 'react'
import { db } from '../store/db.js'
import { addDays, mmdd } from '../utils/date.js'
import StatusHistory from './StatusHistory.jsx'

const BMI_CATS = [
  { max: 18.5, label: '偏瘦', color: '#42a5f5' },
  { max: 24, label: '正常', color: '#27c08a' },
  { max: 28, label: '偏胖', color: '#ff9800' },
  { max: Infinity, label: '肥胖', color: '#e85d5d' },
]

function bmiCat(bmi) {
  return BMI_CATS.find((c) => bmi < c.max) || BMI_CATS[BMI_CATS.length - 1]
}

// Deurenberg 体脂率公式（基于 BMI + 年龄 + 性别）
function bodyFatPct(bmi, age, gender) {
  if (!bmi || !age) return 0
  const base = 1.2 * bmi + 0.23 * age
  return gender === 'female' ? base - 5.4 : base - 16.2
}

function bfCat(bf) {
  if (bf <= 0) return null
  if (bf < 10) return { label: '偏低', color: '#42a5f5' }
  if (bf < 20) return { label: '健康', color: '#27c08a' }
  if (bf < 25) return { label: '偏高', color: '#ff9800' }
  return { label: '过高', color: '#e85d5d' }
}

// 从已存状态还原表单（睡眠小时拆成 时/分 两个输入）
function loadForm(sdate) {
  const st = db.getStatus(sdate) || {}
  const sh = Number(st.sleepHours) || 0
  const h = Math.floor(sh)
  const m = Math.round((sh - h) * 60)
  return {
    sleepH: h ? String(h) : '',
    sleepM: m ? String(m) : '',
    steps: st.steps ?? '',
    calories: st.calories ?? '',
    exerciseMin: st.exerciseMin ?? '',
  }
}

// 未保存草稿持久化：切出状态栏再切回，已填未保存的数据仍在
const STATUS_DRAFT_KEY = 'zion-status-draft'
function getStatusDraft(day) {
  try {
    const raw = localStorage.getItem(STATUS_DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return d.day === day ? d.form : null
  } catch {
    return null
  }
}
function setStatusDraft(day, form) {
  try { localStorage.setItem(STATUS_DRAFT_KEY, JSON.stringify({ day, form })) } catch {}
}
function clearStatusDraft() {
  try { localStorage.removeItem(STATUS_DRAFT_KEY) } catch {}
}

export default function Status({ date }) {
  // 状态以「记录日」为当日主键：只在手动点击保存后推进到次日（去除 6 点自动清空）
  const [day, setDay] = useState(() => db.getRecordDay('status'))
  const [showHistory, setShowHistory] = useState(false)
  const [form, setForm] = useState(() => getStatusDraft(day) || loadForm(day))
  const [settings, setSettings] = useState(db.getSettings())
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(null)
  const [huaweiLinked, setHuaweiLinked] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('zion-huawei-linked') === '1' : false))
  const [huaweiBusy, setHuaweiBusy] = useState(false)
  const [huaweiMsg, setHuaweiMsg] = useState('')

  useEffect(() => {
    setForm(getStatusDraft(day) || loadForm(day))
    setSettings(db.getSettings())
  }, [day])

  // 兼容旧数据：若体重此前存在 status 里，迁移到 settings 以便 BMI 长期计算
  useEffect(() => {
    if (settings.weight == null) {
      const st = db.getStatus(day) || {}
      if (st.weight) setSettings((p) => ({ ...p, weight: st.weight }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  function setField(k, v) {
    setForm((p) => {
      const np = { ...p, [k]: v }
      setStatusDraft(day, np)
      return np
    })
  }

  // 保存：写入当前记录日状态，清空输入框，并将记录日推进到次日（去除 6 点自动清空）
  function saveStatus() {
    const f = form
    const sh = (Number(f.sleepH) || 0) + (Number(f.sleepM) || 0) / 60
    db.setStatus(day, {
      sleepHours: sh ? Math.round(sh * 10) / 10 : '',
      steps: f.steps || '',
      calories: f.calories || '',
      exerciseMin: f.exerciseMin || '',
      weight: settings.weight || '',
    })
    clearStatusDraft()
    setForm({ sleepH: '', sleepM: '', steps: '', calories: '', exerciseMin: '' })
    const next = addDays(day, 1)
    setDay(next)
    db.setRecordDay('status', next)
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1800)
  }

  function setSetting(k, v) {
    setSettings((p) => ({ ...p, [k]: v }))
    db.setSettings({ [k]: v })
  }

  async function syncHuawei() {
    setHuaweiBusy(true); setHuaweiMsg('')
    try {
      const r = await fetch('/api/huawei/data')
      const j = await r.json()
      if (j.needAuth) { setHuaweiMsg('尚未授权：请先在终端运行 npm run huawei:auth 完成一次性授权'); setHuaweiBusy(false); return }
      const dayMap = {}
      ;(j.group || []).forEach((g) => {
        const isStep = (g.dataTypeName || '').includes('step')
        const isCal = (g.dataTypeName || '').includes('calorie')
        const isSleep = (g.dataTypeName || '').includes('sleep')
        ;(g.sampleSet || []).forEach((ss) => {
          const key = ss.startTime ? new Date(Number(ss.startTime)).toISOString().slice(0, 10) : 'latest'
          const v = Number((ss.value && ss.value[0]) || 0)
          if (!dayMap[key]) dayMap[key] = { steps: 0, calories: 0, sleepMs: 0 }
          if (isStep) dayMap[key].steps += v
          if (isCal) dayMap[key].calories += v
          if (isSleep) {
            const dur = (Number(ss.endTime) - Number(ss.startTime)) || v
            dayMap[key].sleepMs += dur > 0 ? dur : 0
          }
        })
      })
      const keys = Object.keys(dayMap).sort()
      const pick = dayMap[date] || dayMap['latest'] || dayMap[keys[keys.length - 1]]
      if (pick && (pick.steps || pick.calories || pick.sleepMs)) {
        const out = {}
      if (pick.steps) out.steps = String(Math.round(pick.steps))
      if (pick.calories) out.calories = String(Math.round(pick.calories))
      if (pick.sleepMs) out.sleepH = String(Math.round((pick.sleepMs / 3600000) * 10) / 10)
      db.setStatus(day, {
        sleepHours: out.sleepH ? Number(out.sleepH) : '',
        steps: out.steps || '',
        calories: out.calories || '',
        exerciseMin: form.exerciseMin || '',
        weight: settings.weight || '',
      })
      setForm((p) => {
        const np = {
          ...p,
          ...(out.sleepH ? { sleepH: out.sleepH } : {}),
          ...(out.steps ? { steps: out.steps } : {}),
          ...(out.calories ? { calories: out.calories } : {}),
        }
        setStatusDraft(day, np)
        return np
      })
      setHuaweiLinked(true)
      try { localStorage.setItem('zion-huawei-linked', '1') } catch (e) {}
      const parts = []
      if (out.steps) parts.push('步数 ' + Math.round(pick.steps))
      if (out.calories) parts.push('卡路里 ' + Math.round(pick.calories))
      if (out.sleepH) parts.push('睡眠 ' + out.sleepH + 'h')
      setHuaweiMsg('已同步：' + parts.join(' / '))
      }
    } catch (e) {
      setHuaweiMsg('同步失败：' + (e.message || '网络错误'))
    } finally {
      setHuaweiBusy(false)
    }
  }

  const height = Number(settings.height) || 0
  const weight = Number(settings.weight) || 0
  const age = Number(settings.age) || 0
  const gender = settings.gender || 'male'
  const bmi = height > 0 && weight > 0 ? weight / Math.pow(height / 100, 2) : 0
  const bCat = bmi > 0 ? bmiCat(bmi) : null
  const bf = bodyFatPct(bmi, age, gender)
  const bfC = bfCat(bf)

  // 近 14 天趋势
  const all = db.getAllStatus()
  const days = Object.keys(all).sort().slice(-14)
  const maxEx = Math.max(1, ...days.map((d) => Number(all[d].exerciseMin) || 0))
  const maxSleep = Math.max(1, ...days.map((d) => Number(all[d].sleepHours) || 0))

  return (
    <div className="page">
      <div className="card">
        <div className="card-title">华为运动健康</div>
        {!huaweiLinked ? (
          <div className="huawei-connect">
            <span className="muted" style={{ fontSize: 12 }}>先运行 npm run huawei:auth 一次性授权，之后点此同步步数与卡路里</span>
            <button className="pill-btn" onClick={syncHuawei} disabled={huaweiBusy}>
              {huaweiBusy ? '同步中…' : '连接华为运动健康'}
            </button>
          </div>
        ) : (
          <div className="huawei-connect">
            <span className="weread-dot">已连接</span>
            <button className="pill-btn pill-btn--ghost" onClick={syncHuawei} disabled={huaweiBusy}>
              {huaweiBusy ? '同步中…' : '同步今日数据'}
            </button>
          </div>
        )}
        {huaweiMsg && <div className="weread-err" style={{ color: 'var(--muted)' }}>{huaweiMsg}</div>}
      </div>

      <div className="card">
        <div className="card-title status-card-title">
          <span>今日状态 · {mmdd(day)}</span>
          <button className="status-history-btn" onClick={() => setShowHistory(true)}>
            历史状态 →
          </button>
        </div>

        {/* 第一行：睡眠（时+分）与步数同一行 */}
        <div className="status-2row">
          <div className="st-cell">
            <span className="st-label">睡眠</span>
            <div className="st-sleep">
              <input type="number" min="0" className="st-num" value={form.sleepH} onChange={(e) => setField('sleepH', e.target.value)} placeholder="" />
              <span className="st-unit">时</span>
              <input type="number" min="0" max="59" className="st-num" value={form.sleepM} onChange={(e) => setField('sleepM', e.target.value)} placeholder="" />
              <span className="st-unit">分</span>
            </div>
          </div>
          <div className="st-cell">
            <span className="st-label">步数</span>
            <input type="number" min="0" value={form.steps} onChange={(e) => setField('steps', e.target.value)} placeholder="" />
          </div>
        </div>

        {/* 第二行：卡路里与活动小时数 */}
        <div className="status-2row">
          <div className="st-cell">
            <span className="st-label">卡路里（kcal）</span>
            <input type="number" min="0" value={form.calories} onChange={(e) => setField('calories', e.target.value)} placeholder="" />
          </div>
          <div className="st-cell">
            <span className="st-label">活动（小时）</span>
            <input type="number" min="0" step="0.1" value={form.exerciseMin} onChange={(e) => setField('exerciseMin', e.target.value)} placeholder="" />
          </div>
        </div>

        {/* 自动计算结果（BMI / 体脂率 一行，始终直接展示） */}
        <div className="body-metrics">
          <div className="metric-chip" style={bCat ? { borderColor: bCat.color } : {}}>
            <span className="metric-label">BMI</span>
            <span className="metric-val" style={bCat ? { color: bCat.color } : { color: 'var(--muted)' }}>
              {bCat ? bmi.toFixed(1) : '—'}
            </span>
            {bCat && <span className="metric-tag" style={{ background: bCat.color }}>{bCat.label}</span>}
          </div>
          <div className="metric-chip" style={bfC ? { borderColor: bfC.color } : {}}>
            <span className="metric-label">体脂率</span>
            <span className="metric-val" style={bfC ? { color: bfC.color } : { color: 'var(--muted)' }}>
              {bfC ? bf.toFixed(1) + '%' : '—'}
            </span>
            {bfC && <span className="metric-tag" style={{ background: bfC.color }}>{bfC.label}</span>}
          </div>
        </div>

        <button className="primary status-save" onClick={saveStatus}>保存状态</button>
        {saved && (
          <div className="ok">
            <svg className="ok__check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4 10-10" /></svg>
            已保存到今日状态
          </div>
        )}
      </div>

      <div className="card">
        {/* 基础数据：身高 / 体重 / 年龄 紧凑三列（无「身体数据」标题） */}
        <div className="status-grid3">
          <label className="field">
            <span>身高（cm）</span>
            <input type="number" min="0" value={settings.height ?? ''} onChange={(e) => setSetting('height', e.target.value)} placeholder="" />
          </label>
          <label className="field">
            <span>体重（kg）</span>
            <input type="number" min="0" step="0.1" value={settings.weight ?? ''} onChange={(e) => setSetting('weight', e.target.value)} placeholder="" />
          </label>
          <label className="field">
            <span>年龄</span>
            <input type="number" min="1" max="120" value={age || ''} onChange={(e) => setSetting('age', e.target.value)} placeholder="" />
          </label>
        </div>
        {!bCat && !bfC && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>填入身高、体重后自动计算 BMI 与体脂率</div>
        )}
      </div>

      <div className="card">
        <div className="card-title">近 14 天趋势</div>
        {days.length === 0 ? (
          <div className="muted">暂无数据，先填几天状态</div>
        ) : (
          <>
            <div className="trend">
              {days.map((d) => (
                <div key={d} className="trend-row">
                  <span className="trend-day">{d.slice(5)}</span>
                  <div className="trend-bars">
                    <div className="trend-bar trend-bar--ex" style={{ height: `${(Number(all[d].exerciseMin) || 0) / maxEx * 100}%` }} />
                    <div className="trend-bar trend-bar--sl" style={{ height: `${(Number(all[d].sleepHours) || 0) / maxSleep * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="trend-legend"><span className="dot dot--ex" />运动 <span className="dot dot--sl" />睡眠</div>
          </>
        )}
      </div>

      {showHistory && <StatusHistory onClose={() => setShowHistory(false)} />}
    </div>
  )
}
