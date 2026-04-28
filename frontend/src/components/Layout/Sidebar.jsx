import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, PlayCircle, Radio,
  Columns, Briefcase, BarChart2, Settings, LogOut,
  Calculator, Shield, Phone, Building2, Bell, GraduationCap, Store,
} from 'lucide-react'
import clsx from 'clsx'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import { auth } from '../../services/api'

const NAV = [
  { label: 'Dashboard',      icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Leads',          icon: Users,            to: '/leads' },
  { label: 'Campaigns',      icon: PlayCircle,       to: '/campaigns' },
  { label: 'Live Calls',     icon: Radio,            to: '/monitor', live: true },
  { label: 'Pipeline',       icon: Columns,          to: '/pipeline' },
  { label: 'Buyers',         icon: Briefcase,        to: '/buyers' },
  { label: 'Title Companies',icon: Building2,        to: '/title-companies' },
  { label: 'Follow-Ups',     icon: Bell,             to: '/follow-ups' },
  { label: 'Analytics',      icon: BarChart2,        to: '/analytics' },
  { label: 'Dialer',         icon: Phone,            to: '/dialer' },
  { label: 'Calculator',     icon: Calculator,       to: '/calculator' },
  { label: 'Compliance',     icon: Shield,           to: '/compliance' },
  { label: 'Academy',        icon: GraduationCap,    to: '/academy' },
  { label: 'Marketplace',    icon: Store,            to: '/marketplace' },
  { label: 'Settings',       icon: Settings,         to: '/settings' },
]

export default function Sidebar() {
  const { calls: liveCalls } = useLiveCalls()
  const hasLive   = liveCalls.length > 0
  const user      = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()

  const handleLogout = async () => {
    try { await auth.logout() } catch {}
    clearAuth()
    navigate('/login')
  }

  const initials = user?.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'OP'

  return (
    <div className="flex flex-col h-full">
      {/* ── Wordmark ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-6 h-[60px] border-b border-border-subtle flex-shrink-0">
        <span className="text-[20px] font-medium text-white tracking-tight">Veori</span>
        <span className="dot-live" title="System live" />
      </div>

      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav className="flex-1 py-2 overflow-y-auto scrollbar-hide">
        {NAV.map(({ label, icon: Icon, to, live }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-4 h-[48px] text-[14px] transition-colors duration-100 relative',
              'border-l-2',
              isActive
                ? 'text-white bg-card border-primary'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface border-transparent'
            )}
          >
            <Icon size={15} className="flex-shrink-0" strokeWidth={1.5} />
            <span className="flex-1">{label}</span>
            {live && hasLive && (
              <span className="flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-medium px-1.5 py-0.5 rounded-[3px]">
                <span className="dot-live" style={{ width: 5, height: 5 }} />
                {liveCalls.length}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── User footer ────────────────────────────────────────────────── */}
      <div className="border-t border-border-subtle p-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-elevated border border-border-subtle flex items-center justify-center text-text-secondary text-[11px] font-semibold flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-text-primary truncate">
              {user?.full_name || 'Operator'}
            </p>
            <p className="text-[11px] text-text-muted truncate capitalize">
              {user?.plan || 'hustle'} plan
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-text-muted hover:text-text-secondary hover:bg-elevated rounded-[6px] transition-colors"
        >
          <LogOut size={13} strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </div>
  )
}
