import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import useAuthStore from './store/authStore'

import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Aria from './pages/Aria'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Campaigns from './pages/Campaigns'
import LiveMonitor from './pages/LiveMonitor'
import Pipeline from './pages/Pipeline'
import Buyers from './pages/Buyers'
import Settings from './pages/Settings'
import Analytics from './pages/Analytics'
import Calculator from './pages/Calculator'
import Compliance from './pages/Compliance'
import Dialer from './pages/Dialer'
import DealWorkspace from './pages/DealWorkspace'
import DealPhotoGallery from './pages/DealPhotoGallery'
import TitleCompanies from './pages/TitleCompanies'
import ContractSigning from './pages/ContractSigning'
import Academy from './pages/Academy'
import Marketplace from './pages/Marketplace'
import FollowUps from './pages/FollowUps'
import WealthPlaybook from './pages/WealthPlaybook'
import WealthStrategy from './pages/WealthStrategy'
import WealthCalculatorPage from './pages/WealthCalculatorPage'
import LandingPage from './pages/LandingPage'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'

function RequireAuth({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hydrated        = useAuthStore((s) => s.hydrated)

  // Don't redirect until we've read localStorage — avoids flash-logout on page load
  if (!hydrated) return null

  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function HomeRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hydrated        = useAuthStore((s) => s.hydrated)
  if (!hydrated) return null
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <LandingPage />
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/aria" element={<Aria />} />
      <Route path="/sign/:token" element={<ContractSigning />} />

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
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/dialer" element={<Dialer />} />
        <Route path="/deals/:id" element={<DealWorkspace />} />
        <Route path="/deals/:id/photos" element={<DealPhotoGallery />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route path="/title-companies" element={<TitleCompanies />} />
        <Route path="/academy" element={<Academy />} />
        <Route path="/wealth" element={<WealthPlaybook />} />
        <Route path="/wealth/strategy/:id" element={<WealthStrategy />} />
        <Route path="/wealth/calculator" element={<WealthCalculatorPage />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Home — landing for guests, dashboard for logged-in users */}
      <Route path="/" element={<HomeRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
