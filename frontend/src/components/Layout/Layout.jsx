import React, { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import CommandRail from './CommandRail'
import SystemStatusBar from './SystemStatusBar'
import IntelPanel from './IntelPanel'
import AssistantChat from '../AI/AssistantChat'
import useThemeStore from '../../store/themeStore'

export default function Layout() {
  const { init } = useThemeStore()

  // Apply saved theme on mount
  useEffect(() => { init() }, [])

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* ── System Status Bar — full width, 36px ─────────────────────── */}
      <SystemStatusBar />

      {/* ── Three-zone workspace ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Zone 1: Command Rail — 64px, icon-only nav */}
        <CommandRail />

        {/* Zone 2: Primary Workspace — adaptive, scrollable */}
        <main
          className="flex-1 overflow-y-auto min-w-0"
          style={{ background: 'var(--bg)' }}
        >
          <Outlet />
        </main>

        {/* Zone 3: Intelligence Panel — 320px, always visible */}
        <IntelPanel />

      </div>

      {/* Floating AI Assistant */}
      <AssistantChat />
    </div>
  )
}
