import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import RouteFallback from './components/RouteFallback'
import useAuthStore from './store/authStore'
import lazyWithRetry from './utils/lazyWithRetry'

// Every page is its own chunk, so a visit downloads only the code for the page
// being opened instead of all ~70 pages at once.
const Login                  = lazyWithRetry(() => import('./pages/Login'))
const PropertyPhotoUpload    = lazyWithRetry(() => import('./pages/PropertyPhotoUpload'))
const Register               = lazyWithRetry(() => import('./pages/Register'))
const ForgotPassword         = lazyWithRetry(() => import('./pages/ForgotPassword'))
const ResetPassword          = lazyWithRetry(() => import('./pages/ResetPassword'))
const Aria                   = lazyWithRetry(() => import('./pages/Aria'))
const GettingStarted         = lazyWithRetry(() => import('./pages/GettingStarted'))
const Dashboard              = lazyWithRetry(() => import('./pages/Dashboard'))
const Leads                  = lazyWithRetry(() => import('./pages/Leads'))
const Campaigns              = lazyWithRetry(() => import('./pages/Campaigns'))
const LiveMonitor            = lazyWithRetry(() => import('./pages/LiveMonitor'))
const Pipeline               = lazyWithRetry(() => import('./pages/Pipeline'))
const Buyers                 = lazyWithRetry(() => import('./pages/Buyers'))
const Settings               = lazyWithRetry(() => import('./pages/Settings'))
const Analytics              = lazyWithRetry(() => import('./pages/Analytics'))
const Calculator             = lazyWithRetry(() => import('./pages/Calculator'))
const Compliance             = lazyWithRetry(() => import('./pages/Compliance'))
const Dialer                 = lazyWithRetry(() => import('./pages/Dialer'))
const DealWorkspace          = lazyWithRetry(() => import('./pages/DealWorkspace'))
const DealRoom               = lazyWithRetry(() => import('./pages/DealRoom'))
const DealPhotoGallery       = lazyWithRetry(() => import('./pages/DealPhotoGallery'))
const TitleCompanies         = lazyWithRetry(() => import('./pages/TitleCompanies'))
const ContractSigning        = lazyWithRetry(() => import('./pages/ContractSigning'))
const Academy                = lazyWithRetry(() => import('./pages/Academy'))
const Marketplace            = lazyWithRetry(() => import('./pages/Marketplace'))
const FollowUps              = lazyWithRetry(() => import('./pages/FollowUps'))
const WealthPlaybook         = lazyWithRetry(() => import('./pages/WealthPlaybook'))
const WealthStrategy         = lazyWithRetry(() => import('./pages/WealthStrategy'))
const WealthCalculatorPage   = lazyWithRetry(() => import('./pages/WealthCalculatorPage'))
const LandingPage            = lazyWithRetry(() => import('./pages/LandingPage'))
const Billing                = lazyWithRetry(() => import('./pages/Billing'))
const BillingVerify          = lazyWithRetry(() => import('./pages/BillingVerify'))
const Referrals              = lazyWithRetry(() => import('./pages/Referrals'))
const Admin                  = lazyWithRetry(() => import('./pages/Admin'))
const Terms                  = lazyWithRetry(() => import('./pages/Terms'))
const ApiDocs                = lazyWithRetry(() => import('./pages/ApiDocs'))
const TeamAccept             = lazyWithRetry(() => import('./pages/TeamAccept'))
const Privacy                = lazyWithRetry(() => import('./pages/Privacy'))
// ── Intelligence Features ──────────────────────────────────────────────────────
const LeadIntelligence       = lazyWithRetry(() => import('./pages/LeadIntelligence'))
const HotLeads               = lazyWithRetry(() => import('./pages/HotLeads'))
const WeeklyFocus            = lazyWithRetry(() => import('./pages/WeeklyFocus'))
const HeatMap                = lazyWithRetry(() => import('./pages/HeatMap'))
const DailyBriefing          = lazyWithRetry(() => import('./pages/DailyBriefing'))
const COOCommandCenter       = lazyWithRetry(() => import('./pages/COOCommandCenter'))
// ── Advanced Acquisition ──────────────────────────────────────────────────────
const SmartList              = lazyWithRetry(() => import('./pages/SmartList'))
const LeadEngine             = lazyWithRetry(() => import('./pages/LeadEngine'))
const DrivingForDollars      = lazyWithRetry(() => import('./pages/DrivingForDollars'))
const CallAnalyticsDashboard = lazyWithRetry(() => import('./pages/CallAnalyticsDashboard'))
const CallerReputation       = lazyWithRetry(() => import('./pages/CallerReputation'))
const RehabEstimator         = lazyWithRetry(() => import('./pages/RehabEstimator'))
const DirectMailDashboard    = lazyWithRetry(() => import('./pages/DirectMailDashboard'))
const ProfitCalculator       = lazyWithRetry(() => import('./pages/ProfitCalculator'))
// ── Disposition Engine ────────────────────────────────────────────────────────
const Listings               = lazyWithRetry(() => import('./pages/Listings'))
// ── Content + Social Engine ───────────────────────────────────────────────────
const ContentStudio          = lazyWithRetry(() => import('./pages/ContentStudio'))
const SocialDashboard        = lazyWithRetry(() => import('./pages/SocialDashboard'))
const VirtualDFD             = lazyWithRetry(() => import('./pages/VirtualDFD'))
const OAuthCallback          = lazyWithRetry(() => import('./pages/OAuthCallback'))
const RefundPolicy           = lazyWithRetry(() => import('./pages/RefundPolicy'))
// ── Virtual Tours ─────────────────────────────────────────────────────────────
const VirtualTourStudio      = lazyWithRetry(() => import('./pages/VirtualTourStudio'))
const TourViewer             = lazyWithRetry(() => import('./pages/TourViewer'))
// ── Property Marketing Engine ─────────────────────────────────────────────────
const PropertyMarketing      = lazyWithRetry(() => import('./pages/PropertyMarketing'))
// ── Operations ────────────────────────────────────────────────────────────────
const Inbox                  = lazyWithRetry(() => import('./pages/Inbox'))
const LeadPipeline           = lazyWithRetry(() => import('./pages/LeadPipeline'))
const Sequences              = lazyWithRetry(() => import('./pages/Sequences'))
const Appointments           = lazyWithRetry(() => import('./pages/Appointments'))
const MissedCalls            = lazyWithRetry(() => import('./pages/MissedCalls'))
const SmsTemplates           = lazyWithRetry(() => import('./pages/SmsTemplates'))
const VeoriIntelligence      = lazyWithRetry(() => import('./pages/VeoriIntelligence'))

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
    // This boundary serves public pages, which have no app shell. Pages inside
    // the shell are caught by the closer boundary in Layout, so the sidebar and
    // status bar stay visible while a page loads.
    <Suspense fallback={<RouteFallback fullScreen />}>
      <Routes>
        {/* Public */}
        <Route path="/terms" element={<Terms />} />
        <Route path="/developers" element={<ApiDocs />} />
        <Route path="/team/accept" element={<TeamAccept />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/aria" element={<Aria />} />
        <Route path="/getting-started" element={<GettingStarted />} />
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
          <Route path="/deals/:id/room" element={<DealRoom />} />
          <Route path="/deals/:id/photos" element={<DealPhotoGallery />} />
          <Route path="/follow-ups" element={<FollowUps />} />
          <Route path="/title-companies" element={<TitleCompanies />} />
          <Route path="/academy" element={<Academy />} />
          <Route path="/wealth" element={<WealthPlaybook />} />
          <Route path="/wealth/strategy/:id" element={<WealthStrategy />} />
          <Route path="/wealth/calculator" element={<WealthCalculatorPage />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/settings" element={<Settings />} />
          {/* ── Intelligence Features ─────────────────────────────────────── */}
          <Route path="/intelligence" element={<LeadIntelligence />} />
          <Route path="/hot-leads" element={<HotLeads />} />
          <Route path="/weekly-focus" element={<WeeklyFocus />} />
          <Route path="/heatmap" element={<HeatMap />} />
          <Route path="/briefing" element={<DailyBriefing />} />
          <Route path="/coo" element={<COOCommandCenter />} />
          {/* ── Advanced Acquisition ──────────────────────────────────────── */}
          <Route path="/smart-list" element={<SmartList />} />
          <Route path="/lead-engine" element={<LeadEngine />} />
          <Route path="/dfd" element={<DrivingForDollars />} />
          <Route path="/call-analytics" element={<CallAnalyticsDashboard />} />
          <Route path="/caller-reputation" element={<CallerReputation />} />
          <Route path="/rehab-estimator" element={<RehabEstimator />} />
          <Route path="/direct-mail" element={<DirectMailDashboard />} />
          <Route path="/profit-calculator" element={<ProfitCalculator />} />
          {/* ── Disposition Engine ────────────────────────────────────────── */}
          <Route path="/listings" element={<Listings />} />
          {/* ── Content + Social Engine ───────────────────────────────────── */}
          <Route path="/content-studio" element={<ContentStudio />} />
          <Route path="/social-dashboard" element={<SocialDashboard />} />
          {/* ── Virtual DFD ───────────────────────────────────────────────── */}
          <Route path="/virtual-dfd" element={<VirtualDFD />} />
          {/* ── Virtual Tours ─────────────────────────────────────────────── */}
          <Route path="/virtual-tours" element={<VirtualTourStudio />} />
          {/* ── Property Marketing Engine ─────────────────────────────────── */}
          <Route path="/property-marketing" element={<PropertyMarketing />} />
          {/* ── Billing ───────────────────────────────────────────────────── */}
          <Route path="/billing" element={<Billing />} />
          {/* ── Referrals ─────────────────────────────────────────────────── */}
          <Route path="/referrals" element={<Referrals />} />
          {/* ── Admin ─────────────────────────────────────────────────────── */}
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          {/* ── Operations ────────────────────────────────────────────────── */}
          <Route path="/inbox"         element={<Inbox />} />
          <Route path="/lead-pipeline" element={<LeadPipeline />} />
          <Route path="/sequences"     element={<Sequences />} />
          <Route path="/appointments"  element={<Appointments />} />
          <Route path="/missed-calls"  element={<MissedCalls />} />
          <Route path="/sms-templates" element={<SmsTemplates />} />
          <Route path="/intelligence/lead/:id" element={<VeoriIntelligence />} />
          <Route path="/intelligence/lead"     element={<VeoriIntelligence />} />
        </Route>

        {/* Public tour viewer - no auth */}
        <Route path="/tour/:token" element={<TourViewer />} />

        {/* Home - landing for guests, dashboard for logged-in users */}
        <Route path="/" element={<HomeRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
