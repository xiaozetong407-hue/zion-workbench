// 微软 To Do（Microsoft Graph）集成。复用 onedrive.js 的登录态与 access token。
// 端点：/me/todo/lists（列表）、/me/todo/lists/{id}/tasks（任务）
import onedrive from './onedrive.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export const todo = {
  // 取默认任务列表（wellknownName=defaultList），没有则取第一个
  async getDefaultList() {
    const token = await onedrive.getValidToken()
    if (!token) return null
    const res = await fetch(`${GRAPH}/me/todo/lists`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('获取列表失败 ' + res.status)
    const d = await res.json()
    const lists = d.value || []
    const def = lists.find((l) => l.wellknownName === 'defaultList') || lists[0]
    return def || null
  },

  // 取「我的一天」智能列表（wellknownListName = myDay）
  async getMyDayList() {
    const token = await onedrive.getValidToken()
    if (!token) return null
    const res = await fetch(`${GRAPH}/me/todo/lists?$filter=wellknownListName eq 'myDay'`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('获取「我的一天」失败 ' + res.status)
    const d = await res.json()
    return (d.value && d.value[0]) || null
  },

  // 列「我的一天」任务（即用户的今日代办）
  async listMyDayTasks() {
    const list = await this.getMyDayList()
    if (!list) return []
    const token = await onedrive.getValidToken()
    const res = await fetch(
      `${GRAPH}/me/todo/lists/${list.id}/tasks?$top=100&$orderby=createdDateTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) throw new Error('获取「我的一天」任务失败 ' + res.status)
    const items = (await res.json()).value || []
    return items.map((t) => ({
      id: t.id,
      title: t.title || '(无标题)',
      done: t.status === 'completed',
      listId: list.id,
    }))
  },

  async listTasks(listId) {
    const token = await onedrive.getValidToken()
    if (!token) return []
    const res = await fetch(
      `${GRAPH}/me/todo/lists/${listId}/tasks?$top=100&$orderby=createdDateTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) throw new Error('获取任务失败 ' + res.status)
    return (await res.json()).value || []
  },

  async createTask(listId, title) {
    const token = await onedrive.getValidToken()
    if (!token) return null
    const res = await fetch(`${GRAPH}/me/todo/lists/${listId}/tasks`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error('创建失败 ' + res.status)
    return res.json()
  },

  async setComplete(listId, taskId, done) {
    const token = await onedrive.getValidToken()
    if (!token) return false
    const res = await fetch(`${GRAPH}/me/todo/lists/${listId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ status: done ? 'completed' : 'notStarted' }),
    })
    return res.ok
  },

  async deleteTask(listId, taskId) {
    const token = await onedrive.getValidToken()
    if (!token) return false
    const res = await fetch(`${GRAPH}/me/todo/lists/${listId}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  },
}

export default todo
