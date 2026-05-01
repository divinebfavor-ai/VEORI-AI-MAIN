import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Radio, Columns, Briefcase, BarChart2,
  Settings, LogOut, Calculator, Shield, Phone, Building2,
  Sun, Moon, MessageSquare, BookOpen, Store, Bell,
} from 'lucide-react'
import VeoriLogo from '../VeoriLogo'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'
import { notifications as notifApi } from '../../services/api'

const NAV = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Command Center' },
  { to: '/dialer',      icon: Phone,           label: 'AI Dialer' },
  { to: '/leads',       icon: Users,           label: 'Leads' },
  { to: '/pipeline',    icon: Columns,         label: 'Pipeline' },
  { to: '/campaigns',   icon: Briefcase,       label: 'Campaigns' },
  { to: '/buyers',      icon: Building2,       label: 'Buyers' },
  { to: '/follow-ups',  icon: Bell,            label: 'Follow-Ups' },
  { to: '/monitor',     icon: Radio,           label: 'Live Monitoring', live: true },
  { to: '/analytics',   icon: BarChart2,       label: 'Analytics' },
  { to: '/calculator',  icon: Calculator,      label: 'Calculator' },
  { to: '/compliance',  icon: Shield,          label: 'Compliance' },
  { to: '/academy',     icon: BookOpen,        label: 'Academy' },
  { to: '/marketplace', icon: Store,           label: 'Marketplace' },
  { to: '/aria',        icon: MessageSquare,   label: 'Aria AI' },
]

function NavItem({ to, icon: Icon, label, liveBadge }) {
  return (
    <NavLink to={to} style={{ textDecoration: 'none', display: 'block' }}>
      {({ isActive }) => (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 12px', borderRadius: 10, margin: '1px 8px',
          background: isActive ? 'rgba(0,195,122,0.12)' : 'transparent',
          border: isActive ? '1px solid rgba(0,195,122,0.20)' : '1px solid transparent',
          transition: 'all 0.15s ease', cursor: 'pointer', position: 'relative',
        }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-bg-2)' }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
        >
          {/* Active bar */}
          {isActive && (
            <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 20, borderRadius: '0 2px 2px 0', background: '#00C37A' }} />
          )}
          <Icon
            size={16} strokeWidth={isActive ? 2 : 1.6}
            style={{
              color: isActive ? '#00C37A' : 'var(--t3)',
              filter: isActive ? 'drop-shadow(0 0 5px rgba(0,195,122,0.5))' : 'none',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          />
          <span style={{
            fontSize: 13, fontWeight: isActive ? 600 : 400,
            color: isActive ? '#00C37A' : 'var(--t2)',
            transition: 'color 0.15s', flex: 1,
          }}>
            {label}
          </span>
          {liveBadge > 0 && (
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: '#00C37A',
              animation: 'pulse-live 2s ease-in-out infinite',
              boxShadow: '0 0 6px rgba(0,195,122,0.8)', flexShrink: 0,
            }} />
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
  const [hovLogout, setHovLogout] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const load = () => notifApi.getUnreadCount().then(r => setUnreadCount(r.data?.count || 0)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'OP'
  const agentName = user?.agent_name || user?.ai_name || user?.assistant_name || 'Alex'
  const role = user?.role || user?.plan || 'Operator'

  return (
    <div style={{
      width: 220, flexShrink: 0, height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--sidebar-border)',
      backdropFilter: 'blur(48px) saturate(200%)',
      WebkitBackdropFilter: 'blur(48px) saturate(200%)',
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.04), 4px 0 24px rgba(0,0,0,0.2)',
      overflow: 'hidden',
    }}>

      {/* Logo */}
      <div style={{ padding: '20px 20px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <VeoriLogo size={28} />
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', margin: 0, letterSpacing: '-0.01em' }}>VEORI AI</p>
          <p style={{ fontSize: 9, fontWeight: 600, color: 'var(--t4)', margin: 0, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Real Estate OS</p>
        </div>
      </div>

      <div style={{ width: '80%', height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 auto 8px' }} />

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8, scrollbarWidth: 'none' }}>
        {NAV.map(({ to, icon, label, live }) => (
          <NavItem key={to} to={to} icon={icon} label={label} liveBadge={live ? liveCalls.length : 0} />
        ))}
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </nav>

      {/* Agent identity card */}
      <div style={{
        margin: '8px', padding: '12px 14px', borderRadius: 12,
        background: 'rgba(0,195,122,0.07)', border: '1px solid rgba(0,195,122,0.15)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(0,195,122,0.15)', border: '1px solid rgba(0,195,122,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#00C37A',
          }}>
            AI
          </div>
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>{agentName}</p>
            <p style={{ fontSize: 10, color: 'var(--t4)', margin: 0 }}>Your AI Acquisition Agent</p>
          </div>
          {liveCalls.length > 0 && (
            <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: '#00C37A', animation: 'pulse-live 2s ease-in-out infinite', boxShadow: '0 0 6px rgba(0,195,122,0.8)', flexShrink: 0 }} />
          )}
        </div>
        {liveCalls.length > 0 ? (
          <p style={{ fontSize: 11, color: '#00C37A', margin: 0, fontWeight: 500 }}>
            {liveCalls.length} active {liveCalls.length === 1 ? 'call' : 'calls'} in progress
          </p>
        ) : (
          <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>Idle — ready to dial</p>
        )}
      </div>

      <div style={{ width: '80%', height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 auto 8px' }} />

      {/* Bottom: theme + user */}
      <div style={{ padding: '0 8px 16px', flexShrink: 0 }}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'transparent', transition: 'background 0.15s', marginBottom: 2,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {theme === 'dark'
            ? <Sun size={16} strokeWidth={1.6} style={{ color: 'var(--t3)', flexShrink: 0 }} />
            : <Moon size={16} strokeWidth={1.6} style={{ color: 'var(--t3)', flexShrink: 0 }} />
          }
          <span style={{ fontSize: 13, color: 'var(--t3)' }}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>

        {/* User profile */}
        <button
          onClick={() => { logout(); navigate('/login') }}
          onMouseEnter={() => setHovLogout(true)}
          onMouseLeave={() => setHovLogout(false)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: hovLogout ? 'rgba(255,68,68,0.08)' : 'transparent',
            transition: 'background 0.15s',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: hovLogout ? 'rgba(255,68,68,0.15)' : 'rgba(0,195,122,0.12)',
            border: `1.5px solid ${hovLogout ? 'rgba(255,68,68,0.3)' : 'rgba(0,195,122,0.25)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
            color: hovLogout ? '#FF4444' : '#00C37A',
            transition: 'all 0.2s',
          }}>
            {hovLogout ? <LogOut size={12} /> : initials}
          </div>
          <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: hovLogout ? '#FF4444' : 'var(--t2)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.15s' }}>
              {hovLogout ? 'Sign out' : (user?.full_name || 'Operator')}
            </p>
            <p style={{ fontSize: 10, color: 'var(--t4)', margin: 0, textTransform: 'capitalize' }}>{role}</p>
          </div>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: '#00C37A',
            boxShadow: '0 0 5px rgba(0,195,122,0.6)', flexShrink: 0,
          }} />
        </button>
      </div>
    </div>
  )
}
