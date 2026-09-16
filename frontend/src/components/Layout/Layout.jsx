import React, { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import RouteFallback from '../RouteFallback'
import CommandRail from './CommandRail'
import SystemStatusBar from './SystemStatusBar'
import IntelPanel from './IntelPanel'
import AssistantChat from '../AI/AssistantChat'
import FeedbackButton from '../FeedbackButton'
import useThemeStore from '../../store/themeStore'
import useIsMobile from '../../hooks/useIsMobile'
import useBrandStore from '../../store/brandStore'

export default function Layout() {
  const { init } = useThemeStore()
  useEffect(() => { init() }, [])

  // White label: load the workspace brand once and use it for the tab title.
  const brand = useBrandStore(s => s.brand)
  const loadBrand = useBrandStore(s => s.load)
  useEffect(() => { loadBrand({ authenticated: true }) }, [loadBrand])
  useEffect(() => { if (brand?.brand_name) document.title = brand.brand_name }, [brand?.brand_name])

  // Phones: the 240px nav and 280px context panel left ~35px for the page. On a
  // narrow screen the nav becomes a slide-out drawer and the context panel is hidden,
  // so the page gets the full width.
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setNavOpen(false) }, [location.pathname])
  useEffect(() => { if (!isMobile) setNavOpen(false) }, [isMobile])

  return (
    <div className="app-bg flex flex-col h-screen overflow-hidden" data-app-layout="true">
      {isMobile ? (
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface-bg)', flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
            style={{
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', color: 'var(--t2)', cursor: 'pointer', borderRadius: 8,
            }}
          >
            <Menu size={20} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand?.brand_name || 'Veori'}</span>
        </div>
      ) : (
        <SystemStatusBar />
      )}
      <div className="flex flex-1 overflow-hidden">
        {isMobile ? (
          navOpen && (
            <div
              onClick={() => setNavOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000 }}
            >
              <div onClick={e => e.stopPropagation()} style={{ height: '100%', width: 272, maxWidth: '85vw' }}>
                <CommandRail mobile />
              </div>
            </div>
          )
        ) : (
          <CommandRail />
        )}
        <main className="flex-1 overflow-y-auto min-w-0" style={{ background: 'transparent', overflowX: 'auto' }}>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
        {!isMobile && <IntelPanel />}
      </div>
      <AssistantChat />
      <FeedbackButton />
    </div>
  )
}
