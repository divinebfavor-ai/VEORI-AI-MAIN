import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AssistantChat from '../AI/AssistantChat'

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar */}
      <aside
        className="w-60 flex-shrink-0 bg-surface border-r border-border-subtle overflow-y-auto"
        style={{ minWidth: '240px' }}
      >
        <Sidebar />
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-bg min-w-0">
        <Outlet />
      </main>

      {/* Floating AI Assistant */}
      <AssistantChat />
    </div>
  )
}
