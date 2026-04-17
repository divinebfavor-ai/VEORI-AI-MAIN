import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Radio,
  Activity,
  GitMerge,
  UserCheck,
  Settings,
  LogOut,
} from 'lucide-react'
import clsx from 'clsx'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import { auth } from '../../services/api'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Leads', icon: Users, to: '/leads' },
  { label: 'Campaigns', icon: Radio, to: '/campaigns' },
  { label: 'Live Monitor', icon: Activity, to: '/monitor', live: true },
  { label: 'Pipeline', icon: GitMerge, to: '/pipeline' },
  { label: 'Buyers', icon: UserCheck, to: '/buyers' },
  { label: 'Settings', icon: Settings, to: '/settings' },
]

export default function Sidebar() {
  const { calls: liveCalls } = useLiveCalls()
  const hasActiveCalls = liveCalls.length > 0
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate = useNavigate()

  const handleLogout = async () => {
    try { await auth.logout() } catch {}
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-lg leading-none">V</span>
          </div>
          <div>
            <div className="text-text-primary font-bold text-base leading-tight">VEORI AI</div>
            <div className="text-text-muted text-xs">Built to Achieve</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map(({ label, icon: Icon, to, live }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative',
                  isActive
                    ? 'bg-elevated text-primary border-l-[3px] border-primary pl-[9px]'
                    : 'text-text-secondary hover:bg-card hover:text-text-primary'
                )
              }
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {live && hasActiveCalls && (
                <span className="w-2 h-2 bg-danger rounded-full animate-pulse flex-shrink-0" />
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* User / Logout */}
      <div className="px-3 py-4 border-t border-border-subtle">
        {user && (
          <div className="px-3 py-2 mb-1">
            <div className="text-sm font-medium text-text-primary truncate">
              {user.full_name || user.email}
            </div>
            <div className="text-xs text-text-muted truncate">{user.email}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-card hover:text-danger transition-all duration-150 w-full"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </div>
  )
}
