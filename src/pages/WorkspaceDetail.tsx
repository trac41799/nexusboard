import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import api, { getErrorMessage } from '../api/client'
import {
  TASK_STATUSES,
  type Task,
  type TaskStatus,
  type WorkspaceDetail as WorkspaceDetailType,
} from '../api/types'
import { useSocket } from '../hooks/useSocket'

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Done',
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  TODO: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  REVIEW: 'bg-amber-100 text-amber-700',
  DONE: 'bg-green-100 text-green-700',
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'text-slate-500',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-orange-600',
  URGENT: 'text-red-600',
}

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>()
  const socket = useSocket(id)
  const [workspace, setWorkspace] = useState<WorkspaceDetailType | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<TaskStatus | 'ALL'>('ALL')

  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function loadData(workspaceId: string) {
    setLoading(true)
    setError(null)
    try {
      const [wsRes, tasksRes] = await Promise.all([
        api.get<{ workspace: WorkspaceDetailType }>(`/workspaces/${workspaceId}`),
        api.get<{ tasks: Task[] }>('/tasks', { params: { workspace: workspaceId } }),
      ])
      setWorkspace(wsRes.data.workspace)
      setTasks(tasksRes.data.tasks)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load workspace'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) void loadData(id)
  }, [id])

  useEffect(() => {
    if (!socket) return
    const onTaskCreated = (task: Task) => {
      setTasks((prev) => [task, ...prev])
    }
    const onTaskUpdated = (updated: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    }
    socket.on('task:created', onTaskCreated)
    socket.on('task:updated', onTaskUpdated)
    return () => {
      socket.off('task:created', onTaskCreated)
      socket.off('task:updated', onTaskUpdated)
    }
  }, [socket])

  const filteredTasks = useMemo(
    () => (filter === 'ALL' ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  )

  async function handleCreateTask(e: FormEvent) {
    e.preventDefault()
    if (!id || !title.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const { data } = await api.post<{ task: Task }>('/tasks', {
        title: title.trim(),
        workspaceId: id,
      })
      setTasks((prev) => [data.task, ...prev])
      setTitle('')
    } catch (err) {
      setCreateError(getErrorMessage(err, 'Failed to create task'))
    } finally {
      setCreating(false)
    }
  }

  async function updateStatus(taskId: string, status: TaskStatus) {
    try {
      const { data } = await api.patch<{ task: Task }>(`/tasks/${taskId}/status`, { status })
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...data.task } : t)))
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update task status'))
    }
  }

  if (loading) return <p className="text-slate-500">Loading workspace…</p>
  if (error) return <p className="text-red-600">{error}</p>
  if (!workspace) return <p className="text-slate-500">Workspace not found.</p>

  return (
    <div className="space-y-8">
      <div>
        <Link to="/dashboard" className="text-sm text-indigo-600 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{workspace.name}</h1>
        <p className="text-sm text-slate-500">
          {workspace.members.length} member{workspace.members.length === 1 ? '' : 's'}
        </p>
      </div>

      <form
        onSubmit={handleCreateTask}
        className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-slate-700">
            New task
          </label>
          <input
            id="task-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {creating ? 'Adding…' : 'Add task'}
        </button>
      </form>
      {createError && <p className="text-sm text-red-600">{createError}</p>}

      <div className="flex flex-wrap gap-2">
        <FilterButton active={filter === 'ALL'} onClick={() => setFilter('ALL')}>
          All ({tasks.length})
        </FilterButton>
        {TASK_STATUSES.map((status) => (
          <FilterButton
            key={status}
            active={filter === status}
            onClick={() => setFilter(status)}
          >
            {STATUS_LABELS[status]} ({tasks.filter((t) => t.status === status).length})
          </FilterButton>
        ))}
      </div>

      {filteredTasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-500">No tasks in this view.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filteredTasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">{task.title}</span>
                  <span className={`text-xs font-semibold ${PRIORITY_STYLES[task.priority] ?? ''}`}>
                    {task.priority}
                  </span>
                </div>
                {task.description && (
                  <p className="mt-1 truncate text-sm text-slate-500">{task.description}</p>
                )}
                <div className="mt-1 flex gap-3 text-xs text-slate-400">
                  {task.assignee?.name && <span>@{task.assignee.name}</span>}
                  <span>{task._count?.comments ?? 0} comments</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[task.status]}`}
                >
                  {STATUS_LABELS[task.status]}
                </span>
                <select
                  value={task.status}
                  onChange={(e) => updateStatus(task.id, e.target.value as TaskStatus)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-white text-slate-600 shadow hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}
