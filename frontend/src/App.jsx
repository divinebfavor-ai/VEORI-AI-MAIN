import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import useAuthStore from './store/authStore'

import Login from './pages/Login'
import PropertyPhotoUpload from './pages/PropertyPhotoUpload'
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
import Billing from './pages/Billing'
import BillingVerify from './pages/BillingVerify'
import Referrals from './pages/Referrals'
import Admin from './pages/Admin'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
// ── Intelligence Features (NEW) ────────────────────────────────────────────────
import LeadIntelligence from './pages/LeadIntelligence'
import HotLeads from './pages/HotLeads'
import WeeklyFocus from './pages/WeeklyFocus'
import HeatMap from './pages/HeatMap'
import DailyBriefing from './pages/DailyBriefing'
// ── Advanced Acquisition (Features 13-21) ─────────────────────────────────────
import SmartList from './pages/SmartList'
import LeadEngine from './pages/LeadEngine'
import DrivingForDollars from './pages/DrivingForDollars'
import CallAnalyticsDashboard from './pages/CallAnalyticsDashboard'
import CallerReputation from './pages/CallerReputation'
import RehabEstimator from './pages/RehabEstimator'
import DirectMailDashboard from './pages/DirectMailDashboard'
import ProfitCalculator from './pages/ProfitCalculator'
// ── Disposition Engine (Features 22-27) ──────────────────────────────────────
import Listings from './pages/Listings'
// ── Content + Social Engine (Features 28-33) ─────────────────────────────────
import ContentStudio from './pages/ContentStudio'
import SocialDashboard from './pages/SocialDashboard'
import VirtualDFD from './pages/VirtualDFD'
import OAuthCallback from './pages/OAuthCallback'
import RefundPolicy from './pages/RefundPolicy'
// ── Virtual Tours (Features 34-38) ───────────────────────────────────────────
import VirtualTourStudio from './pages/VirtualTourStudio'
import TourViewer from './pages/TourViewer'
// ── Property Marketing Engine ─────────────────────────────────────────────────
import PropertyMarketing from './pages/PropertyMarketing'
// ── New Features ──────────────────────────────────────────────────────────────
import Inbox        from './pages/Inbox'
import LeadPipeline from './pages/LeadPipeline'
import Sequences    from './pages/Sequences'
import Appointments from './pages/Appointments'
import MissedCalls  from './pages/MissedCalls'

const ADMIN_EMAILS = ['divineqflash@gmail.com']

function RequireAuth({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hydrated        = useAuthStore((s) => s.hydrated)

  if (!hydrated) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function RequireAdmin({ children }) {
  const user     = useAuthStore((s) => s.user)
  const hydrated = useAuthStore((s) => s.hydrated)

  if (!hydrated) return null
  if (!user || !ADMIN_EMAILS.includes(user.email)) return <Navigate to="/dashboard" replace />
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
      <Route path="/refund-policy" element={<RefundPolicy />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/aria" element={<Aria />} />
      <Route path="/sign/:token" element={<ContractSigning />} />
      <Route path="/upload/:token" element={<PropertyPhotoUpload />} />
      <Route path="/oauth/callback" element={<OAuthCallback />} />
      <Route path="/billing/verify" element={<BillingVerify />} />

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
        {/* ── Intelligence Features (NEW) ───────────────────────────────── */}
        <Route path="/intelligence" element={<LeadIntelligence />} />
        <Route path="/hot-leads" element={<HotLeads />} />
        <Route path="/weekly-focus" element={<WeeklyFocus />} />
        <Route path="/heatmap" element={<HeatMap />} />
        <Route path="/briefing" element={<DailyBriefing />} />
        {/* ── Advanced Acquisition (Features 13-21) ────────────────────── */}
        <Route path="/smart-list" element={<SmartList />} />
        <Route path="/lead-engine" element={<LeadEngine />} />
        <Route path="/dfd" element={<Navigate to="/virtual-dfd" replace />} />
        <Route path="/call-analytics" element={<CallAnalyticsDashboard />} />
        <Route path="/caller-reputation" element={<CallerReputation />} />
        <Route path="/rehab-estimator" element={<RehabEstimator />} />
        <Route path="/direct-mail" element={<DirectMailDashboard />} />
        <Route path="/profit-calculator" element={<ProfitCalculator />} />
        {/* ── Disposition Engine (Features 22-27) ─────────────────────── */}
        <Route path="/listings" element={<Listings />} />
        {/* ── Content + Social Engine (Features 28-33) ─────────────────── */}
        <Route path="/content-studio" element={<ContentStudio />} />
        <Route path="/social-dashboard" element={<SocialDashboard />} />
        {/* ── Virtual DFD (Feature 27) ─────────────────────────────────── */}
        <Route path="/virtual-dfd" element={<VirtualDFD />} />
        {/* ── Virtual Tours (Features 34-38) ───────────────────────────── */}
        <Route path="/virtual-tours" element={<VirtualTourStudio />} />
        {/* ── Property Marketing Engine ─────────────────────────────────── */}
        <Route path="/property-marketing" element={<PropertyMarketing />} />
        {/* ── Billing ───────────────────────────────────────────────────── */}
        <Route path="/billing" element={<Billing />} />
        {/* ── Referrals ─────────────────────────────────────────────────── */}
        <Route path="/referrals" element={<Referrals />} />
        {/* ── Admin ─────────────────────────────────────────────────────── */}
        <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        {/* ── New Features ──────────────────────────────────────────────── */}
        <Route path="/inbox"         element={<Inbox />} />
        <Route path="/lead-pipeline" element={<LeadPipeline />} />
        <Route path="/sequences"     element={<Sequences />} />
        <Route path="/appointments"  element={<Appointments />} />
        <Route path="/missed-calls"  element={<MissedCalls />} />
      </Route>

      {/* Public tour viewer - no auth */}
      <Route path="/tour/:token" element={<TourViewer />} />

      {/* Home - landing for guests, dashboard for logged-in users */}
      <Route path="/" element={<HomeRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
