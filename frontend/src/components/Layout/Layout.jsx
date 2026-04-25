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
    <div className="app-bg flex flex-col h-screen overflow-hidden">
      <SystemStatusBar />
      <div className="flex flex-1 overflow-hidden">
        <CommandRail />
        <main className="flex-1 overflow-y-auto min-w-0" style={{ background: 'transparent' }}>
          <Outlet />
        </main>
        <IntelPanel />
      </div>
      <AssistantChat />
    </div>
  )
}
