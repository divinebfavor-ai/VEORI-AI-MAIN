import React, { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Radio,
  Columns, Briefcase, BarChart2, Settings, LogOut,
  Calculator, Shield, Phone, Building2,
  Sun, Moon, MessageSquare, BookOpen, Store, Bell,
} from 'lucide-react'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'
import { notifications as notifApi } from '../../services/api'

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
  { to: '/academy',     icon: BookOpen,        label: 'Academy' },
  { to: '/marketplace', icon: Store,           label: 'Marketplace' },
  { to: '/aria',        icon: MessageSquare,   label: 'Aria AI' },
]

// ─── Notifications dropdown ───────────────────────────────────────────────────
function NotifDropdown({ open, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    notifApi.getAll({ limit: 10, offset: 0 })
      .then(r => setItems(r.data?.notifications || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  const markAll = async () => {
    await notifApi.markAllRead().catch(() => {})
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  if (!open) return null

  return (
    <div ref={ref} style={{
      position: 'absolute', left: '100%', top: 0, marginLeft: 8,
      width: 320, maxHeight: 420,
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.40)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      zIndex: 100,
    }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Notifications</span>
        <button onClick={markAll} style={{ fontSize: 11, color: '#00C37A', background: 'none', border: 'none', cursor: 'pointer' }}>
          Mark all read
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }} className="scrollbar-hide">
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--t4)' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--t4)' }}>No notifications yet.</div>
        ) : items.map(n => (
          <div key={n.notification_id} style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: n.is_read ? 'transparent' : 'rgba(0,195,122,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C37A', marginTop: 5, flexShrink: 0 }} />}
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t1)', marginBottom: 2 }}>{n.title}</p>
                <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.4 }}>{n.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const notifRef = useRef(null)

  useEffect(() => {
    const load = () => {
      notifApi.getUnreadCount().then(r => setUnreadCount(r.data?.count || 0)).catch(() => {})
    }
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

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
      <div style={{ borderTop: '1px solid var(--sidebar-border)', padding: '12px 0 8px', position: 'relative' }}>
        {/* Settings */}
        <NavItem to="/settings" icon={Settings} label="Settings" />

        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setNotifOpen(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              height: 44, padding: '0 18px',
              background: notifOpen ? 'var(--surface-bg-3)' : 'none',
              border: 'none', cursor: 'pointer',
              transition: 'background 0.15s ease',
              position: 'relative',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-bg-3)'}
            onMouseLeave={e => e.currentTarget.style.background = notifOpen ? 'var(--surface-bg-3)' : 'none'}
          >
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Bell size={16} strokeWidth={1.6} style={{ color: 'var(--t4)' }} />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -5,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: '#00C37A', color: '#000',
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px',
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <span style={{ fontSize: 13, color: 'var(--t3)' }}>Notifications</span>
          </button>
          <NotifDropdown open={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>

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
