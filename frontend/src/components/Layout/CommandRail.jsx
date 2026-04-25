import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Radio,
  Columns, Briefcase, BarChart2, Settings, LogOut,
  Calculator, Shield, Phone, Building2,
  Sun, Moon, MessageSquare, Headphones,
} from 'lucide-react'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'

const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Command Center' },
  { to: '/leads',       icon: Users,           label: 'Leads' },
  { to: '/monitor',     icon: Radio,           label: 'Live Calls',  live: true },
  { to: '/pipeline',    icon: Columns,         label: 'Pipeline' },
  { to: '/campaigns',   icon: Briefcase,       label: 'Campaigns' },
  { to: '/analytics',   icon: BarChart2,       label: 'Analytics' },
  { to: '/buyers',      icon: Building2,       label: 'Buyers' },
  { to: '/dialer',      icon: Phone,           label: 'Dialer' },
  { to: '/calculator',  icon: Calculator,      label: 'Calculator' },
  { to: '/compliance',  icon: Shield,          label: 'Compliance' },
  { to: '/aria',        icon: MessageSquare,   label: 'Aria AI' },
]

function NavItem({ to, icon: Icon, label, liveBadge }) {
  const [hov, setHov] = useState(false)
  return (
    <NavLink to={to}
      style={{ textDecoration: 'none', display: 'block' }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {({ isActive }) => (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          height: 44, padding: '0 16px',
          borderLeft: `2px solid ${isActive ? '#00C37A' : 'transparent'}`,
          background: isActive
            ? 'rgba(0,195,122,0.08)'
            : hov ? 'var(--surface-bg-3)' : 'transparent',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
          position: 'relative',
        }}>
          <Icon
            size={17} strokeWidth={1.6}
            style={{ color: isActive ? '#00C37A' : hov ? 'var(--t2)' : 'var(--t4)', flexShrink: 0 }}
          />
          <span style={{
            fontSize: 13, fontWeight: isActive ? 500 : 400,
            color: isActive ? 'var(--t1)' : hov ? 'var(--t2)' : 'var(--t3)',
            letterSpacing: '-0.01em',
            transition: 'color 0.15s ease',
          }}>
            {label}
          </span>
          {liveBadge > 0 && (
            <div style={{
              marginLeft: 'auto',
              minWidth: 20, height: 18,
              background: '#00C37A', color: '#000',
              fontSize: 10, fontWeight: 700,
              borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 5px',
              animation: 'pulse-live 2s ease-in-out infinite',
            }}>
              {liveBadge}
            </div>
          )}
        </div>
      )}
    </NavLink>
  )
}

export default function CommandRail() {
  const { calls: liveCalls } = useLiveCalls()
  const { theme, toggleTheme } = useThemeStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'OP'

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="glass-sidebar" style={{
      width: 240, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100%', position: 'relative', zIndex: 20,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(0,195,122,0.12)',
            border: '1px solid rgba(0,195,122,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(0,195,122,0.10)',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#00C37A', letterSpacing: '-0.02em' }}>V</span>
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.01em', lineHeight: 1.2, margin: 0 }}>Veori</p>
            <p style={{ fontSize: 9, color: 'var(--t4)', letterSpacing: '0.10em', textTransform: 'uppercase', margin: 0 }}>
              Autonomous Acquisitions
            </p>
          </div>
        </div>
        {/* System live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="live-dot" style={{ width: 5, height: 5 }} />
          <span style={{ fontSize: 10, color: 'var(--t4)', letterSpacing: '0.04em' }}>System Live</span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }} className="scrollbar-hide">
        {NAV.map(({ to, icon, label, live }) => (
          <NavItem
            key={to}
            to={to}
            icon={icon}
            label={label}
            liveBadge={live ? liveCalls.length : 0}
          />
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ borderTop: '1px solid var(--sidebar-border)', padding: '12px 0 8px' }}>
        {/* Settings */}
        <NavItem to="/settings" icon={Settings} label="Settings" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            height: 44, padding: '0 18px',
            background: 'none', border: 'none', cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-bg-3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          {theme === 'dark'
            ? <Sun  size={16} strokeWidth={1.6} style={{ color: 'var(--t4)', flexShrink: 0 }} />
            : <Moon size={16} strokeWidth={1.6} style={{ color: 'var(--t4)', flexShrink: 0 }} />
          }
          <span style={{ fontSize: 13, color: 'var(--t3)' }}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>

        {/* User + logout */}
        <div style={{
          margin: '8px 12px 4px',
          padding: '10px 10px',
          borderRadius: 10,
          background: 'var(--surface-bg)',
          border: '1px solid var(--sidebar-border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(0,195,122,0.12)',
            border: '1px solid rgba(0,195,122,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#00C37A',
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t2)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.full_name || 'Operator'}
            </p>
            <p style={{ fontSize: 10, color: 'var(--t4)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.company_name || 'veori.net'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--t4)', padding: 4,
              display: 'flex', alignItems: 'center',
              transition: 'color 0.15s ease', flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#FF4444'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--t4)'}
          >
            <LogOut size={14} strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </div>
  )
}
