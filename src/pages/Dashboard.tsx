import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import api, { getErrorMessage } from '../api/client'
import type { WorkspaceSummary } from '../api/types'

export default function Dashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function loadWorkspaces() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<{ workspaces: WorkspaceSummary[] }>('/workspaces')
      setWorkspaces(data.workspaces)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load workspaces'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWorkspaces()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const { data } = await api.post<{ workspace: WorkspaceSummary }>('/workspaces', {
        name: name.trim(),
      })
      setWorkspaces((prev) => [data.workspace, ...prev])
      setName('')
    } catch (err) {
      setCreateError(getErrorMessage(err, 'Failed to create workspace'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Your workspaces</h1>
        <p className="text-sm text-slate-500">Manage your teams and projects</p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label htmlFor="ws-name" className="mb-1 block text-sm font-medium text-slate-700">
            New workspace name
          </label>
          <input
            id="ws-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marketing Team"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
      {createError && <p className="text-sm text-red-600">{createError}</p>}

      {loading ? (
        <p className="text-slate-500">Loading workspaces…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-500">No workspaces yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              to={`/workspaces/${ws.id}`}
              className="group rounded-lg bg-white p-5 shadow transition-shadow hover:shadow-md"
            >
              <h2 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600">
                {ws.name}
              </h2>
              <p className="mt-1 text-xs text-slate-400">{ws.slug}</p>
              <div className="mt-4 flex gap-4 text-sm text-slate-500">
                <span>{ws._count?.members ?? 0} members</span>
                <span>{ws._count?.tasks ?? 0} tasks</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
