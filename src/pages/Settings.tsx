import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api/client'
import type { User } from '../api/types'

export default function Settings() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadProfile() {
      setLoading(true)
      setError(null)
      try {
        const { data } = await api.get<{ user: User }>('/auth/me')
        setUser(data.user)
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load profile'))
      } finally {
        setLoading(false)
      }
    }
    void loadProfile()
  }, [])

  if (loading) return <p className="text-slate-500">Loading profile…</p>
  if (error) return <p className="text-red-600">{error}</p>
  if (!user) return <p className="text-slate-500">No profile found.</p>

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase()

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name ?? user.email}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-xl font-semibold text-white">
              {initials}
            </div>
          )}
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{user.name ?? 'Unnamed user'}</h2>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2">
          <ProfileField label="Name" value={user.name ?? '—'} />
          <ProfileField label="Email" value={user.email} />
          <ProfileField
            label="Sign-in method"
            value={user.oauthProvider ? `OAuth (${user.oauthProvider})` : 'Email & password'}
          />
          <ProfileField
            label="Member since"
            value={new Date(user.createdAt).toLocaleDateString()}
          />
        </dl>
      </div>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  )
}
