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
    <div className="flex flex-col h-screen overflow-hidden" style={{
      background:
        'radial-gradient(ellipse 80% 60% at 15% 10%, rgba(0,195,122,0.04) 0%, transparent 60%), ' +
        'radial-gradient(ellipse 60% 40% at 85% 90%, rgba(201,168,76,0.03) 0%, transparent 50%), ' +
        'radial-gradient(ellipse 100% 80% at 50% 50%, #050A14 0%, #000000 100%)',
    }}>
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
