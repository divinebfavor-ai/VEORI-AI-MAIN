import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, PlayCircle, Radio,
  Columns, Briefcase, BarChart2, Settings, LogOut,
  Calculator, Shield, Phone, Building2, Sun, Moon,
} from 'lucide-react'
import clsx from 'clsx'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'
import { auth } from '../../services/api'

const NAV = [
  { icon: LayoutDashboard, to: '/dashboard',       label: 'Command Center', kbd: '⌘1' },
  { icon: Users,           to: '/leads',            label: 'Leads',          kbd: '⌘2' },
  { icon: PlayCircle,      to: '/campaigns',        label: 'Campaigns',      kbd: '⌘3' },
  { icon: Radio,           to: '/monitor',          label: 'Live Calls',     kbd: '⌘4', live: true },
  { icon: Columns,         to: '/pipeline',         label: 'Pipeline',       kbd: '⌘5' },
  { icon: Briefcase,       to: '/buyers',           label: 'Buyers',         kbd: '⌘6' },
  { icon: Building2,       to: '/title-companies',  label: 'Title Co.',      kbd: '⌘7' },
  { icon: BarChart2,       to: '/analytics',        label: 'Analytics',      kbd: '⌘8' },
  { icon: Phone,           to: '/dialer',           label: 'Dialer',         kbd: '⌘9' },
  { icon: Calculator,      to: '/calculator',       label: 'MAO Calculator', kbd: null },
  { icon: Shield,          to: '/compliance',       label: 'Compliance',     kbd: null },
]

// Tooltip on hover
function RailTooltip({ label, kbd }) {
  return (
    <div className="rail-tooltip animate-fade-in">
      <span style={{ color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit' }}>{label}</span>
      {kbd && <span className="kbd">{kbd}</span>}
    </div>
  )
}

export default function CommandRail() {
  const { calls: liveCalls } = useLiveCalls()
  const hasLive = liveCalls.length > 0
  const user      = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { theme, toggleTheme } = useThemeStore()
  const navigate  = useNavigate()
  const [hovered, setHovered] = useState(null)

  const handleLogout = async () => {
    try { await auth.logout() } catch {}
    clearAuth()
    navigate('/login')
  }

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'OP'

  return (
    <div
      className="layout-rail flex flex-col h-full relative"
      style={{
        background: 'var(--s1)',
        borderRight: '1px solid var(--border-rest)',
      }}
    >
      {/* ── Wordmark / Logo ──────────────────────────────────────────── */}
      <div
        className="flex items-center justify-center"
        style={{ height: 'var(--status-h)', borderBottom: '1px solid var(--border-rest)', flexShrink: 0 }}
      >
        <span
          className="text-[15px] font-semibold tracking-tight select-none"
          style={{ color: 'var(--t1)', fontFamily: 'Inter, sans-serif' }}
        >
          V
        </span>
      </div>

      {/* ── Nav Items ────────────────────────────────────────────────── */}
      <nav className="flex-1 flex flex-col items-center py-2 gap-0.5 overflow-y-auto scrollbar-hide">
        {NAV.map(({ icon: Icon, to, label, kbd, live }) => (
          <div
            key={to}
            className="relative w-full flex justify-center"
            onMouseEnter={() => setHovered(to)}
            onMouseLeave={() => setHovered(null)}
          >
            <NavLink
              to={to}
              className={({ isActive }) => clsx(
                'relative w-10 h-10 rounded-card flex items-center justify-center transition-all duration-150 focus-ring',
                isActive
                  ? 'bg-[rgba(0,229,122,0.10)]'
                  : 'hover:bg-[rgba(255,255,255,0.04)]'
              )}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={18}
                    strokeWidth={1.6}
                    style={{
                      color: isActive ? 'var(--green)' : 'var(--t3)',
                      transition: 'color 0.15s ease',
                    }}
                  />
                  {/* Live call badge */}
                  {live && hasLive && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                      style={{ background: 'var(--green)', color: '#000' }}
                    >
                      {liveCalls.length}
                    </span>
                  )}
                </>
              )}
            </NavLink>
            {/* Tooltip */}
            {hovered === to && <RailTooltip label={label} kbd={kbd} />}
          </div>
        ))}
      </nav>

      {/* ── Bottom utilities ─────────────────────────────────────────── */}
      <div
        className="flex flex-col items-center pb-3 pt-2 gap-1"
        style={{ borderTop: '1px solid var(--border-rest)', flexShrink: 0 }}
      >
        {/* Theme toggle */}
        <div
          className="relative"
          onMouseEnter={() => setHovered('theme')}
          onMouseLeave={() => setHovered(null)}
        >
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-card flex items-center justify-center transition-all duration-150 hover:bg-[rgba(255,255,255,0.04)] focus-ring"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark'
              ? <Sun size={16} strokeWidth={1.6} style={{ color: 'var(--t3)' }} />
              : <Moon size={16} strokeWidth={1.6} style={{ color: 'var(--t3)' }} />
            }
          </button>
          {hovered === 'theme' && (
            <RailTooltip
              label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              kbd={null}
            />
          )}
        </div>

        {/* Settings */}
        <div
          className="relative"
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
        >
          <NavLink
            to="/settings"
            className={({ isActive }) => clsx(
              'w-10 h-10 rounded-card flex items-center justify-center transition-all duration-150 focus-ring',
              isActive ? 'bg-[rgba(0,229,122,0.10)]' : 'hover:bg-[rgba(255,255,255,0.04)]'
            )}
          >
            {({ isActive }) => (
              <Settings
                size={16}
                strokeWidth={1.6}
                style={{ color: isActive ? 'var(--green)' : 'var(--t3)' }}
              />
            )}
          </NavLink>
          {hovered === 'settings' && <RailTooltip label="Settings" kbd={null} />}
        </div>

        {/* Avatar / Logout */}
        <div
          className="relative"
          onMouseEnter={() => setHovered('logout')}
          onMouseLeave={() => setHovered(null)}
        >
          <button
            onClick={handleLogout}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 hover:ring-1 focus-ring"
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--border-rest)',
              ringColor: 'var(--border-active)',
            }}
          >
            <span
              className="text-[10px] font-semibold"
              style={{ color: 'var(--t2)', fontFamily: 'Inter, sans-serif' }}
            >
              {initials}
            </span>
          </button>
          {hovered === 'logout' && <RailTooltip label="Sign out" kbd={null} />}
        </div>
      </div>
    </div>
  )
}
