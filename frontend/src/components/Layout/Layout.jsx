import React, { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import CommandRail from './CommandRail'
import SystemStatusBar from './SystemStatusBar'
import IntelPanel from './IntelPanel'
import AssistantChat from '../AI/AssistantChat'
import useThemeStore from '../../store/themeStore'

export default function Layout() {
  const { init } = useThemeStore()
  useEffect(() => { init() }, [])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {/* Cinematic background */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden' }}>
        <div className="cinema-base" />
        <div className="cinema-orb cinema-orb-1" />
        <div className="cinema-orb cinema-orb-2" />
        <div className="cinema-orb cinema-orb-3" />
        <div className="cinema-orb cinema-orb-4" />
        <div className="cinema-noise" />
      </div>
      {/* App shell */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SystemStatusBar />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <CommandRail />
          <main className="flex-1 overflow-y-auto min-w-0" style={{ background: 'transparent' }}>
            <Outlet />
          </main>
          <IntelPanel />
        </div>
        <AssistantChat />
      </div>
    </div>
  )
}
