import React, { useState, useEffect } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'
import { monthKey, weekKey, yearKey, todayStr, mmdd } from '../utils/date.js'

const EXP_TAGS = [
  '餐饮', '交通', '购物', '居住', '娱乐',
  '医疗', '学习', '数码', '服饰', '美妆',
  '旅行', '社交', '日用', '其他',
]
const INC_TAGS = ['工资', '兼职', '红包', '理财', '投资收益', '退款', '其他']

const PIE_COLORS = ['#4f7cff','#27c08a','#ff9800','#7c5cff','#42a5f5','#9ccc65','#b0bec5','#ec407a','#8d6e63','#26c6da','#ab47bc','#ffd54f','#78909c','#90a4ae','#5c6bc0']

const PERIODS = [
  { key: 'week', label: '本周', fn: weekKey },
  { key: 'month', label: '本月', fn: monthKey },
  { key: 'year', label: '本年', fn: yearKey },
]

// 纯 SVG 扇形生成
function makePie(data /* [{label,value}] */, r, cx, cy) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  let cum = 0
  return data.map((p, i) => {
    const start = (cum / total) * Math.PI * 2 - Math.PI / 2
    cum += p.value
    const end = (cum / total) * Math.PI * 2 - Math.PI / 2
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    return {
      d: `M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      color: PIE_COLORS[i % PIE_COLORS.length],
      label: p.label,
      value: p.value,
      pct: ((p.value / total) * 100).toFixed(0),
    }
  })
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

// 支出历史图标（描边 SVG）
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

export default function Ledger({ onNav }) {
  const [items, setItems] = useState(db.getLedger())
  useLive(() => setItems(db.getLedger()))
  const [piePeriod, setPiePeriod] = useState('month')
  // 1.1.3：分布图类型（支出 / 收入），可切换
  const [pieType, setPieType] = useState('exp')
  // 记一笔：内联表单（常驻页面，无需点击展开）
  const [type, setType] = useState('exp')
  const [tag, setTag] = useState(EXP_TAGS[0])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  // 记一笔日期 + 本月概览：跟随真实时间，每分钟校准，自动跳转（不随记录日推进）
  const [today, setToday] = useState(() => todayStr())
  useEffect(() => {
    const id = setInterval(() => setToday(todayStr()), 60000)
    return () => clearInterval(id)
  }, [])
  const day = today
  // 需求 9：概览选项卡（默认本月；本年按自然年统计）
  const [overviewTab, setOverviewTab] = useState('month')
  // 1.1.8：每月消费 —— 选定年份的 12 个月消费变化 + 选中月明细
  const [trendYear, setTrendYear] = useState(() => Number(yearKey(todayStr())))
  const [trendMonth, setTrendMonth] = useState(() => Number(todayStr().slice(5, 7)))
  // 每笔记账编辑（日期 + 金额）
  const [editId, setEditId] = useState('')
  const [editDay, setEditDay] = useState('')
  const [editAmount, setEditAmount] = useState('')

  const tags = type === 'exp' ? EXP_TAGS : INC_TAGS

  // 记一笔日期：抓取当天（月-日，如 7-30），不做更改
  const [, lm, ld] = day.split('-')

  function startEdit(it) {
    setEditId(it.id)
    setEditDay(it.date)
    setEditAmount(String(it.amount))
  }
  function cancelEdit() {
    setEditId('')
    setEditDay('')
    setEditAmount('')
  }
  function confirmEdit() {
    const amt = Number(editAmount)
    if (!amt || amt <= 0) return
    const [y, m, d] = editDay.split('-')
    db.updateLedger(editId, { date: `${y}-${m}-${d}`, amount: amt })
    setItems(db.getLedger())
    cancelEdit()
  }

  function saveEntry() {
    const amt = Number(amount)
    if (!amt || amt <= 0) return
    db.addLedger({ type, tag, amount: amt, note: note.trim(), date: day })
    setItems(db.getLedger())
    setAmount('')
    setNote('')
  }

  // ---- 本月收支汇总（弱化红色，用沉稳色）----
  const month = monthKey(today)
  const monthItems = items.filter((it) => monthKey(it.date) === month)
  const expTotal = monthItems.filter((it) => it.type === 'exp').reduce((s, it) => s + it.amount, 0)
  const incTotal = monthItems.filter((it) => it.type === 'inc').reduce((s, it) => s + it.amount, 0)

  // ---- 需求 9：本年收支汇总（自然年）----
  const year = yearKey(today)
  const yearItems = items.filter((it) => yearKey(it.date) === year)
  const expTotalY = yearItems.filter((it) => it.type === 'exp').reduce((s, it) => s + it.amount, 0)
  const incTotalY = yearItems.filter((it) => it.type === 'inc').reduce((s, it) => s + it.amount, 0)

  // ---- 1.1.8：每月消费（12 个月柱状 + 选中月明细）----
  const thisYear = Number(year)
  const trendYearStr = String(trendYear)
  const trendRows = items.filter((it) => yearKey(it.date) === trendYearStr)
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mk = `${trendYearStr}-${String(i + 1).padStart(2, '0')}`
    const rows = trendRows.filter((it) => monthKey(it.date) === mk)
    const exp = rows.filter((it) => it.type === 'exp').reduce((s, it) => s + it.amount, 0)
    const inc = rows.filter((it) => it.type === 'inc').reduce((s, it) => s + it.amount, 0)
    return { m: i + 1, key: mk, exp, inc, count: rows.length }
  })
  const trendExp = monthly.reduce((s, x) => s + x.exp, 0)
  const trendInc = monthly.reduce((s, x) => s + x.inc, 0)
  const maxMonthExp = monthly.reduce((s, x) => Math.max(s, x.exp), 0)
  const selMonth = monthly[trendMonth - 1] || monthly[0]
  // 选中月按标签汇总（消费构成）
  const selByTag = {}
  trendRows
    .filter((it) => it.type === 'exp' && monthKey(it.date) === selMonth.key)
    .forEach((it) => { selByTag[it.tag] = (selByTag[it.tag] || 0) + it.amount })
  const selTagRows = Object.entries(selByTag)
    .map(([label, value]) => ({
      label,
      value,
      pct: selMonth.exp ? Math.round((value / selMonth.exp) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value)

  // ---- 周期饼图 ----
  const periodFn = PERIODS.find((p) => p.key === piePeriod)?.fn || monthKey
  const pKey = periodFn(today)
  // 1.1.3：按当前分布类型（支出 / 收入）统计
  const periodExp = items.filter((it) => it.type === pieType && periodFn(it.date) === pKey)
  const byTag = {}
  periodExp.forEach((it) => { byTag[it.tag] = (byTag[it.tag] || 0) + it.amount })
  const pieData = Object.entries(byTag).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  const seg = makePie(pieData, 52, 60, 60)

  // 最近记录：取最新的 10 条（超出 10 条的保留在「支出历史」中，不在此处显示）
  const recentAll = [...items].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0))
  const recent = recentAll.slice(0, 10)

  return (
    <div className="page">
      {/* 需求 9：概览（默认本月，可切本年） */}
      <div className="card ledger-overview">
        <div className="card-title">
          概览
          <div className="period-tabs">
            <button className={'chip' + (overviewTab === 'month' ? ' active' : '')} onClick={() => setOverviewTab('month')}>本月</button>
            <button className={'chip' + (overviewTab === 'year' ? ' active' : '')} onClick={() => setOverviewTab('year')}>本年</button>
          </div>
        </div>
        <div className="ledger-sum">
          <div className="sum-item">
            <span className="sum-label">支出</span>
            <b className="sum-exp">¥{(overviewTab === 'year' ? expTotalY : expTotal).toFixed(2)}</b>
          </div>
          <div className="sum-item">
            <span className="sum-label">收入</span>
            <b className="sum-inc">¥{(overviewTab === 'year' ? incTotalY : incTotal).toFixed(2)}</b>
          </div>
        </div>
      </div>

      {/* 记一笔：表单常驻（金额/备注/日期一行 + 保存图标在下方） */}
      <div className="card">
        <div className="card-title">记一笔</div>

        <div className="seg">
          <button className={'seg-btn' + (type === 'exp' ? ' active' : '')} onClick={() => { setType('exp'); setTag(EXP_TAGS[0]) }}>支出</button>
          <button className={'seg-btn' + (type === 'inc' ? ' active' : '')} onClick={() => { setType('inc'); setTag(INC_TAGS[0]) }}>收入</button>
        </div>

        <div className="field-label">标签</div>
        <div className="tag-row">
          {tags.map((t) => (
            <button key={t} className={'chip' + (tag === t ? ' active' : '')} onClick={() => setTag(t)}>{t}</button>
          ))}
        </div>

        {/* 金额 / 备注 / 日期 一行，节约页面 */}
        <div className="ledger-inline-row">
          <label className="field ledger-col-date">
            <span>日期</span>
            <div className="ledger-date-text" title="自动取当天日期">
              {Number(lm)}-{Number(ld)}
            </div>
          </label>
          <label className="field ledger-col-amt">
            <span>金额</span>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field ledger-col-note">
            <span>备注</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <button className="pill-btn ledger-save" onClick={saveEntry} disabled={!amount || Number(amount) <= 0}>
          <PlusIcon /> 记一笔
        </button>
      </div>

      {/* 分布（支出 / 收入可切换，在记一笔下方） */}
      <div className="card">
        <div className="card-title">
          {pieType === 'inc' ? '收入分布' : '支出分布'}
          <div className="period-tabs">
            {PERIODS.map((p) => (
              <button key={p.key} className={'chip' + (piePeriod === p.key ? ' active' : '')} onClick={() => setPiePeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 1.1.3：支出 / 收入 分布切换 */}
        <div className="seg ledger-pie-type">
          <button className={'seg-btn' + (pieType === 'exp' ? ' active' : '')} onClick={() => setPieType('exp')}>支出</button>
          <button className={'seg-btn' + (pieType === 'inc' ? ' active' : '')} onClick={() => setPieType('inc')}>收入</button>
        </div>

        {seg.length > 0 ? (
          <>
            <div className="pie-wrap">
              <svg viewBox="0 0 120 120" width="138" height="138" aria-hidden="true">
                {seg.length === 1
                  ? <circle cx="60" cy="60" r="52" fill={seg[0].color} />
                  : seg.map((s, i) => <path key={i} d={s.d} fill={s.color} />)}
              </svg>
              <div className="pie-legend">
                {seg.map((s, i) => (
                  <div key={i} className="pie-legend__item">
                    <span className="dot" style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <span className="pie-pct">{s.pct}%</span>
                    <span>¥{s.value.toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* 右下角：进入对应（支出 / 收入）历史统计二级页面 */}
            <div className="pie-action">
              <button className="guides-refresh" onClick={() => onNav('ledgerHistory', { ledgerScope: pieType })}>
                <ListIcon /> {pieType === 'inc' ? '收入历史' : '支出历史'}
              </button>
            </div>
          </>
        ) : (
          <p className="muted" style={{ padding: '6px 0' }}>还没有{pieType === 'inc' ? '收入' : '支出'}记录，上方记一笔开始</p>
        )}
      </div>

      {/* 1.1.8：每月消费 —— 12 个月消费变化一览，点柱子看当月消费构成 */}
      <div className="card">
        <div className="card-title">
          每月消费
          <div className="year-step">
            <button className="year-step__btn" onClick={() => setTrendYear((y) => y - 1)} aria-label="上一年">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14.5 5.5L8 12l6.5 6.5" />
              </svg>
            </button>
            <span className="year-step__val">{trendYear}</span>
            <button
              className="year-step__btn"
              onClick={() => setTrendYear((y) => y + 1)}
              disabled={trendYear >= thisYear}
              aria-label="下一年"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.5 5.5L16 12l-6.5 6.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* 12 个月柱状：柱高=当月支出，选中月高亮；点柱子切换下方明细 */}
        <div className="mbar">
          {monthly.map((x) => {
            const h = maxMonthExp > 0 ? Math.round((x.exp / maxMonthExp) * 100) : 0
            const active = x.m === trendMonth
            return (
              <button
                key={x.m}
                className={'mbar__col' + (active ? ' is-active' : '') + (x.exp > 0 ? '' : ' is-empty')}
                onClick={() => setTrendMonth(x.m)}
                aria-label={`${x.m}月 支出 ${x.exp.toFixed(0)} 元`}
                aria-pressed={active}
              >
                <span className="mbar__track">
                  <span className="mbar__fill" style={{ height: x.exp > 0 ? Math.max(h, 6) + '%' : '3px' }} />
                </span>
                <span className="mbar__label">{x.m}</span>
              </button>
            )
          })}
        </div>

        <div className="mbar__foot">
          <span>{trendYear} 年支出 ¥{trendExp.toFixed(2)}</span>
          <span className="dot-sep">·</span>
          <span>收入 ¥{trendInc.toFixed(2)}</span>
        </div>

        {/* 选中月消费构成 */}
        <div className="msum">
          <div className="msum__head">
            <span className="msum__month">{selMonth.m}月</span>
            <span className="msum__note">
              支出 ¥{selMonth.exp.toFixed(2)} · 收入 ¥{selMonth.inc.toFixed(2)} · {selMonth.count} 笔
            </span>
          </div>
          {selTagRows.length === 0 ? (
            <p className="muted" style={{ padding: '2px 0 6px' }}>{selMonth.m}月还没有支出记录</p>
          ) : (
            <ul className="msum__list">
              {selTagRows.map((t) => (
                <li key={t.label} className="msum__row">
                  <span className="msum__tag">{t.label}</span>
                  <span className="msum__bar"><i style={{ width: Math.max(t.pct, 2) + '%' }} /></span>
                  <span className="msum__pct">{t.pct}%</span>
                  <span className="msum__amt">¥{t.value.toFixed(0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 记录（每日数据，全部明细见支出历史二级页） */}
      <div className="card">
        <div className="card-title">
          最近记录
          <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>共 {items.length} 笔</span>
        </div>
        {recent.length === 0 && <div className="muted">还没有记录</div>}
        <ul className="ledger-list">
          {recent.map((it) => {
            if (editId === it.id) {
              const [ey, em, ed] = (editDay || it.date).split('-')
              const setEditDayPart = (part, val) => {
                const m = part === 'm' ? val : em
                const d = part === 'd' ? val : ed
                setEditDay(`${ey}-${m}-${d}`)
              }
              return (
                <li key={it.id} className="ledger-row ledger-row--edit">
                  <div className="ledger-edit-date">
                    <select value={em} onChange={(e) => setEditDayPart('m', e.target.value)}>
                      {Array.from({ length: 12 }, (_, i) => {
                        const n = i + 1
                        const v = String(n).padStart(2, '0')
                        return <option key={v} value={v}>{n}月</option>
                      })}
                    </select>
                    <select value={ed} onChange={(e) => setEditDayPart('d', e.target.value)}>
                      {Array.from({ length: 31 }, (_, i) => {
                        const n = i + 1
                        const v = String(n).padStart(2, '0')
                        return <option key={v} value={v}>{n}日</option>
                      })}
                    </select>
                  </div>
                  <input className="ledger-edit-amt" type="number" min="0" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                  <button className="ledger-edit-ok" onClick={confirmEdit}>确定</button>
                  <button className="ledger-edit-cancel" onClick={cancelEdit}>取消</button>
                </li>
              )
            }
            return (
              <li key={it.id} className="ledger-row">
                <span className={'ledger-tag tag--' + it.type}>{it.tag}</span>
                <span className="ledger-date">{mmdd(it.date)}</span>
                <span className="ledger-note">{it.note || '—'}</span>
                <span className={'ledger-amt amt--' + it.type}>{it.type === 'exp' ? '-' : '+'}{it.amount.toFixed(2)}</span>
                <button className="ledger-edit" onClick={() => startEdit(it)}>编辑</button>
                <button className="ledger-del" onClick={() => { db.deleteLedger(it.id); setItems(db.getLedger()) }}>×</button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
