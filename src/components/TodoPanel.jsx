import React, { useState, useEffect, useCallback } from 'react'
import onedrive from '../store/onedrive.js'
import todo from '../store/todo.js'

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="round" />
    </svg>
  )
}

export default function TodoPanel() {
  const [configured, setConfigured] = useState(onedrive.isConfigured())
  const [signedIn, setSignedIn] = useState(onedrive.isSignedIn())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    if (!onedrive.isSignedIn()) {
      setSignedIn(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      const ts = await todo.listMyDayTasks()
      setItems(
        ts.map((t) => ({ id: t.id, title: t.title, done: t.done, listId: t.listId })),
      )
      setSignedIn(true)
    } catch (e) {
      setError(e.message || '加载失败')
      setSignedIn(false)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    const off = onedrive.onAuth(() => {
      setConfigured(onedrive.isConfigured())
      setSignedIn(true)
      load()
    })
    return off
  }, [load])

  function connect() {
    if (!onedrive.isConfigured()) {
      setError('请先在「我」页面填写 Microsoft Client ID')
      return
    }
    onedrive.signIn()
  }

  async function toggle(it) {
    setBusy(true)
    try {
      await todo.setComplete(it.listId, it.id, !it.done)
      await load()
    } catch (e) {
      setError(e.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    onedrive.signOut()
    setSignedIn(false)
    setItems([])
    setConfigured(onedrive.isConfigured())
  }

  const total = items.length
  const done = items.filter((t) => t.done).length

  return (
    <div className="card todo-card">
      <div className="card-title">
        Microsoft To Do · 我的一天
        {signedIn && (
          <span className="task-head-right">
            <span className="task-rate">{done}/{total}</span>
            <button className="checkin-link" onClick={load}>刷新</button>
            <button className="checkin-link" onClick={disconnect}>断开</button>
          </span>
        )}
      </div>
      <p className="muted">即你的「今日代办」——来自 Microsoft To Do 的「我的一天」，勾选会同步回 To Do。</p>

      {!configured && (
        <div className="muted">尚未配置 Microsoft Client ID，请到「我」页面填写后再连接。</div>
      )}

      {configured && !signedIn && (
        <button className="todo-connect" onClick={connect}>连接 Microsoft To Do</button>
      )}

      {error && <div className="todo-error">{error}</div>}

      {signedIn && (
        <div className="task-list">
          {total === 0 && !busy && (
            <div className="muted">「我的一天」还是空的——去 To Do 里把今天的事加进去吧。</div>
          )}
          {items.map((t) => (
            <div key={t.id} className={'task-item' + (t.done ? ' done' : '')}>
              <button className="task-check" onClick={() => toggle(t)} aria-label="切换完成">
                {t.done && <CheckIcon />}
              </button>
              <span className="task-title">{t.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
