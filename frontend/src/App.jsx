import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import useAuthStore from './store/authStore'

import Login from './pages/Login'
import Register from './pages/Register'
import Aria from './pages/Aria'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Campaigns from './pages/Campaigns'
import LiveMonitor from './pages/LiveMonitor'
import Pipeline from './pages/Pipeline'
import Buyers from './pages/Buyers'
import Settings from './pages/Settings'
import Analytics from './pages/Analytics'

function RequireAuth({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/aria" element={<Aria />} />

      {/* Protected */}
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<Campaigns />} />
        <Route path="/monitor" element={<LiveMonitor />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/buyers" element={<Buyers />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Default */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
