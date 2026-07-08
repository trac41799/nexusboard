import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import api, { clearAuth, getErrorMessage } from '../api/client'

const linkBase =
  'px-3 py-2 rounded-md text-sm font-medium transition-colors'
const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? `${linkBase} bg-indigo-600 text-white`
    : `${linkBase} text-slate-300 hover:bg-slate-700 hover:text-white`

export default function Layout() {
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await api.post('/auth/logout')
    } catch (err) {
      console.warn(getErrorMessage(err, 'Logout request failed'))
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <nav className="bg-slate-900 shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-white">NexusBoard</span>
            <div className="flex items-center gap-1">
              <NavLink to="/dashboard" className={linkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/settings" className={linkClass}>
                Settings
              </NavLink>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            Logout
          </button>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
