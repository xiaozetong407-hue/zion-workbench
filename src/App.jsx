import React, { useState, useEffect, useRef } from 'react'
import { db } from './store/db.js'
import sync from './store/sync.js'
import Home from './components/Home.jsx'
import Review from './components/Review.jsx'
import History from './components/History.jsx'
import Tasks from './components/Tasks.jsx'
import TaskHistory from './components/TaskHistory.jsx'
import Retrospect from './components/Retrospect.jsx'
import Status from './components/Status.jsx'
import Ledger from './components/Ledger.jsx'
import Reading from './components/Reading.jsx'
import Study from './components/Study.jsx'
import Past from './components/Past.jsx'
import Me from './components/Me.jsx'
import LedgerHistory from './components/LedgerHistory.jsx'
import Placeholder from './components/Placeholder.jsx'
import SyncBar from './components/SyncBar.jsx'

// 全部模块（常驻侧栏入口）："zion"置顶（品牌），其余已完成 + 已建设
const MODULES = [
  { key: 'me', label: 'zion', icon: 'me' },
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'tasks', label: '任务', icon: 'tasks' },
  { key: 'review', label: '复盘', icon: 'review' },
  { key: 'status', label: '状态', icon: 'status' },
  { key: 'ledger', label: '账本', icon: 'ledger' },
  { key: 'reading', label: '读书', icon: 'reading' },
  { key: 'study', label: '学习', icon: 'study' },
  { key: 'past', label: '过去', icon: 'past' },
]

const TITLES = {
  home: '',
  tasks: '任务',
  review: '复盘',
  status: '状态',
  ledger: '账本',
  reading: '读书',
  study: '学习',
  past: '过去',
  history: '历史打卡',
  taskHistory: '历史任务',
  retrospect: '历史回顾',
  ledgerHistory: '支出历史',
  me: '我',
}

// 二级页面（从一级页面进入，返回键需回到「进入它的一级页面」）
const SECONDARY = ['history', 'taskHistory', 'retrospect', 'ledgerHistory', 'me']
// 尚未实现的模块 -> 占位页（均无，保留机制）
const PLACEHOLDERS = []

// 统一描边 SVG 图标（遵循 P0：禁止 emoji 作功能图标），图标收窄以突出文字
function ModuleIcon({ name }) {
  const c = {
    viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  switch (name) {
    case 'me':
      return (<svg {...c}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 19c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5" /></svg>)
    case 'home':
      return (<svg {...c}><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></svg>)
    case 'tasks':
      return (<svg {...c}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8l2 2 4-4" /><path d="M9 14h6" /></svg>)
    case 'review':
      return (<svg {...c}><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" /><path d="M4 20v-4h4" /></svg>)
    case 'status':
      return (<svg {...c}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>)
    case 'ledger':
      return (<svg {...c}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="17" cy="14" r="1.4" /></svg>)
    case 'reading':
      return (<svg {...c}><path d="M12 6c-2-1.5-5-1.5-7 0v11c2-1.5 5-1.5 7 0 2-1.5 5-1.5 7 0V6c-2-1.5-5-1.5-7 0z" /><path d="M12 6v11" /></svg>)
    case 'study':
      return (<svg {...c}><path d="M3 9l9-4 9 4-9 4-9-4z" /><path d="M7 11v4c0 1.2 2.2 2 5 2s5-.8 5-2v-4" /></svg>)
    case 'past':
      return (<svg {...c}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></svg>)
    default:
      return null
  }
}

export default function App() {
  const [tab, setTab] = useState(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('zion-tab') || 'home') : 'home'))
  const tabRef = useRef(tab)
  tabRef.current = tab

  // 记录「是哪个一级页面把当前二级页面点进来的」，供返回键使用
  const originRef = useRef('home')

  const [date] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // 历史回顾定位：从任务栏「完整周复盘」进入时携带目标周（focusWeek），用于展开并滚动到对应条目
  const [retroFocus, setRetroFocus] = useState(null)

  // 手机物理返回键：在二级页按返回 -> 回「进入它的一级页面」（而非首页）
  useEffect(() => {
    window.history.replaceState({ page: 'home' }, '')
    const onPop = () => {
      if (SECONDARY.includes(tabRef.current)) {
        setTab(originRef.current || 'home')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 启动：先处理微软授权回跳（URL 带 code 时换 token），再启动本地同步
  useEffect(() => {
    sync.handleAuth().then(() => db.startSync())
  }, [])

  // 切换页面并持久化当前页，刷新后停留在原页面（不再强制回首页）
  function goTab(t) {
    try { localStorage.setItem('zion-tab', t) } catch (e) {}
    setTab(t)
  }

  // 进入二级页时压入历史，使返回键可逐层回退；一级模块直接切换
  // extra：可选参数（如 retrospect 的 focusWeek），用于二级页定位
  function navigate(t, extra) {
    if (SECONDARY.includes(t)) {
      // 记下「当前所在的一级页面」作为返回目标
      originRef.current = tab
      window.history.pushState({ page: t }, '')
    }
    if (t === 'retrospect') {
      setRetroFocus(extra && extra.focusWeek ? extra.focusWeek : null)
    }
    goTab(t)
  }

  function goBack() {
    goTab(originRef.current || 'home')
  }

  return (
    <div className="app">
      {/* 常驻侧栏：窄图标导航，单点直达切换；"zion"置顶 */}
      <nav className="sidebar">
        <ul className="sidebar__list">
          {MODULES.map((m, i) => (
            <React.Fragment key={m.key}>
              <li>
                <button
                  className={'sidebar__item' + (tab === m.key ? ' active' : '')}
                  onClick={() => navigate(m.key)}
                  aria-label={m.label}
                >
                  <span className="sidebar__icon"><ModuleIcon name={m.icon} /></span>
                  <span className="sidebar__label">{m.label}</span>
                </button>
              </li>
              {i === 0 && <li className="sidebar__sep" aria-hidden="true" />}
            </React.Fragment>
          ))}
        </ul>
      </nav>

      <div className="main-col">
        <SyncBar />
        <main className="screen">
          {tab === 'home' && <Home onNav={navigate} date={date} />}
          {tab === 'history' && <History onBack={goBack} />}
          {tab === 'tasks' && <Tasks date={date} onNav={navigate} />}
          {tab === 'taskHistory' && <TaskHistory onBack={goBack} />}
          {tab === 'review' && <Review date={date} onNav={navigate} />}
          {tab === 'retrospect' && <Retrospect onBack={goBack} focusWeek={retroFocus} />}
          {tab === 'status' && <Status date={date} />}
          {tab === 'ledger' && <Ledger date={date} onNav={navigate} />}
          {tab === 'ledgerHistory' && <LedgerHistory onBack={goBack} />}
          {tab === 'reading' && <Reading />}
          {tab === 'study' && <Study date={date} />}
          {tab === 'past' && <Past date={date} />}
          {tab === 'me' && <Me onBack={goBack} date={date} />}
          {PLACEHOLDERS.includes(tab) && <Placeholder label={TITLES[tab] || ''} />}
        </main>
      </div>
    </div>
  )
}
