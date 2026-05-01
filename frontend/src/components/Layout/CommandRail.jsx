import React, { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Radio,
  Columns, Briefcase, BarChart2, Settings, LogOut,
  Calculator, Shield, Phone, Building2,
  Sun, Moon, MessageSquare, BookOpen, Store, Bell,
} from 'lucide-react'
import VeoriLogo from '../VeoriLogo'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'
import { notifications as notifApi } from '../../services/api'

const NAV = [
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Command Center' },
  { to: '/leads',           icon: Users,           label: 'Leads' },
  { to: '/monitor',         icon: Radio,           label: 'Live Calls',  live: true },
  { to: '/pipeline',        icon: Columns,         label: 'Pipeline' },
  { to: '/campaigns',       icon: Briefcase,       label: 'Campaigns' },
  { to: '/buyers',          icon: Building2,       label: 'Buyers' },
  { to: '/follow-ups',      icon: Bell,            label: 'Follow-Ups' },
  { to: '/analytics',       icon: BarChart2,       label: 'Analytics' },
  { to: '/dialer',          icon: Phone,           label: 'Dialer' },
  { to: '/calculator',      icon: Calculator,      label: 'Calculator' },
  { to: '/compliance',      icon: Shield,          label: 'Compliance' },
  { to: '/academy',         icon: BookOpen,        label: 'Academy' },
  { to: '/marketplace',     icon: Store,           label: 'Marketplace' },
  { to: '/aria',            icon: MessageSquare,   label: 'Aria AI' },
]

function Tooltip({ label, visible }) {
  if (!visible) return null
  return (
    <div style={{
      position: 'absolute', left: 'calc(100% + 12px)', top: '50%',
      transform: 'translateY(-50%)',
      background: 'rgba(10,12,20,0.95)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 8, padding: '5px 10px',
      fontSize: 12, fontWeight: 500, color: '#fff',
      whiteSpace: 'nowrap', pointerEvents: 'none',
      zIndex: 999,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      animation: 'fade-in 0.15s ease',
    }}>
      {label}
      {/* Arrow */}
      <div style={{
        position: 'absolute', right: '100%', top: '50%',
        transform: 'translateY(-50%)',
        border: '5px solid transparent',
        borderRightColor: 'rgba(255,255,255,0.10)',
      }} />
    </div>
  )
}

function PillNavItem({ to, icon: Icon, label, liveBadge }) {
  const [hov, setHov] = useState(false)
  return (
    <NavLink to={to} style={{ textDecoration: 'none', display: 'block', position: 'relative' }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {({ isActive }) => (
        <>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', cursor: 'pointer',
            background: isActive
              ? 'rgba(0,195,122,0.15)'
              : hov ? 'rgba(255,255,255,0.08)' : 'transparent',
            transition: 'all 0.2s ease',
            transform: hov && !isActive ? 'scale(1.08)' : 'scale(1)',
          }}>
            {isActive && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 12,
                background: 'rgba(0,195,122,0.12)',
                boxShadow: '0 0 16px rgba(0,195,122,0.25)',
                border: '1px solid rgba(0,195,122,0.30)',
              }} />
            )}
            <Icon size={17} strokeWidth={isActive ? 2 : 1.6} style={{
              color: isActive ? '#00C37A' : hov ? 'rgba(255,255,255,0.80)' : 'rgba(255,255,255,0.35)',
              position: 'relative', zIndex: 1,
              filter: isActive ? 'drop-shadow(0 0 6px rgba(0,195,122,0.6))' : 'none',
              transition: 'all 0.2s ease',
            }} />
            {liveBadge > 0 && (
              <span style={{
                position: 'absolute', top: 7, right: 7, width: 7, height: 7,
                borderRadius: '50%', background: '#00C37A',
                animation: 'pulse-live 2s ease-in-out infinite',
                boxShadow: '0 0 6px rgba(0,195,122,0.8)',
              }} />
            )}
          </div>
          <Tooltip label={label} visible={hov} />
        </>
      )}
    </NavLink>
  )
}

export default function CommandRail() {
  const { calls: liveCalls } = useLiveCalls()
  const { theme, toggleTheme } = useThemeStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [hovTheme, setHovTheme] = useState(false)
  const [hovLogout, setHovLogout] = useState(false)

  useEffect(() => {
    const load = () => notifApi.getUnreadCount().then(r => setUnreadCount(r.data?.count || 0)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'OP'

  return (
    <div style={{
      width: 68, flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '12px 0',
      gap: 0,
      height: '100%',
      position: 'relative',
    }}>
      {/* Glass pill container */}
      <div className="glass-pill-rail">

        {/* Logo */}
        <div style={{ padding: '14px 0 10px', display: 'flex', justifyContent: 'center' }}>
          <VeoriLogo size={28} />
        </div>

        {/* Divider */}
        <div style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px auto 8px' }} />

        {/* Nav items */}
        <nav style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '0 8px', flex: 1 }}>
          {NAV.map(({ to, icon, label, live }) => (
            <PillNavItem
              key={to} to={to} icon={icon} label={label}
              liveBadge={live ? liveCalls.length : 0}
            />
          ))}
        </nav>

        {/* Divider */}
        <div style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px auto 6px' }} />

        {/* Bottom controls */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '0 8px 8px' }}>

          {/* Settings */}
          <PillNavItem to="/settings" icon={Settings} label="Settings" />

          {/* Notifications */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setNotifOpen(v => !v)}
              style={{
                width: 44, height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: notifOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = notifOpen ? 'rgba(255,255,255,0.08)' : 'transparent'}
            >
              <Bell size={16} strokeWidth={1.6} style={{ color: 'rgba(255,255,255,0.35)' }} />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: 8, right: 8, width: 7, height: 7,
                  borderRadius: '50%', background: '#00C37A',
                  boxShadow: '0 0 6px rgba(0,195,122,0.8)',
                }} />
              )}
            </button>
            {/* Notification panel */}
            {notifOpen && (
              <div style={{
                position: 'absolute', left: 'calc(100% + 12px)', bottom: 0,
                width: 300, maxHeight: 380,
                background: 'rgba(8,12,24,0.92)',
                backdropFilter: 'blur(32px)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 16, overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                zIndex: 999, animation: 'fade-in 0.15s ease',
              }}>
                <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Notifications</span>
                  <button style={{ fontSize: 11, color: '#00C37A', background: 'none', border: 'none', cursor: 'pointer' }}>Mark all read</button>
                </div>
                <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>
                  No new notifications
                </div>
              </div>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            onMouseEnter={() => setHovTheme(true)}
            onMouseLeave={() => setHovTheme(false)}
            style={{
              width: 44, height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: hovTheme ? 'rgba(255,255,255,0.08)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s ease', position: 'relative',
            }}
          >
            {theme === 'dark'
              ? <Sun  size={16} strokeWidth={1.6} style={{ color: 'rgba(255,255,255,0.35)' }} />
              : <Moon size={16} strokeWidth={1.6} style={{ color: 'rgba(255,255,255,0.35)' }} />
            }
            <Tooltip label={theme === 'dark' ? 'Light mode' : 'Dark mode'} visible={hovTheme} />
          </button>

          {/* Divider */}
          <div style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

          {/* User avatar */}
          <div style={{ position: 'relative' }}
            onMouseEnter={() => setHovLogout(true)}
            onMouseLeave={() => setHovLogout(false)}
          >
            <button
              onClick={() => { logout(); navigate('/login') }}
              style={{
                width: 36, height: 36, borderRadius: '50%', cursor: 'pointer',
                background: 'rgba(0,195,122,0.12)',
                border: '1.5px solid rgba(0,195,122,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#00C37A',
                transition: 'all 0.2s ease',
                boxShadow: hovLogout ? '0 0 16px rgba(255,68,68,0.3)' : '0 0 10px rgba(0,195,122,0.2)',
              }}
            >
              {hovLogout ? <LogOut size={13} style={{ color: '#FF4444' }} /> : initials}
            </button>
            <Tooltip label={hovLogout ? 'Sign out' : (user?.full_name || 'Operator')} visible={hovLogout} />
          </div>
        </div>
      </div>
    </div>
  )
}
