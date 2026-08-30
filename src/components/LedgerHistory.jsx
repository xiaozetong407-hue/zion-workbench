import React, { useState, useEffect } from 'react'
import { db } from '../store/db.js'
import { monthKey } from '../utils/date.js'

const PIE_COLORS = ['#4f7cff','#27c08a','#ff9800','#7c5cff','#42a5f5','#9ccc65','#b0bec5','#ec407a','#8d6e63','#26c6da','#ab47bc','#ffd54f','#78909c','#90a4ae','#5c6bc0']

const EXP_TAGS = ['餐饮','交通','购物','居住','娱乐','医疗','学习','数码','服饰','美妆','旅行','社交','日用','其他']
const INC_TAGS = ['工资','兼职','红包','理财','投资收益','退款','其他']

function makePie(data, r, cx, cy) {
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

// 按标签汇总
function byTag(items) {
  const m = {}
  items.filter((it) => it.type === 'exp').forEach((it) => {
    m[it.tag] = (m[it.tag] || 0) + it.amount
  })
  return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

// 按月汇总（倒序）
function byMonth(items) {
  const m = {}
  items.forEach((it) => {
    const k = monthKey(it.date)
    if (!m[k]) m[k] = { exp: 0, inc: 0 }
    if (it.type === 'exp') m[k].exp += it.amount
    else m[k].inc += it.amount
  })
  return Object.keys(m).sort((a, b) => (a < b ? 1 : -1)).map((k) => ({ month: k, ...m[k] }))
}

// 折叠箭头（描边 SVG，遵循 P0：禁止 emoji 作功能图标）
function CaretIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24" width="14" height="14" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export default function LedgerHistory({ onBack, initialScope = 'exp' }) {
  const [items, setItems] = useState([])
  // 1.1.3：scope 支持 exp=支出历史 / inc=收入历史 / all=全部；由账本栏按钮决定初始值
  const [scope, setScope] = useState(initialScope === 'inc' || initialScope === 'all' ? initialScope : 'exp')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState({}) // 记录被「显式」折叠/展开的月份
  const [editId, setEditId] = useState('')
  const [editType, setEditType] = useState('exp')
  const [editTag, setEditTag] = useState(EXP_TAGS[0])
  const [editDay, setEditDay] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')

  useEffect(() => {
    setItems(db.getLedger())
  }, [])

  const expTotal = items.filter((it) => it.type === 'exp').reduce((s, it) => s + it.amount, 0)
  const incTotal = items.filter((it) => it.type === 'inc').reduce((s, it) => s + it.amount, 0)
  const balance = incTotal - expTotal

  // 1.1.3：按当前视图（支出 / 收入 / 全部）取数，供分布图与统计使用
  const scoped =
    scope === 'exp' ? items.filter((it) => it.type === 'exp')
      : scope === 'inc' ? items.filter((it) => it.type === 'inc')
        : items
  const tagData = byTag(scoped)
  const seg = makePie(tagData, 52, 60, 60)
  const monthData = byMonth(items)

  // ---- 搜索过滤 ----
  const q = search.trim().toLowerCase()
  const filtered = q
    ? items.filter((it) => {
        const hay = [it.tag, it.note || '', it.type === 'exp' ? '支出' : '收入', it.date, it.amount.toFixed(2)].join(' ').toLowerCase()
        return hay.includes(q)
      })
    : items
  const forceOpen = q !== '' // 搜索时强制展开所有月份

  // ---- 按月分组（倒序）----
  const map = {}
  filtered.forEach((it) => {
    const k = monthKey(it.date)
    ;(map[k] = map[k] || []).push(it)
  })
  const sortedMonths = Object.keys(map).sort((a, b) => (a < b ? 1 : -1))
  // 1.1.3：不再默认展开最新月份——「全部明细」默认全部收起（原：const latestMonth = sortedMonths[0]）
  const groups = sortedMonths.map((k) => {
    const list = map[k].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0))
    const exp = list.filter((x) => x.type === 'exp').reduce((s, x) => s + x.amount, 0)
    const inc = list.filter((x) => x.type === 'inc').reduce((s, x) => s + x.amount, 0)
    return { month: k, items: list, exp, inc, count: list.length }
  })

  // 某月份是否展开：1.1.3 起默认全部收起；搜索时全部展开；用户手动状态优先
  function isOpen(m) {
    if (forceOpen) return true
    if (collapsed[m] === false) return true
    if (collapsed[m] === true) return false
    return false
  }
  function toggleMonth(m) {
    const cur = isOpen(m)
    setCollapsed((prev) => ({ ...prev, [m]: cur }))
  }
  function toggleAll() {
    const allOpen = groups.every((g) => isOpen(g.month))
    const nc = {}
    groups.forEach((g) => { nc[g.month] = allOpen }) // 全开 -> 全部折叠；否则全部展开
    setCollapsed(nc)
  }

  // ---- 行内编辑（与最近记录共用同一 db，修改即时双向同步）----
  function startEdit(it) {
    setEditId(it.id)
    setEditType(it.type)
    setEditTag(it.tag)
    setEditDay(it.date)
    setEditAmount(String(it.amount))
    setEditNote(it.note || '')
  }
  function cancelEdit() {
    setEditId('')
    setEditType('exp')
    setEditTag(EXP_TAGS[0])
    setEditDay('')
    setEditAmount('')
    setEditNote('')
  }
  function confirmEdit() {
    const amt = Number(editAmount)
    if (!amt || amt <= 0) return
    const [y, m, d] = editDay.split('-')
    db.updateLedger(editId, { type: editType, tag: editTag, date: `${y}-${m}-${d}`, amount: amt, note: editNote.trim() })
    setItems(db.getLedger())
    cancelEdit()
  }
  function delItem(id) {
    db.deleteLedger(id)
    setItems(db.getLedger())
  }

  const tags = editType === 'exp' ? EXP_TAGS : INC_TAGS
  const allOpen = groups.every((g) => isOpen(g.month))

  return (
    <div className="page history-page">
      <div className="history-top">
        <button className="back-btn" onClick={onBack}>
          ← 返回
        </button>
        <span className="card-title">{scope === 'inc' ? '收入历史' : scope === 'all' ? '全部历史' : '支出历史'}</span>
      </div>

      {/* 累计结余主卡 */}
      <div className="lh-balance">
        <div className="lh-balance__label">累计结余</div>
        <div className={'lh-balance__value ' + (balance >= 0 ? 'pos' : 'neg')}>
          ¥{balance.toFixed(2)}
        </div>
        <div className="lh-balance__split">
          <span>支出 ¥{expTotal.toFixed(2)}</span>
          <span className="dot-sep">·</span>
          <span>收入 ¥{incTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* 统计网格 */}
      <div className="lh-stats">
        <div className="lh-stat">
          <b>{items.length}</b>
          <span>总笔数</span>
        </div>
        <div className="lh-stat">
          <b className="neg">¥{expTotal.toFixed(2)}</b>
          <span>总支出</span>
        </div>
        <div className="lh-stat">
          <b className="pos">¥{incTotal.toFixed(2)}</b>
          <span>总收入</span>
        </div>
      </div>

      {/* 按标签分布 */}
      <div className="card">
        <div className="card-title">
          {scope === 'inc' ? '收入分布' : scope === 'all' ? '收支分布' : '支出分布'}
          {/* 1.1.3：支出 / 收入 / 全部 三态切换 */}
          <div className="seg" style={{ transform: 'scale(0.86)', transformOrigin: 'right' }}>
            <button className={'seg-btn' + (scope === 'exp' ? ' active' : '')} onClick={() => setScope('exp')}>支出</button>
            <button className={'seg-btn' + (scope === 'inc' ? ' active' : '')} onClick={() => setScope('inc')}>收入</button>
            <button className={'seg-btn' + (scope === 'all' ? ' active' : '')} onClick={() => setScope('all')}>全部</button>
          </div>
        </div>
        {seg.length > 0 ? (
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
        ) : (
          <p className="muted" style={{ padding: '6px 0' }}>暂无{scope === 'inc' ? '收入' : '支出'}记录</p>
        )}
      </div>

      {/* 按月汇总 */}
      <div className="card">
        <div className="card-title">按月汇总</div>
        {monthData.length === 0 ? (
          <div className="muted">暂无数据</div>
        ) : (
          <ul className="ledger-list">
            {monthData.map((m) => (
              <li key={m.month} className="ledger-row">
                <span className="ledger-tag">{m.month}</span>
                <span className="ledger-note">支出 ¥{m.exp.toFixed(0)} · 收入 ¥{m.inc.toFixed(0)}</span>
                <span className={'ledger-amt ' + (m.inc - m.exp >= 0 ? 'amt--inc' : 'amt--exp')}>
                  {m.inc - m.exp >= 0 ? '+' : '-'}¥{Math.abs(m.inc - m.exp).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 全部明细：按月分组 + 收起 + 搜索，支持修改 / 删除 */}
      <div className="card">
        <div className="card-title">
          全部明细 · {filtered.length} 笔
          <button className="lh-toggle-all" onClick={toggleAll}>
            {allOpen ? '收起全部' : '展开全部'}
          </button>
        </div>
        <input
          className="lh-search"
          type="text"
          placeholder="搜索备注 / 标签 / 金额 / 日期"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {groups.length === 0 ? (
          <div className="muted">{q ? '没有匹配的记录' : '还没有记录'}</div>
        ) : (
          <div className="lh-groups">
            {groups.map((g) => {
              const open = isOpen(g.month)
              const [gy, gm] = g.month.split('-')
              return (
                <div className={'lh-month' + (open ? ' open' : '')} key={g.month}>
                  <button className="lh-month__head" onClick={() => toggleMonth(g.month)}>
                    <span className="lh-month__caret"><CaretIcon open={open} /></span>
                    <span className="lh-month__name">{Number(gm)}月 · {gy}</span>
                    <span className="lh-month__count">{g.count} 笔</span>
                    <span className={'lh-month__amt ' + (g.inc - g.exp >= 0 ? 'pos' : 'neg')}>
                      {g.inc - g.exp >= 0 ? '+' : '-'}¥{Math.abs(g.inc - g.exp).toFixed(0)}
                    </span>
                  </button>
                  {open && (
                    <ul className="ledger-list lh-month__body">
                      {g.items.map((it) => {
                        if (editId === it.id) {
                          const [ey, em, ed] = (editDay || it.date).split('-')
                          const setEditDayPart = (part, val) => {
                            const m = part === 'm' ? val : em
                            const d = part === 'd' ? val : ed
                            setEditDay(`${ey}-${m}-${d}`)
                          }
                          return (
                            <li key={it.id} className="ledger-row ledger-row--edit lh-edit">
                              <div className="lh-edit-row">
                                <select className="lh-edit-type" value={editType} onChange={(e) => { const t = e.target.value; setEditType(t); setEditTag(t === 'exp' ? EXP_TAGS[0] : INC_TAGS[0]) }}>
                                  <option value="exp">支出</option>
                                  <option value="inc">收入</option>
                                </select>
                                <select className="lh-edit-tag" value={editTag} onChange={(e) => setEditTag(e.target.value)}>
                                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div className="lh-edit-row">
                                <select className="lh-edit-sel" value={em} onChange={(e) => setEditDayPart('m', e.target.value)}>
                                  {Array.from({ length: 12 }, (_, i) => { const n = i + 1; const v = String(n).padStart(2, '0'); return <option key={v} value={v}>{n}月</option> })}
                                </select>
                                <select className="lh-edit-sel" value={ed} onChange={(e) => setEditDayPart('d', e.target.value)}>
                                  {Array.from({ length: 31 }, (_, i) => { const n = i + 1; const v = String(n).padStart(2, '0'); return <option key={v} value={v}>{n}日</option> })}
                                </select>
                                <input className="lh-edit-amt" type="number" min="0" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                              </div>
                              <input className="lh-edit-note" type="text" placeholder="备注" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                              <div className="lh-edit-actions">
                                <button className="ledger-edit-ok" onClick={confirmEdit}>确定</button>
                                <button className="ledger-edit-cancel" onClick={cancelEdit}>取消</button>
                              </div>
                            </li>
                          )
                        }
                        return (
                          <li key={it.id} className="ledger-row">
                            <span className={'ledger-tag tag--' + it.type}>{it.tag}</span>
                            <span className="ledger-date">{it.date.slice(5)}</span>
                            <span className="ledger-note">{it.note || '—'}</span>
                            <span className={'ledger-amt amt--' + it.type}>{it.type === 'exp' ? '-' : '+'}{it.amount.toFixed(2)}</span>
                            <button className="ledger-edit" onClick={() => startEdit(it)}>编辑</button>
                            <button className="ledger-del" onClick={() => delItem(it.id)}>×</button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
