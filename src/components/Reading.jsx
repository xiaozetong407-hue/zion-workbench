import React, { useState, useEffect, useRef } from 'react'
import { db } from '../store/db.js'
import { useLive } from '../store/useLive.js'

// 封面色板（模拟书籍封面，每本书根据标题 hash 取色）
const COVER_PALETTE = [
  '#c9a66b', '#6b8fa3', '#a37ba3', '#7ba38f',
  '#a38f7b', '#7b9aa3', '#a37b7b', '#8fa37b',
]

const QUOTE_CATS = ['通用', '励志', '哲理', '成长', '爱情', '职场', '其他']

function coverColor(title) {
  let h = 0
  for (let i = 0; i < title.length; i++) h += title.charCodeAt(i)
  return COVER_PALETTE[h % COVER_PALETTE.length]
}

function fmtDur(s) {
  s = Math.round(s || 0)
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// 并发受限的批量执行（避免一次性 271 本书把接口打满）
async function mapLimit(items, fn, conc = 20) {
  const ret = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      ret.push(await fn(items[idx]))
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker))
  return ret
}

export default function Reading() {
  const [quotes, setQuotes] = useState(db.getQuotes())
  const [qText, setQText] = useState('')
  const [qTitle, setQTitle] = useState('')
  const [qAuthor, setQAuthor] = useState('')
  const [qCat, setQCat] = useState('通用')
  const [qSearch, setQSearch] = useState('')
  const [qBook, setQBook] = useState('')

  // 微信读书关联
  // 用 ref 始终保存最新 key：避免防抖 syncWeread 读到旧闭包里的空值（曾导致「请先粘贴」误报）
  const wereadKeyRef = useRef(typeof localStorage !== 'undefined' ? (localStorage.getItem('zion-weread-key') || '') : '')
  const [wereadKey, setWereadKey] = useState(() => wereadKeyRef.current)
  const [wereadConnected, setWereadConnected] = useState(false)
  const [wereadBooks, setWereadBooks] = useState([])
  const [wereadReviews, setWereadReviews] = useState(db.getWereadReviews() || [])
  useLive(() => {
    setQuotes(db.getQuotes())
    setWereadReviews(db.getWereadReviews() || [])
  })
  const [wereadStat, setWereadStat] = useState({ today: 0, week: 0, total: 0, days: 0 })
  const [wereadLoading, setWereadLoading] = useState(false)
  const [wereadErr, setWereadErr] = useState('')
  const [wereadHint, setWereadHint] = useState('')
  const wereadDebounce = useRef(null)
  // 防重复：一次只允许一个同步在跑（打开页面自动连接 + 输入防抖 + 手动重试互斥）
  const wereadSyncing = useRef(false)
  // 微信读书 key 校验前缀（大小写不敏感：支持 wrk- 与 WRK-）
  const WRK_PREFIX = 'wrk'
  const [tab, setTab] = useState('shelf') // 'shelf' | 'review'

  // 自动连接：key 存在即载入缓存并（过期/首次）后台同步，无需每次手动点
  useEffect(() => {
    setQuotes(db.getQuotes())
    setWereadReviews(db.getWereadReviews() || [])
    const key = typeof localStorage !== 'undefined' ? (localStorage.getItem('zion-weread-key') || '') : ''
    if (!key) return
    setWereadKey(key)
    wereadKeyRef.current = key
    const cachedBooks = db.getWereadBooks()
    const cachedReviews = db.getWereadReviews() || []
    const cachedStat = db.getWereadStat()
    setWereadBooks(cachedBooks)
    setWereadReviews(cachedReviews)
    setWereadStat(cachedStat)
    // 仅当已有缓存数据时才标记「已连接」；否则等同步成功后再标记（避免静默假连接）
    if (cachedBooks.length > 0) setWereadConnected(true)
    const stale = Date.now() - db.getWereadSyncAt() > 60 * 60 * 1000
    if (stale || cachedBooks.length === 0) syncWeread(wereadKeyRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function syncWeread(keyArg) {
    const key = (keyArg !== undefined ? keyArg : (wereadKeyRef.current || (typeof localStorage !== 'undefined' ? localStorage.getItem('zion-weread-key') : '') || '')).trim()
    if (!key) { setWereadErr('尚未配置微信读书 Key（wrk- 开头）'); return }
    // 一次只允许一个同步在跑；已在进行则忽略本次触发（防 useEffect/防抖/手动重试重复）
    if (wereadSyncing.current) return
    wereadSyncing.current = true
    setWereadLoading(true); setWereadErr('')
    // 总超时：整个同步最多 30 秒，超时 abort 全部请求，绝不无限“正在自动连接”
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30000)
    try {
      // 微信读书代理：默认走 Cloudflare Worker（zezionx 账号已部署 weread-proxy-worker.js）；
      // 用户可在「我 → 微信读书代理（高级）」覆盖为自有地址（留空即用默认）。
      const DEFAULT_WEREAD_PROXY = 'https://zion-weread.zezionx.workers.dev'
      const raw = (db.getSettings().wereadProxyBase || DEFAULT_WEREAD_PROXY).trim().replace(/\/+$/, '')
      const base = raw.replace(/\/api\/weread$/, '')
      const wereadUrl = base ? base + '/api/weread' : '/api/weread'
      const auth = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      // 保留 status 与原始文本，便于精确诊断每一层失败（1.0.0 链路诊断）
      const post = async (api_name, extra) => {
        let resp
        try {
          resp = await fetch(wereadUrl, {
            method: 'POST', headers: auth, signal: ctrl.signal,
            body: JSON.stringify(Object.assign({ api_name, skill_version: '1.0.5' }, extra)),
          })
        } catch (netErr) {
          if (ctrl.signal.aborted) {
            const e = new Error('同步超时（30 秒）：代理未在限定时间内响应，请检查网络后重试')
            e.layer = 'timeout'; throw e
          }
          const e = new Error(`网络层失败：${netErr.message}（目标 ${wereadUrl}；多为代理不可达/未配置/CORS 拦截）`)
          e.layer = 'network'; throw e
        }
        const text = await resp.text()
        let body
        try { body = text ? JSON.parse(text) : {} } catch { body = null }
        // 代理层/网关层非 2xx 或业务错误：携带完整现场抛出
        if (resp.status >= 400 || (body && body.errcode && body.errcode !== 0)) {
          const e = new Error(
            `同步失败：HTTP ${resp.status}｜errcode=${body && body.errcode !== undefined ? body.errcode : '—'}｜errmsg=${(body && body.errmsg) || '—'}${body && body.errlog ? '｜errlog=' + body.errlog : ''}（URL ${wereadUrl}）`
          )
          e.layer = resp.status === 401 ? 'auth' : (resp.status >= 500 ? 'proxy' : 'gateway')
          e.status = resp.status; e.body = text.slice(0, 300)
          throw e
        }
        return body || {}
      }

      const shelf = await post('/shelf/sync')
      // 格式校验：200 但结构不符合预期 → 明确报“数据格式异常”，而不是当空数据成功
      if (!shelf || typeof shelf !== 'object' || !Array.isArray(shelf.books)) {
        const e = new Error('微信读书返回数据格式异常（/shelf/sync 未返回 books 数组），请重试')
        e.layer = 'format'; throw e
      }
      const all = shelf.books || []
      const pinned = all.filter((b) => b.isTop === true)

      const orangeQuotes = []
      const reviews = []

      // 遍历全部书：橙色划线(colorStyle 5) + 真实点评(type 4)，含非置顶/定制书
      await mapLimit(all, async (b) => {
        // 橙色划线 → 金句
        try {
          const bmr = await post('/book/bookmarklist', { bookId: b.bookId })
          ;(bmr.updated || bmr.bookmarks || []).forEach((it) => {
            if (it.colorStyle === 5 && it.markText && it.markText.trim()) {
              orangeQuotes.push({
                wereadId: it.bookmarkId || (b.bookId + '_' + it.range),
                text: it.markText.trim(),
                bookTitle: b.title,
                bookAuthor: b.author,
              })
            }
          })
        } catch (e) { /* 划线取不到忽略 */ }

        // 点评（type 4 = 读完一本书写的评语；type 1 是章节想法，丢弃）
        try {
          const rvr = await post('/review/list/mine', { bookid: b.bookId, count: 30 })
          ;(rvr.reviews || []).forEach((x) => {
            const rv = x.review || x
            if (rv.type === 4 && (rv.content || '').trim()) {
              reviews.push({
                reviewId: rv.reviewId || (b.bookId + '_' + (rv.createTime || 0)),
                bookId: b.bookId,
                title: b.title,
                author: b.author,
                cover: b.cover,
                content: (rv.content || '').trim(),
                createTime: rv.createTime || 0,
                score: typeof rv.score === 'number' ? rv.score : 0,
              })
            }
          })
        } catch (e) { /* 点评取不到忽略 */ }
      }, 20)

      // 置顶书架阅读进度
      const list = await Promise.all(pinned.map(async (b) => {
        let progress = b.finishReading ? 100 : 0
        try {
          const pr = await post('/book/getprogress', { bookId: b.bookId })
          if (pr && pr.book && typeof pr.book.progress === 'number') progress = pr.book.progress
        } catch (e) { /* 进度取不到则用 finishReading 推断 */ }
        return { bookId: b.bookId, title: b.title, author: b.author, cover: b.cover, progress }
      }))

      // 阅读统计
      let stat = { today: 0, week: 0, total: 0, days: 0 }
      try {
        const st = await post('/readdata/detail', { mode: 'weekly' })
        const rt = st.readTimes || {}
        const now = new Date()
        const dayStart = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()) }
        const todayKey = Math.floor(dayStart(now).getTime() / 1000)
        let week = 0
        for (let i = 0; i < 7; i++) {
          const d = new Date(now); d.setDate(now.getDate() - i)
          const k = Math.floor(dayStart(d).getTime() / 1000)
          if (rt[k]) week += rt[k]
        }
        stat = { today: rt[todayKey] || 0, week, total: st.totalReadTime || 0, days: st.readDays || 0 }
      } catch (e) { /* 统计忽略 */ }

      // 橙色划线写入金句（去重替换）
      db.addWereadQuotes(orangeQuotes)
      // 点评持久化（仅 type 4）
      reviews.sort((a, b) => b.createTime - a.createTime)
      db.setWereadReviews(reviews)
      db.setWereadBooks(list)
      db.setWereadStat(stat)
      db.setWereadSyncAt(Date.now())

      setWereadBooks(list)
      setWereadReviews(reviews)
      setWereadStat(stat)
      setQuotes(db.getQuotes())
      setWereadConnected(true)
      setWereadHint('')
      localStorage.setItem('zion-weread-key', key)
    } catch (e) {
      // 1.0.0：不再静默——按失败层输出真实链路（timeout/auth/proxy/network/format/其他）
      const layer = e.layer || 'unknown'
      if (db.getWereadBooks().length === 0) {
        setWereadConnected(false)
      }
      const tip =
        layer === 'timeout'
          ? '（请检查手机网络与代理可达性后，点「重新同步」重试）'
          : layer === 'auth'
          ? '（WRK-Key 无效或已过期：请确认复制完整 wrk- 开头 Key）'
          : layer === 'proxy'
          ? '（代理服务器返回 5xx：请检查代理是否可用）'
          : layer === 'network'
          ? '（网络层：代理不可达/未配置/CORS 拦截）'
          : layer === 'format'
          ? '（响应结构异常，可点「重新同步」重试）'
          : '（同步链路异常）'
      setWereadErr(`${e.message}${tip}`)
    } finally {
      // 无论成功/失败/超时/解析异常/格式异常，同步状态必须复位，绝不无限“正在自动连接”
      clearTimeout(timer)
      wereadSyncing.current = false
      setWereadLoading(false)
    }
  }

  function disconnectWeread() {
    setWereadConnected(false); setWereadBooks([]); setWereadErr('')
    setWereadStat({ today: 0, week: 0, total: 0, days: 0 })
    db.setWereadReviews([])
    db.setWereadBooks([])
    db.setWereadStat({ today: 0, week: 0, total: 0, days: 0 })
    db.setWereadSyncAt(0)
    setWereadReviews([])
    try { localStorage.removeItem('zion-weread-key') } catch (e) {}
    wereadKeyRef.current = ''
    setWereadKey('')
  }

  function addQuote() {
    if (!qText.trim()) return
    db.addQuote(qText, qTitle, qAuthor, qCat)
    setQText(''); setQTitle(''); setQAuthor(''); setQCat('通用')
    setQuotes(db.getQuotes())
  }

  const orangeCount = quotes.filter((q) => q.source === 'weread').length
  const kw = qSearch.trim().toLowerCase()
  const matchQuote = (q) =>
    !kw ||
    (q.text || '').toLowerCase().includes(kw) ||
    (q.bookTitle || '').toLowerCase().includes(kw) ||
    (q.bookAuthor || '').toLowerCase().includes(kw)
  // 按书名分组，组按金句数量降序；手写无书名归「未归类」
  const groupsMap = new Map()
  quotes.forEach((q) => {
    const key = (q.bookTitle || '').trim() || '未归类'
    if (!groupsMap.has(key)) groupsMap.set(key, [])
    groupsMap.get(key).push(q)
  })
  const bookGroups = []
  for (const [key, list] of groupsMap) {
    bookGroups.push({ key, label: key === '未归类' ? '未归类' : key, count: list.length })
  }
  bookGroups.sort((a, b) => b.count - a.count)
  // 选中某书只展示该书金句；未选（全部）或该书分组已不存在则展示全部，再叠加搜索过滤
  const visibleQuotes = (qBook && groupsMap.has(qBook) ? groupsMap.get(qBook) : quotes).filter(matchQuote)

  return (
    <div className="page reading-page">
      {/* 微信读书连接卡（置顶） */}
      <div className="card weread-card">
        <div className="shelf-head">
          <h3 className="shelf-title">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -3, marginRight: 4 }}>
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
            微信读书
          </h3>
          {wereadConnected && <span className="weread-dot">已连接</span>}
        </div>

        {!wereadConnected ? (
          <div className="weread-connect">
            <input
              className="book-input"
              type="password"
              placeholder="粘贴微信读书 API Key（wrk- 开头）"
              value={wereadKey}
              onChange={(e) => {
                const v = e.target.value
                wereadKeyRef.current = v
                setWereadKey(v)
                // 立即持久化 Key（即使后续同步失败，Key 也不丢失，下次打开仍连着）
                try { localStorage.setItem('zion-weread-key', v) } catch (e2) {}
                // 输入即自动连接（防抖），无需手动点按钮；前缀大小写不敏感；
                // loading 统一由 syncWeread 管理（内部有防重复与 30s 超时）
                if (v && v.trim().toLowerCase().startsWith(WRK_PREFIX)) {
                  if (wereadDebounce.current) clearTimeout(wereadDebounce.current)
                  wereadDebounce.current = setTimeout(() => syncWeread(wereadKeyRef.current), 700)
                }
              }}
            />
            <div className="weread-status">
              {wereadLoading ? '正在自动连接…' : (wereadKey ? '未连接到微信读书' : '尚未配置微信读书 Key（wrk- 开头）')}
            </div>
          </div>
        ) : (
          <div>
            <div className="weread-stat">
              <div><span>今日阅读</span><b>{fmtDur(wereadStat.today)}</b></div>
              <div><span>本周</span><b>{fmtDur(wereadStat.week)}</b></div>
              <div><span>累计</span><b>{fmtDur(wereadStat.total)}</b></div>
            </div>
            <div className="weread-actions">
              <button className="pill-btn" onClick={syncWeread} disabled={wereadLoading}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -2, marginRight: 3 }}>
                  <path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" />
                </svg>
                {wereadLoading ? '同步中…' : '重新同步'}
              </button>
              <button className="pill-btn pill-btn--ghost" onClick={disconnectWeread}>断开</button>
            </div>
            {wereadLoading && <div className="weread-syncing">正在同步全部书架与点评…</div>}
          </div>
        )}
        {wereadErr && <div className="weread-err">{wereadErr}</div>}
        {wereadHint && <div className="muted weread-hint">{wereadHint}</div>}
      </div>

      {/* 连接后的选项卡：置顶书架 / 点评 */}
      {wereadConnected && (
        <div className="card">
          <div className="tabbar">
            <button className={'tabbar__btn' + (tab === 'shelf' ? ' is-active' : '')} onClick={() => setTab('shelf')}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -2, marginRight: 4 }}>
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
              置顶书架（{wereadBooks.length}）
            </button>
            <button className={'tabbar__btn' + (tab === 'review' ? ' is-active' : '')} onClick={() => setTab('review')}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -2, marginRight: 4 }}>
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
              </svg>
              点评（{wereadReviews.length}）
            </button>
          </div>

          {tab === 'shelf' ? (
            <div className="weread-grid">
              {wereadBooks.map((b) => (
                <div className="weread-book" key={b.bookId}>
                  {b.cover ? (
                    <img className="weread-cover" src={b.cover} alt={b.title} loading="lazy" />
                  ) : (
                    <div className="weread-cover weread-cover--ph" style={{ background: coverColor(b.title) }}>
                      <span>{b.title.slice(0, 2)}</span>
                    </div>
                  )}
                  <div className="weread-book-title">{b.title}</div>
                  <div className="weread-book-author">{b.author || '—'}</div>
                  <div className="weread-prog">
                    <div className="weread-prog-bar"><div className="weread-prog-fill" style={{ width: (b.progress || 0) + '%' }} /></div>
                    <span className="weread-prog-text">{b.progress || 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="review-list">
              {wereadReviews.length === 0 && <div className="muted">还没有写过点评</div>}
              {wereadReviews.map((r) => (
                <div className="review-card" key={r.reviewId}>
                  <div className="review-card__top">
                    {r.cover ? (
                      <img className="review-thumb" src={r.cover} alt={r.title} loading="lazy" />
                    ) : (
                      <div className="review-thumb review-thumb--ph" style={{ background: coverColor(r.title) }}>
                        <span>{r.title.slice(0, 1)}</span>
                      </div>
                    )}
                    <div className="review-card__meta">
                      <div className="review-book-title">{r.title}</div>
                      <div className="review-book-author">{r.author || '—'}</div>
                    </div>
                  </div>
                  {r.score > 0 && (
                    <div className="review-stars" aria-label={'评分 ' + r.score}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span key={i} className={'star' + (i < r.score ? ' is-on' : '')}>★</span>
                      ))}
                    </div>
                  )}
                  <p className="review-content">{r.content}</p>
                  <div className="review-date">{fmtDate(r.createTime)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 金句（含微信读书橙色划线同步进来的内容） */}
      <div className="card">
        <div className="card-title">
          金句
          {orangeCount > 0 && <span className="quote-src-badge">微信读书 · {orangeCount}</span>}
        </div>

        {/* 搜索 */}
        <div className="quote-search">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="quote-search__icon">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input className="book-input" placeholder="搜索金句 / 书名 / 作者" value={qSearch} onChange={(e) => setQSearch(e.target.value)} />
        </div>

        {/* 书名下拉筛选：选中只展示该书金句，书名按数量降序 */}
        {quotes.length > 0 && (
          <div className="quote-book-filter">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="quote-book-filter__icon">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
            <select className="plan-select plan-select--left quote-book-select" value={qBook} onChange={(e) => setQBook(e.target.value)}>
              <option value="">全部金句（{quotes.length}）</option>
              {bookGroups.map((g) => (
                <option key={g.key} value={g.key}>{g.label}（{g.count}）</option>
              ))}
            </select>
          </div>
        )}

        <div className="quote-add">
          <input className="book-input" placeholder="一句打动你的话" value={qText} onChange={(e) => setQText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addQuote()} />
          {/* 书名与作者同一行 */}
          <div className="quote-add-row">
            <input className="book-input" placeholder="书名（可选）" value={qTitle} onChange={(e) => setQTitle(e.target.value)} />
            <input className="book-input book-input--sm" placeholder="作者（可选）" value={qAuthor} onChange={(e) => setQAuthor(e.target.value)} />
          </div>
          <div className="quote-add-foot">
            <select className="plan-select plan-select--left" value={qCat} onChange={(e) => setQCat(e.target.value)}>
              {QUOTE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="pill-btn" onClick={addQuote}>保存</button>
          </div>
        </div>

        {quotes.length === 0 && <div className="muted">还没有金句</div>}
        {quotes.length > 0 && (
          <>
            {visibleQuotes.length === 0 ? (
              <div className="muted">{kw ? `没有匹配「${qSearch}」的金句` : (qBook ? '这本书还没有金句' : '还没有金句')}</div>
            ) : (
              <ul className="quote-list">
                {visibleQuotes.map((q) => {
                  const isWx = q.source === 'weread'
                  return (
                    <li key={q.id} className={'quote-item' + (isWx ? ' quote-item--wx' : '')}>
                      <span className="quote-text">"{q.text}"</span>
                      <div className="quote-foot">
                        {q.bookAuthor && <span className="quote-author">{q.bookAuthor}</span>}
                        {isWx
                          ? <span className="quote-cat quote-cat--wx">微信读书</span>
                          : (q.category && <span className="quote-cat">{q.category}</span>)}
                        <button className="ledger-del" onClick={() => { db.deleteQuote(q.id); setQuotes(db.getQuotes()) }}>×</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
