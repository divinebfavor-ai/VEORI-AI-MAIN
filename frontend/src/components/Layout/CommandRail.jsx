import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Radio,
  Columns, Briefcase, BarChart2, Settings, LogOut,
  Calculator, Shield, Phone, Building2,
  Sun, Moon, MessageSquare, BookOpen, Store, Bell,
  ChevronLeft, ChevronRight, Compass,
  Car, Mail, Home, Video, Camera, Map, Share2, Film, Gift, Zap,
} from 'lucide-react'
import VeoriLogo from '../VeoriLogo'
import { useLiveCalls } from '../../hooks/useLiveCalls'
import useAuthStore from '../../store/authStore'
import { useAuth } from '../../hooks/useAuth'
import useThemeStore from '../../store/themeStore'
import { notifications as notifApi } from '../../services/api'

const NAV = [
  { to: '/dashboard',        icon: LayoutDashboard, label: 'Command Center' },
  { to: '/leads',            icon: Users,           label: 'Leads' },
  { to: '/monitor',          icon: Radio,           label: 'Live Calls',     live: true },
  { to: '/pipeline',         icon: Columns,         label: 'Pipeline' },
  { to: '/campaigns',        icon: Briefcase,       label: 'Campaigns' },
  { to: '/sms-templates',    icon: MessageSquare,   label: 'SMS Templates' },
  { to: '/buyers',           icon: Building2,       label: 'Buyers' },
  { to: '/title-companies',  icon: Building2,       label: 'Title Companies' },
  { to: '/follow-ups',       icon: Bell,            label: 'Follow-Ups' },
  { to: '/analytics',        icon: BarChart2,       label: 'Analytics' },
  { to: '/dialer',           icon: Phone,           label: 'Dialer' },
  { to: '/calculator',       icon: Calculator,      label: 'Calculator' },
  { to: '/compliance',       icon: Shield,          label: 'Compliance' },
  { to: '/aria',             icon: MessageSquare,   label: 'Aria AI' },
  // ── Acquisition ───────────────────────────────────────────────────────────
  { to: '/virtual-dfd',      icon: Map,             label: 'AI Driving for Dollars' },
  { to: '/dfd',              icon: Car,             label: 'Driving for Dollars' },
  // ── DEACTIVATED (Coming Soon) ───────────────────────────────────────────────
  // Removed from active navigation per product decision. Routes + page components are
  // INTACT in App.jsx and all backend code/data is untouched - uncomment any line to
  // reactivate. "Lead Engine" here is the standalone lead-sourcing module (NOT the
  // active lead pipeline / CRM records).
  // { to: '/lead-engine',        icon: Zap,           label: 'Lead Engine' },
  // { to: '/academy',            icon: BookOpen,      label: 'Academy' },
  // { to: '/wealth',             icon: Compass,       label: 'Wealth Playbook' },
  // { to: '/marketplace',        icon: Store,         label: 'Marketplace' },
  // { to: '/direct-mail',        icon: Mail,          label: 'Direct Mail' },
  // { to: '/listings',           icon: Home,          label: 'Listings' },
  // { to: '/property-marketing', icon: Film,          label: 'Property Marketing' },
  // { to: '/content-studio',     icon: Video,         label: 'Content Studio' },
  // { to: '/social-dashboard',   icon: Share2,        label: 'Social Dashboard' },
  // { to: '/virtual-tours',      icon: Camera,        label: 'Virtual Tours' },
]

// ─── Notifications dropdown ───────────────────────────────────────────────────
function NotifDropdown({ open, onClose, onCountChange, anchorRef }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const navigate = useNavigate()

  // Position the portal panel relative to the bell button. Rendering into
  // document.body (not the sidebar, which has overflow:hidden) is what makes
  // the panel actually visible — otherwise left:100% gets clipped away.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const el = anchorRef?.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({
        left: Math.min(r.right + 8, window.innerWidth - 332),
        bottom: Math.max(8, window.innerHeight - r.bottom),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    notifApi.getAll({ limit: 10, offset: 0 })
      .then(r => setItems(r.data?.notifications || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const handler = (e) => {
      const inPanel = ref.current && ref.current.contains(e.target)
      const inAnchor = anchorRef?.current && anchorRef.current.contains(e.target)
      if (!inPanel && !inAnchor) onClose()
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose, anchorRef])

  const markAll = async () => {
    await notifApi.markAllRead().catch(() => {})
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    onCountChange?.()
  }

  // Remove a single notification (X button). Stop the click from also
  // triggering the row's navigate handler.
  const clearOne = (e, n) => {
    e.stopPropagation()
    setItems(prev => prev.filter(x => x.notification_id !== n.notification_id))
    notifApi.remove(n.notification_id).catch(() => {})
    onCountChange?.()
  }

  const clearAll = async () => {
    setItems([])
    await notifApi.clearAll().catch(() => {})
    onCountChange?.()
  }

  // Resolve where a notification should take the operator when clicked.
  // Explicit link / deal wins; otherwise fall back by type so a click is
  // NEVER a dead no-op (many notifications are created without a link).
  const TYPE_ROUTES = {
    hot_lead:         '/hot-leads',
    daily_briefing:   '/dashboard',
    market_hotspot:   '/heatmap',
    outreach_credits: '/marketplace',
    title_warning:    '/title-companies',
    appointment:      '/appointments',
    missed_call:      '/missed-calls',
    follow_up:        '/follow-ups',
    new_lead:         '/leads',
    contract:         '/pipeline',
    offer:            '/pipeline',
  }
  const destFor = (n) => {
    if (n.link) return n.link
    if (n.deal_id) return `/deals/${n.deal_id}`
    if (n.type && TYPE_ROUTES[n.type]) return TYPE_ROUTES[n.type]
    return '/dashboard'
  }

  const handleClick = async (n) => {
    if (!n.is_read) {
      setItems(prev => prev.map(x => x.notification_id === n.notification_id ? { ...x, is_read: true } : x))
      notifApi.markRead(n.notification_id).catch(() => {})
      onCountChange?.()
    }
    const dest = destFor(n)
    onClose()
    if (dest) navigate(dest)
  }

  if (!open || !pos) return null

  return createPortal(
    <div ref={ref} style={{
      position: 'fixed', left: pos.left, bottom: pos.bottom,
      width: 320, maxHeight: 420,
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.40)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      zIndex: 9999,
    }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Notifications</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={markAll} style={{ fontSize: 11, color: '#00C37A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Mark all read
          </button>
          {items.length > 0 && (
            <button onClick={clearAll} style={{ fontSize: 11, color: 'var(--t4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Clear all
            </button>
          )}
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }} className="scrollbar-hide">
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--t4)' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--t4)' }}>No notifications yet.</div>
        ) : items.map(n => (
          <div
            key={n.notification_id}
            onClick={() => handleClick(n)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(n) } }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(0,195,122,0.04)' }}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: n.is_read ? 'transparent' : 'rgba(0,195,122,0.04)',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C37A', marginTop: 5, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t1)', marginBottom: 2 }}>{n.title}</p>
                <p style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.4 }}>{n.message}</p>
              </div>
              <button
                onClick={(e) => clearOne(e, n)}
                title="Clear"
                aria-label="Clear notification"
                style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: 4,
                  border: 'none', background: 'none', cursor: 'pointer',
                  color: 'var(--t4)', fontSize: 15, lineHeight: '18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.10)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t4)'; e.currentTarget.style.background = 'none' }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}

function NavItem({ to, icon: Icon, label, liveBadge, collapsed }) {
  const [hov, setHov] = useState(false)
  return (
    <NavLink to={to}
      style={{ textDecoration: 'none', display: 'block' }}
      title={collapsed ? label : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {({ isActive }) => (
        <div style={{
          display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 12,
          height: 44, padding: collapsed ? '0' : '0 16px',
          justifyContent: collapsed ? 'center' : 'flex-start',
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
          {!collapsed && (
            <span style={{
              fontSize: 13, fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--t1)' : hov ? 'var(--t2)' : 'var(--t3)',
              letterSpacing: '-0.01em',
              transition: 'color 0.15s ease',
              whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
          )}
          {!collapsed && liveBadge > 0 && (
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
          {collapsed && liveBadge > 0 && (
            <span style={{ position: 'absolute', top: 8, right: 6, width: 6, height: 6, borderRadius: '50%', background: '#00C37A' }} />
          )}
        </div>
      )}
    </NavLink>
  )
}

export default function CommandRail() {
  const { calls: liveCalls } = useLiveCalls()
  const { theme, toggleTheme } = useThemeStore()
  const { user } = useAuthStore()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1')
  const notifRef = useRef(null)

  const toggleCollapse = () => {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem('sidebar_collapsed', next ? '1' : '0')
      return next
    })
  }

  const refreshUnread = React.useCallback(() => {
    notifApi.getUnreadCount().then(r => setUnreadCount(r.data?.count || 0)).catch(() => {})
  }, [])

  useEffect(() => {
    refreshUnread()
    const t = setInterval(refreshUnread, 30000)
    return () => clearInterval(t)
  }, [refreshUnread])

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'OP'

  const handleLogout = () => { logout() }

  return (
    <div className="glass-sidebar" style={{
      width: collapsed ? 60 : 240, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100%', position: 'relative', zIndex: 20,
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
    }}>
      {/* Logo + collapse toggle */}
      <div style={{ padding: collapsed ? '16px 0' : '20px 16px 16px', borderBottom: '1px solid var(--sidebar-border)', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 10 }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <VeoriLogo size={34} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', lineHeight: 1.2, margin: 0 }}>Veori</p>
              <p style={{ fontSize: 9, color: 'var(--t4)', letterSpacing: '0.10em', textTransform: 'uppercase', margin: 0 }}>
                AI Platform
              </p>
            </div>
          </div>
        )}
        {collapsed && <VeoriLogo size={30} />}
        <button
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            width: 24, height: 24, borderRadius: 6, border: '1px solid var(--sidebar-border)',
            background: 'var(--surface-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--t4)', flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-bg-3)'; e.currentTarget.style.color = 'var(--t2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-bg)'; e.currentTarget.style.color = 'var(--t4)' }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
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
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ borderTop: '1px solid var(--sidebar-border)', padding: '12px 0 8px', position: 'relative' }}>
        {/* Referrals */}
        <NavItem to="/referrals" icon={Gift} label="Referrals" collapsed={collapsed} />
        {/* Settings */}
        <NavItem to="/settings" icon={Settings} label="Settings" collapsed={collapsed} />

        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setNotifOpen(v => !v)}
            title={collapsed ? 'Notifications' : undefined}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              gap: collapsed ? 0 : 12,
              height: 44,
              padding: collapsed ? '0' : '0 18px',
              justifyContent: collapsed ? 'center' : 'flex-start',
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
            {!collapsed && <span style={{ fontSize: 13, color: 'var(--t3)' }}>Notifications</span>}
          </button>
          <NotifDropdown open={notifOpen} onClose={() => setNotifOpen(false)} onCountChange={refreshUnread} anchorRef={notifRef} />
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={collapsed ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : undefined}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 12,
            height: 44,
            padding: collapsed ? '0' : '0 18px',
            justifyContent: collapsed ? 'center' : 'flex-start',
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
          {!collapsed && (
            <span style={{ fontSize: 13, color: 'var(--t3)' }}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          )}
        </button>

        {/* User + logout */}
        {collapsed ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
            <button
              onClick={handleLogout}
              title={`Sign out (${user?.full_name || 'Operator'})`}
              style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(0,195,122,0.12)',
                border: '1px solid rgba(0,195,122,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#00C37A',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.12)'; e.currentTarget.style.color = '#FF4444'; e.currentTarget.style.borderColor = 'rgba(255,68,68,0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,195,122,0.12)'; e.currentTarget.style.color = '#00C37A'; e.currentTarget.style.borderColor = 'rgba(0,195,122,0.25)' }}
            >
              {initials}
            </button>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  )
}
