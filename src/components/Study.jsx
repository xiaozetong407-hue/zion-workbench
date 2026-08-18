import React, { useState, useEffect } from 'react'
import { db } from '../store/db.js'

// 四轨定义 + 联网整理的真实资源（2026-07 整理）+ 各平台攻略
// 资源与攻略：常驻资源链接（整卡点击跳转，无刷新）+ 平台攻略（每条可单独刷新、整条可点击跳转）
const TRACKS = [
  {
    key: 'job', label: '求职（产品岗）', icon: 'briefcase',
    desc: '简历优化 / 投递追踪 / 面试准备',
    resources: [
      { name: '牛客网', url: 'https://www.nowcoder.com/', desc: '笔试/面试题库·校招内推（常驻）' },
    ],
    guides: [
      { platform: '小红书', q: '产品经理 简历 三段式 STAR', tip: '产品岗简历用「需求分析 → 方案设计 → 数据复盘」三段式，用 STAR 讲清一个项目' },
      { platform: '知乎', q: '产品经理 面经 高频业务题', tip: '面试前搜「XX 公司 产品经理 面经」，整理高频业务题与追问套路' },
      { platform: '抖音', q: '一分钟 产品分析 用户场景痛点方案', tip: '跟博主练 1 分钟产品分析：用户-场景-痛点-方案，开口就有结构' },
      { platform: '小红书', q: '产品经理 作品集 项目 原型', tip: '作品集放 2-3 个完整项目，附原型图 + 数据结果，比堆字数有用' },
      { platform: '知乎', q: '产品经理 项目经历 为什么做怎么做', tip: '项目经历用「为什么做 / 怎么做 / 结果如何」结构，HR 秒懂' },
      { platform: '通用', q: '产品经理 product sense 竞品分析', tip: '每周精读 1 份竞品分析报告，长期训练 product sense' },
    ],
  },
  {
    key: 'media', label: '自媒体（个人成长）', icon: 'video',
    desc: '选题库 / 脚本模板 / 录制排期',
    resources: [
      { name: '我的小红书主页', url: 'https://www.xiaohongshu.com', desc: '个人内容阵地（常驻）' },
    ],
    guides: [
      { platform: '小红书', q: '小红书 封面 标题 点击率 痛点', tip: '封面用「大字痛点 + 真人表情」，标题加数字和情绪词，点击率翻倍' },
      { platform: '抖音', q: '抖音 前3秒 钩子 完播率', tip: '前 3 秒抛钩子（反常识 / 利益点），完播率决定推流' },
      { platform: '知乎', q: '知乎 长文 个人成长 观点案例方法', tip: '长文用「观点-案例-方法」结构，适合做深度个人成长内容' },
      { platform: '小红书', q: '自媒体 栏目化更新 复盘', tip: '栏目化更新（周一清单 / 周三复盘），粉丝有预期更爱追' },
      { platform: '抖音', q: '口播 提词器 眼神 镜头 语速', tip: '口播用提词器但别念稿，眼神看镜头、语速稍快更有感染力' },
      { platform: '通用', q: '爆款 选题 结构 评论区 拆解', tip: '每周拆 3 条爆款，记选题 / 结构 / 评论区，沉淀进素材库' },
    ],
  },
  {
    key: 'english', label: '英语', icon: 'globe',
    desc: '词汇 / 听力 / 口语 / 阅读',
    resources: [
      { name: '扇贝背单词', url: 'https://www.shanbay.com/', desc: '打开即背·词汇量训练' },
      { name: 'B站·李老师', url: 'https://space.bilibili.com/131058159?spm_id_from=333.1007.tianma.3-4-10.click', desc: '语法长难句·真题精读' },
      { name: '野兽先生', url: 'https://space.bilibili.com/1027737427?spm_id_from=333.337.0.0', desc: '口语地道表达·跟读' },
    ],
    guides: [
      { platform: 'B站', q: '英语 语法 长难句 真题精读', tip: '李老师语法长难句配合真题精读，打基础最稳' },
      { platform: '通用', q: 'ESL Pod 英语听力 碎片时间', tip: '每天 15 分钟听力（ESL Pod），碎片时间磨耳朵' },
      { platform: '小红书', q: '英语口语打卡 搭子 互相监督', tip: '搜「英语口语打卡」找搭子，互相监督坚持率更高' },
      { platform: '知乎', q: '半年 英语 达到能交流 路线图', tip: '知乎「如何半年把英语提到能交流」高赞回答当路线图' },
      { platform: 'YouTube', q: 'English with Lucy BBC Learning English 发音', tip: '跟 English with Lucy / BBC Learning 练发音与地道表达' },
    ],
  },
  {
    key: 'korean', label: '韩语', icon: 'book',
    desc: '字母 / 语法 / 词汇 / 会话 / TOPIK',
    resources: [
      { name: 'Duolingo', url: 'https://www.duolingo.com/', desc: '游戏化入门·每日打卡' },
      { name: 'TTMIK Level 1-3', url: 'https://talktomeinkorean.com/', desc: '体系完整·初级到中级' },
      { name: 'YouTube · Go! Billy Korean', url: 'https://www.youtube.com/@GoBillyKorean', desc: '英文讲解·零基础友好' },
      { name: 'Korean Unnie', url: 'https://www.youtube.com/@KoreanUnnie', desc: '生活韩语·地道短句' },
      { name: 'Naver 词典', url: 'https://dict.naver.com/', desc: '韩国本地词典·例句发音' },
      { name: 'King Sejong Institute', url: 'https://www.sejonghakdang.org/', desc: '免费韩语讲义·会话' },
      { name: 'Anki · 韩语 500 词', url: 'https://apps.ankiweb.net/', desc: '间隔重复·核心词汇' },
    ],
    guides: [
      { platform: '小红书', q: '韩语自学 发音 21天打卡', tip: '搜「韩语自学」跟博主做 21 天发音打卡，先攻字母和发音' },
      { platform: 'B站', q: 'Go Billy Korean 韩语入门 playlist', tip: 'Go! Billy Korean 入门 playlist，英文讲解适合零基础' },
      { platform: '知乎', q: 'TOPIK 备考 规划 按等级', tip: '知乎「TOPIK 备考规划」按等级拆目标，避免盲目学' },
      { platform: '抖音', q: 'Korean Unnie 生活韩语 敬语', tip: 'Korean Unnie 生活韩语，学地道短句和敬语场景' },
      { platform: 'YouTube', q: 'Talk To Me In Korean 初级 中级', tip: 'Talk To Me In Korean 官方频道，体系化初级到中级' },
    ],
  },
]

// 收藏图标（描边 SVG）
function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l2.4 5.3L20 9.2l-4 4 1 5.8L12 16.7 7 19l1-5.8-4-4 5.6-.9L12 3z" />
    </svg>
  )
}
function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  )
}

// 平台攻略可点击跳转的「对应内容」：用关键词在该平台内搜索，而非平台首页
const PLATFORM_SEARCH = {
  '小红书': (q) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}`,
  '知乎': (q) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`,
  '抖音': (q) => `https://www.douyin.com/search/${encodeURIComponent(q)}`,
  'B站': (q) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`,
  'YouTube': (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  '通用': (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
}

// Fisher–Yates 洗牌（复制后打乱，互不影响原数组引用的对象身份）
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function Study({ date }) {
  const [plans, setPlans] = useState({})
  const [favorites, setFavorites] = useState([])
  const [activeTrack, setActiveTrack] = useState('job')
  const [resTitle, setResTitle] = useState('')
  const [resUrl, setResUrl] = useState('')
  const [favCat, setFavCat] = useState('求职（产品岗）')
  // 攻略展示（按轨道初始化，每条可单独刷新换一条）
  const [displayGuides, setDisplayGuides] = useState(() => shuffle(TRACKS[0].guides).slice(0, 3))

  const track = TRACKS.find((t) => t.key === activeTrack) || TRACKS[0]

  useEffect(() => {
    loadPlans()
    setFavorites(db.getFavorites())
    setDisplayGuides(shuffle(track.guides).slice(0, 3))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, activeTrack])

  function loadPlans() {
    const data = db.get()
    setPlans(data.studyPlans || {})
  }

  function savePlan(trackKey, field, val) {
    db.update((d) => {
      d.studyPlans = d.studyPlans || {}
      d.studyPlans[trackKey] = d.studyPlans[trackKey] || {}
      d.studyPlans[trackKey][field] = val
    })
    loadPlans()
  }

  function addMilestone(trackKey) {
    const ms = plans[trackKey]?.milestones || []
    ms.push({ text: '', done: false })
    savePlan(trackKey, 'milestones', ms)
  }
  function toggleMs(trackKey, idx) {
    const ms = [...(plans[trackKey]?.milestones || [])]
    ms[idx].done = !ms[idx].done
    savePlan(trackKey, 'milestones', ms)
  }
  function updateMsText(trackKey, idx, text) {
    const ms = [...(plans[trackKey]?.milestones || [])]
    ms[idx].text = text
    savePlan(trackKey, 'milestones', ms)
  }
  function removeMs(trackKey, idx) {
    const ms = [...(plans[trackKey]?.milestones || [])]
    ms.splice(idx, 1)
    savePlan(trackKey, 'milestones', ms)
  }

  function favoriteUrlSet() {
    return new Set(favorites.map((f) => f.url).filter(Boolean))
  }

  function addFav(title, url, category) {
    if (!title.trim()) return
    db.addFavorite({ title, url, category })
    setFavorites(db.getFavorites())
  }
  function removeFav(id) {
    db.deleteFavorite(id)
    setFavorites(db.getFavorites())
  }
  function addCustomRes(trackKey) {
    if (!resTitle.trim()) return
    addFav(resTitle, resUrl, TRACKS.find((t) => t.key === trackKey)?.label || '自定义')
    setResTitle('')
    setResUrl('')
  }

  // 单独刷新某一条攻略：从本轨攻略池里换一条不同的
  function refreshOne(idx) {
    setDisplayGuides((prev) => {
      const pool = track.guides.filter((g) => g !== prev[idx])
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : prev[idx]
      const next = [...prev]
      next[idx] = pick
      return next
    })
  }

  const tp = plans[activeTrack] || {}
  const milestones = tp.milestones || []
  const faved = favoriteUrlSet()

  // 收藏按分类分组
  const grouped = {}
  favorites.forEach((f) => {
    const c = f.category || '未分类'
    ;(grouped[c] = grouped[c] || []).push(f)
  })

  return (
    <div className="page study-page">
      {/* 轨道切换 */}
      <div className="study-tracks">
        {TRACKS.map((t) => (
          <button
            key={t.key}
            className={'study-track-tab' + (activeTrack === t.key ? ' active' : '')}
            onClick={() => setActiveTrack(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 当前轨道详情 */}
      <div className="card">
        <div className="card-title">
          {track.label}
          <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>{track.desc}</span>
        </div>

        {/* 目标 */}
        <label className="field">
          <span>目标</span>
          <input
            className="study-input"
            placeholder="这阶段想达成什么…"
            value={tp.goal || ''}
            onChange={(e) => savePlan(activeTrack, 'goal', e.target.value)}
          />
        </label>

        {/* 里程碑 */}
        <div className="study-section">
          <div className="study-section-head">
            <span className="study-section-title">里程碑</span>
            <button className="study-add-ms" onClick={() => addMilestone(activeTrack)}>+ 添加</button>
          </div>
          {milestones.length === 0 && <div className="muted" style={{ fontSize: 12 }}>点击上方添加里程碑节点</div>}
          <ul className="ms-list">
            {milestones.map((m, i) => (
              <li key={i} className="ms-item">
                <button
                  className={'ms-check' + (m.done ? ' done' : '')}
                  onClick={() => toggleMs(activeTrack, i)}
                  aria-label={m.done ? '标记未完成' : '标记完成'}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <input
                  className="ms-text study-input"
                  value={m.text}
                  onChange={(e) => updateMsText(activeTrack, i, e.target.value)}
                  placeholder="里程碑描述"
                />
                <button className="ledger-del" onClick={() => removeMs(activeTrack, i)}>×</button>
              </li>
            ))}
          </ul>
        </div>

        {/* 资源与攻略（常驻资源整卡跳转 · 平台攻略每条可单独刷新，四轨统一） */}
        <div className="study-section">
          <div className="study-section-head">
            <span className="study-section-title">资源与攻略</span>
          </div>

          {/* 常驻资源（原「资源与灵感」内容，整卡点击跳转，无刷新、无打开按钮） */}
          <div className="res-cards">
            {track.resources.map((r, ri) => (
              <div key={ri} className="res-card">
                <a className="res-card__body" href={r.url} target="_blank" rel="noopener noreferrer">
                  <div className="res-card__name">{r.name}</div>
                  <div className="res-card__desc">{r.desc}</div>
                </a>
                <button
                  className={'res-fav' + (faved.has(r.url) ? ' on' : '')}
                  onClick={() => !faved.has(r.url) && addFav(r.name, r.url, track.label)}
                  disabled={faved.has(r.url)}
                  title={faved.has(r.url) ? '已收藏' : '收藏'}
                >
                  <StarIcon filled={faved.has(r.url)} />
                </button>
              </div>
            ))}
          </div>

          {/* 平台攻略（整条可点击跳转 · 每条自带单独刷新按钮） */}
          <div className="guides">
            <div className="guides-list">
              {displayGuides.map((g, i) => {
                const url = g.q ? PLATFORM_SEARCH[g.platform]?.(g.q) : null
                const inner = (
                  <>
                    <span className="guide-platform">{g.platform}</span>
                    <span className="guide-tip">{g.tip}</span>
                  </>
                )
                return (
                  <div key={i} className="guide-item">
                    {url ? (
                      <a className="guide-link" href={url} target="_blank" rel="noopener noreferrer">{inner}</a>
                    ) : (
                      <div className="guide-link guide-link--static">{inner}</div>
                    )}
                    <button className="guide-refresh-one" onClick={() => refreshOne(i)} title="换一条攻略">
                      <RefreshIcon />
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>整条跳转对应平台搜索 · 点右侧图标换一条</div>
          </div>

          {/* 自定义收藏 */}
          <div className="res-add">
            <input className="study-input" placeholder="自定义资源标题" value={resTitle} onChange={(e) => setResTitle(e.target.value)} />
            <input className="study-input" placeholder="链接（可选）" value={resUrl} onChange={(e) => setResUrl(e.target.value)} />
            <button className="pill-btn" onClick={() => addCustomRes(activeTrack)}>收藏</button>
          </div>
        </div>

        {/* 备注 */}
        <label className="field">
          <span>备注</span>
          <textarea
            className="study-input study-note"
            placeholder="任意笔记…"
            value={tp.note || ''}
            onChange={(e) => savePlan(activeTrack, 'note', e.target.value)}
            rows={3}
          />
        </label>
      </div>

      {/* 我的收藏（可分类） */}
      <div className="card">
        <div className="card-title">
          我的收藏
          <span className="muted" style={{ fontWeight: 600, fontSize: 13 }}>共 {favorites.length} 条</span>
        </div>

        <div className="res-add" style={{ marginBottom: 10 }}>
          <input className="study-input" placeholder="新收藏标题" value={resTitle} onChange={(e) => setResTitle(e.target.value)} />
          <input className="study-input" placeholder="链接（可选）" value={resUrl} onChange={(e) => setResUrl(e.target.value)} />
          <select className="plan-select" value={favCat} onChange={(e) => setFavCat(e.target.value)}>
            {TRACKS.map((t) => <option key={t.key} value={t.label}>{t.label}</option>)}
          </select>
          <button className="pill-btn" onClick={() => { addFav(resTitle, resUrl, favCat) }}>添加</button>
        </div>

        {favorites.length === 0 && <div className="muted">还没有收藏，从上方资源点「收藏」或自行添加</div>}
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="fav-group">
            <div className="fav-group__title">{cat} · {list.length}</div>
            <ul className="fav-list">
              {list.map((f) => (
                <li key={f.id} className="fav-item">
                  <span className="fav-dot" />
                  <span className="fav-name">{f.title}</span>
                  {f.url && <a className="res-open" href={f.url} target="_blank" rel="noopener noreferrer"><ExtIcon /></a>}
                  <button className="ledger-del" onClick={() => removeFav(f.id)}>×</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

// 收藏列表里的「打开」图标（整卡跳转在资源/攻略区，这里复用 res-open）
function ExtIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}
