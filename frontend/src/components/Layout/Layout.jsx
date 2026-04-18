import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AssistantChat from '../AI/AssistantChat'

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar — 220px pure black */}
      <aside className="w-[220px] flex-shrink-0 bg-black border-r border-border-subtle overflow-hidden">
        <Sidebar />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-bg min-w-0">
        <Outlet />
      </main>

      {/* Floating AI Assistant */}
      <AssistantChat />
    </div>
  )
}
