import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Zap, Globe, TrendingUp, Activity, Play, RefreshCw, CheckCircle, XCircle, Clock, MapPin, AlertCircle, BarChart2, Database, Search, SlidersHorizontal, X, Target } from 'lucide-react'
import toast from 'react-hot-toast'

const API = import.meta.env.VITE_API_URL || 'https://veori.net'
const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('veori_token')}`, 'Content-Type': 'application/json' })

const SOURCE_COLORS = {
  tax_delinquent: '#FF6B35',
  probate:        '#9B59B6',
  lis_pendens:    '#E74C3C',
  divorce:        '#E91E8C',
  code_violation: '#F39C12',
  usda_land:      '#27AE60',
  blm_land:       '#2ECC71',
  bankruptcy:     '#C0392B',
}

const SOURCE_ICONS = {
  tax_delinquent: '🏚',
  probate:        '⚖️',
  lis_pendens:    '🔒',
  divorce:        '📋',
  code_violation: '⚠️',
  usda_land:      '🌾',
  blm_land:       '🏔',
  bankruptcy:     '🏛',
}

const SCORE_COLOR = (s) => s >= 75 ? '#00C37A' : s >= 50 ? '#F39C12' : s >= 25 ? '#FF6B35' : '#666'

function ScoreBadge({ score }) {
  return (
    <span style={{
      background: `${SCORE_COLOR(score)}22`,
      color: SCORE_COLOR(score),
      border: `1px solid ${SCORE_COLOR(score)}44`,
      borderRadius: 6, padding: '2px 8px',
      fontSize: 11, fontWeight: 700,
    }}>{score}</span>
  )
}

function StatCard({ icon, label, value, sub, color = '#00C37A' }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          {icon}
        </div>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function SourceRow({ source, onToggle, onRun }) {
  const [running, setRunning] = useState(false)
  const color = SOURCE_COLORS[source.key] || '#00C37A'

  const handleRun = async () => {
    setRunning(true)
    try {
      await fetch(`${API}/api/lead-engine/run/${source.key}`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ state: 'FL' }),
      })
      toast.success(`${source.label} running — check pipeline in ~2 min`)
      onRun?.()
    } catch { toast.error('Failed to start') }
    finally { setRunning(false) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{SOURCE_ICONS[source.key] || '📌'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{source.label}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
          {source.total_pulled > 0
            ? `${source.total_pulled.toLocaleString()} pulled · ${source.states_covered} states · avg score ${source.avg_score}`
            : source.last_run_status === 'never' ? 'Not yet run' : `Last: ${source.last_run_status}`}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {source.last_run_status === 'success' && <CheckCircle size={13} color="#00C37A" />}
        {source.last_run_status === 'error'   && <XCircle size={13} color="#FF4444" />}
        {source.last_run_status === 'running' && <RefreshCw size={13} color="#F39C12" style={{ animation: 'spin 1s linear infinite' }} />}

        <button onClick={handleRun} disabled={running} style={{
          background: `${color}18`, border: `1px solid ${color}33`, borderRadius: 7,
          color, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>
          {running ? '…' : 'Run Now'}
        </button>

        <button onClick={() => onToggle(source.key, !source.is_active)} style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: source.is_active ? '#00C37A' : 'rgba(255,255,255,0.1)',
          position: 'relative', transition: 'background 0.2s',
        }}>
          <div style={{
            position: 'absolute', top: 2, left: source.is_active ? 18 : 2,
            width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
          }} />
        </button>
      </div>
    </div>
  )
}

function LeadFeedRow({ lead }) {
  const color = SOURCE_COLORS[lead.lead_type] || '#00C37A'
  const timeAgo = (d) => {
    const diff = Date.now() - new Date(d).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    return `${Math.floor(diff / 3600000)}h ago`
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 18 }}>{SOURCE_ICONS[lead.lead_type] || '📌'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 1 }}>
          {lead.first_name} {lead.last_name}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {lead.property_city}, {lead.property_state} · {(lead.distress_signals || []).length} signals
        </div>
      </div>
      <div style={{ display: 'flex', flex: 'column', alignItems: 'flex-end', gap: 4 }}>
        <ScoreBadge score={lead.sourcing_score || 0} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>{timeAgo(lead.sourced_at)}</div>
      </div>
    </div>
  )
}

export default function LeadEngine() {
  const [status,    setStatus]    = useState(null)
  const [sources,   setSources]   = useState([])
  const [dashboard, setDashboard] = useState(null)
  const [jobs,      setJobs]      = useState([])
  const [running,   setRunning]   = useState(false)
  const [tab,       setTab]       = useState('feed')

  // Search + filter state
  const [searchQ,      setSearchQ]      = useState('')
  const [filterState,  setFilterState]  = useState('')
  const [filterZip,    setFilterZip]    = useState('')
  const [filterCity,   setFilterCity]   = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterScore,  setFilterScore]  = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching,    setSearching]    = useState(false)
  const [showFilters,  setShowFilters]  = useState(false)
  const searchTimeout = useRef(null)

  // Fast targeted pull state
  const [pullState,   setPullState]   = useState('')
  const [pullCity,    setPullCity]    = useState('')
  const [pullZip,     setPullZip]     = useState('')
  const [pulling,     setPulling]     = useState(false)
  const [showPull,    setShowPull]    = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, src, dash, j] = await Promise.all([
        fetch(`${API}/api/lead-engine/status`,    { headers: authHeader() }).then(r => r.json()),
        fetch(`${API}/api/lead-engine/sources`,   { headers: authHeader() }).then(r => r.json()),
        fetch(`${API}/api/lead-engine/dashboard`, { headers: authHeader() }).then(r => r.json()),
        fetch(`${API}/api/lead-engine/jobs`,      { headers: authHeader() }).then(r => r.json()),
      ])
      if (s.success)    setStatus(s)
      if (src.success)  setSources(src.sources || [])
      if (dash.success) setDashboard(dash)
      if (j.success)    setJobs(j.jobs || [])
    } catch (err) {
      console.error('[LeadEngine]', err)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30000) // refresh every 30s
    return () => clearInterval(iv)
  }, [load])

  // Search leads
  const runSearch = useCallback(async (overrides = {}) => {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      const q     = overrides.q     ?? searchQ
      const state = overrides.state ?? filterState
      const zip   = overrides.zip   ?? filterZip
      const city  = overrides.city  ?? filterCity
      const type  = overrides.type  ?? filterType
      const score = overrides.score ?? filterScore
      if (q)     params.set('q', q)
      if (state) params.set('state', state)
      if (zip)   params.set('zip', zip)
      if (city)  params.set('city', city)
      if (type)  params.set('lead_type', type)
      if (score) params.set('min_score', score)
      params.set('limit', '50')

      const r = await fetch(`${API}/api/lead-engine/search?${params}`, { headers: authHeader() })
      const d = await r.json()
      if (d.success) setSearchResults(d)
    } catch { /* silent */ }
    finally { setSearching(false) }
  }, [searchQ, filterState, filterZip, filterCity, filterType, filterScore])

  // Debounced search on text input
  const handleSearchInput = (val) => {
    setSearchQ(val)
    setSearchResults(null)
    clearTimeout(searchTimeout.current)
    if (val.length >= 2 || val.length === 0) {
      searchTimeout.current = setTimeout(() => runSearch({ q: val }), 400)
    }
  }

  // Fast targeted pull
  const handlePull = async () => {
    if (!pullState && !pullCity && !pullZip) {
      toast.error('Enter at least a state, city, or ZIP')
      return
    }
    setPulling(true)
    try {
      const r = await fetch(`${API}/api/lead-engine/pull`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ state: pullState, city: pullCity, zip: pullZip }),
      })
      const d = await r.json()
      if (d.success) {
        toast.success('Pulling leads now — results appear in ~60 seconds', { duration: 6000 })
        setShowPull(false)
        // Poll for new results after 30s and 60s
        setTimeout(() => { load(); runSearch() }, 30000)
        setTimeout(() => { load(); runSearch() }, 65000)
      }
    } catch { toast.error('Pull failed') }
    finally { setPulling(false) }
  }

  const clearSearch = () => {
    setSearchQ(''); setFilterState(''); setFilterZip('')
    setFilterCity(''); setFilterType(''); setFilterScore('')
    setSearchResults(null)
  }

  const hasFilters = searchQ || filterState || filterZip || filterCity || filterType || filterScore

  const handleRunAll = async () => {
    setRunning(true)
    try {
      await fetch(`${API}/api/lead-engine/run`, { method: 'POST', headers: authHeader() })
      toast.success('Lead Engine running — new leads incoming in ~5 minutes', { duration: 5000 })
      setTimeout(load, 10000)
    } catch { toast.error('Failed to start engine') }
    finally { setRunning(false) }
  }

  const handleToggle = async (key, is_active) => {
    await fetch(`${API}/api/lead-engine/sources/${key}`, {
      method: 'PUT', headers: authHeader(),
      body: JSON.stringify({ is_active }),
    })
    setSources(prev => prev.map(s => s.key === key ? { ...s, is_active } : s))
  }

  const totalLeads7d = dashboard?.stats?.leads_7_days || 0

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #00C37A, #00A066)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={18} color="#000" fill="#000" />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: '#fff', margin: 0, letterSpacing: '-0.03em' }}>Lead Engine</h1>
            {status?.is_running && (
              <span style={{ background: '#00C37A22', color: '#00C37A', border: '1px solid #00C37A44', borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
                LIVE
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
            Autonomous public records sourcing — all 50 states · runs every 24h
          </p>
        </div>
        <button onClick={handleRunAll} disabled={running} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: running ? 'rgba(0,195,122,0.2)' : 'linear-gradient(135deg, #00C37A, #00A066)',
          color: running ? '#00C37A' : '#000',
          border: running ? '1px solid #00C37A44' : 'none',
          borderRadius: 10, padding: '10px 20px',
          fontSize: 13, fontWeight: 800, cursor: running ? 'not-allowed' : 'pointer',
        }}>
          {running ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} fill="currentColor" />}
          {running ? 'Running…' : 'Run Now'}
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard icon={<Zap size={16} />}       label="Leads Today"    value={(status?.leads_today || 0).toLocaleString()} sub="Auto-sourced in last 24h" />
        <StatCard icon={<TrendingUp size={16} />} label="Leads This Week" value={totalLeads7d.toLocaleString()} sub="Last 7 days" color="#9B59B6" />
        <StatCard icon={<Database size={16} />}   label="Sources Active"  value={sources.filter(s => s.is_active).length} sub={`of ${sources.length} total`} color="#F39C12" />
        <StatCard icon={<Globe size={16} />}      label="States Covered"  value={status?.states_covered || 50} sub="Nationwide coverage" color="#3498DB" />
      </div>

      {/* Search + Targeted Pull */}
      <div style={{ marginBottom: 20 }}>
        {/* Main search bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search by name, address, city, ZIP…"
              value={searchQ}
              onChange={e => handleSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runSearch()}
              style={{
                width: '100%', height: 42, paddingLeft: 38, paddingRight: 36,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10, color: '#fff', fontSize: 13, boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {searchQ && (
              <X size={13} onClick={() => handleSearchInput('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }} />
            )}
          </div>

          <button onClick={() => setShowFilters(f => !f)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: showFilters ? 'rgba(0,195,122,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${showFilters ? 'rgba(0,195,122,0.3)' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 10, padding: '0 14px', color: showFilters ? '#00C37A' : 'rgba(255,255,255,0.6)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <SlidersHorizontal size={13} /> Filters {hasFilters && <span style={{ background: '#00C37A', color: '#000', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>!</span>}
          </button>

          <button onClick={() => setShowPull(p => !p)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: showPull ? 'rgba(255,107,53,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${showPull ? 'rgba(255,107,53,0.4)' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 10, padding: '0 14px', color: showPull ? '#FF6B35' : 'rgba(255,255,255,0.6)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <Target size={13} /> Pull by Area
          </button>

          {hasFilters && (
            <button onClick={clearSearch} style={{
              background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)',
              borderRadius: 10, padding: '0 12px', color: '#FF4444',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>Clear</button>
          )}
        </div>

        {/* Filter row */}
        {showFilters && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, marginBottom: 10 }}>
            {[
              { label: 'State', val: filterState, set: v => { setFilterState(v); runSearch({ state: v }) }, placeholder: 'e.g. FL', width: 80 },
              { label: 'ZIP', val: filterZip, set: v => { setFilterZip(v); if(v.length===5) runSearch({ zip: v }) }, placeholder: '33101', width: 90 },
              { label: 'City', val: filterCity, set: v => { setFilterCity(v); if(v.length>2) runSearch({ city: v }) }, placeholder: 'Miami', width: 120 },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{f.label}</div>
                <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                  style={{ width: f.width, height: 34, padding: '0 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, outline: 'none' }} />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Lead Type</div>
              <select value={filterType} onChange={e => { setFilterType(e.target.value); runSearch({ type: e.target.value }) }}
                style={{ height: 34, padding: '0 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, outline: 'none' }}>
                <option value="">All Types</option>
                {Object.entries({ tax_delinquent: 'Tax Delinquent', probate: 'Probate', lis_pendens: 'Lis Pendens', divorce: 'Divorce', code_violation: 'Code Violation', usda_land: 'USDA Land', blm_land: 'BLM Land', bankruptcy: 'Bankruptcy' }).map(([k,v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Min Score</div>
              <select value={filterScore} onChange={e => { setFilterScore(e.target.value); runSearch({ score: e.target.value }) }}
                style={{ height: 34, padding: '0 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, outline: 'none' }}>
                <option value="">Any Score</option>
                <option value="75">75+ (Hot)</option>
                <option value="50">50+ (Warm)</option>
                <option value="25">25+ (Qualified)</option>
              </select>
            </div>
            <button onClick={() => runSearch()} style={{
              alignSelf: 'flex-end', height: 34, padding: '0 16px',
              background: '#00C37A', border: 'none', borderRadius: 7,
              color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer',
            }}>Search</button>
          </div>
        )}

        {/* Targeted pull panel */}
        {showPull && (
          <div style={{ padding: 16, background: 'rgba(255,107,53,0.06)', border: '1px solid rgba(255,107,53,0.2)', borderRadius: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#FF6B35', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Target size={14} /> Pull Leads for a Specific Area
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 14 }}>
              Results appear in your feed within 60 seconds. No waiting for the 24h cycle.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {[
                { label: 'State *', val: pullState, set: setPullState, placeholder: 'FL', width: 70 },
                { label: 'City', val: pullCity, set: setPullCity, placeholder: 'Miami', width: 130 },
                { label: 'ZIP Code', val: pullZip, set: setPullZip, placeholder: '33101', width: 100 },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{f.label}</div>
                  <input value={f.val} onChange={e => f.set(e.target.value.toUpperCase())} placeholder={f.placeholder} maxLength={f.label.includes('State') ? 2 : 20}
                    style={{ width: f.width, height: 36, padding: '0 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none' }} />
                </div>
              ))}
              <button onClick={handlePull} disabled={pulling} style={{
                height: 36, padding: '0 20px',
                background: pulling ? 'rgba(255,107,53,0.3)' : '#FF6B35',
                border: 'none', borderRadius: 8, color: pulling ? '#FF6B35' : '#fff',
                fontSize: 13, fontWeight: 800, cursor: pulling ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {pulling ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Pulling…</> : <><Zap size={13} /> Pull Now</>}
              </button>
            </div>
          </div>
        )}

        {/* Search results */}
        {(searchResults || searching) && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              {searching ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Searching…</> : <><Search size={12} /> {searchResults?.total || 0} leads found</>}
            </div>
            {(searchResults?.leads || []).map(l => <LeadFeedRow key={l.id} lead={l} />)}
            {!searching && searchResults?.leads?.length === 0 && (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '20px 0', fontSize: 13 }}>
                No leads match your search. Try different filters or pull leads for this area.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'feed',     label: 'Live Feed',  icon: <Activity size={13} /> },
          { key: 'sources',  label: 'Sources',    icon: <Database size={13} /> },
          { key: 'coverage', label: 'Coverage',   icon: <Globe size={13} /> },
          { key: 'jobs',     label: 'Job History', icon: <Clock size={13} /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: tab === t.key ? 'rgba(255,255,255,0.08)' : 'transparent',
            border: 'none', borderRadius: 7, padding: '7px 14px',
            color: tab === t.key ? '#fff' : 'rgba(255,255,255,0.45)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Live Feed Tab */}
      {tab === 'feed' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Top leads */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={14} /> New Leads — Last 24h
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#00C37A', fontWeight: 700 }}>
                {status?.leads_today || 0} total
              </span>
            </div>
            {(dashboard?.top_leads || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                <Zap size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
                <div>No auto-sourced leads yet.</div>
                <div style={{ fontSize: 11, marginTop: 6 }}>Click "Run Now" to pull your first batch.</div>
              </div>
            ) : (
              (dashboard.top_leads || []).map(l => <LeadFeedRow key={l.id} lead={l} />)
            )}
          </div>

          {/* Source breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChart2 size={14} /> Best Producing Sources (7d)
              </div>
              {(dashboard?.source_breakdown || []).length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', padding: 20 }}>No data yet</div>
              ) : (
                (dashboard.source_breakdown || []).map(s => {
                  const max = Math.max(...dashboard.source_breakdown.map(x => x.count))
                  return (
                    <div key={s.type} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{SOURCE_ICONS[s.type]} {s.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: SOURCE_COLORS[s.type] || '#00C37A' }}>
                          {s.count} leads · avg {s.avg_score}
                        </span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                        <div style={{ height: '100%', width: `${(s.count / max) * 100}%`, background: SOURCE_COLORS[s.type] || '#00C37A', borderRadius: 3, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Top states */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={14} /> Top States (7d)
              </div>
              {(dashboard?.state_breakdown || []).slice(0, 8).map((s, i) => (
                <div key={s.state} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>#{i + 1} {s.state}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#00C37A' }}>{s.count} leads</span>
                </div>
              ))}
              {!dashboard?.state_breakdown?.length && (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center' }}>No data yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sources Tab */}
      {tab === 'sources' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>All Data Sources</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 18 }}>
            Sources run automatically every 24 hours. Toggle off any source you don't want. Free sources run without any API key.
          </div>
          {sources.map(s => (
            <SourceRow key={s.key} source={s} onToggle={handleToggle} onRun={load} />
          ))}
        </div>
      )}

      {/* Coverage Tab */}
      {tab === 'coverage' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Globe size={14} /> State Coverage Map
          </div>
          {/* US States Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
            {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map(st => {
              const covered = (dashboard?.state_breakdown || []).find(s => s.state === st)
              return (
                <div key={st} style={{
                  background: covered ? 'rgba(0,195,122,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${covered ? 'rgba(0,195,122,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: covered ? '#00C37A' : 'rgba(255,255,255,0.4)' }}>{st}</div>
                  {covered && <div style={{ fontSize: 10, color: '#00C37A', opacity: 0.7 }}>{covered.count}</div>}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            <span>🟢 Active coverage</span>
            <span>⬛ Not yet run — click Run Now to start</span>
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {tab === 'jobs' && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>Job History</div>
          {jobs.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '32px 0', fontSize: 13 }}>No jobs run yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {jobs.slice(0, 50).map(j => (
                <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {j.status === 'success' && <CheckCircle size={13} color="#00C37A" />}
                  {j.status === 'error'   && <XCircle size={13} color="#FF4444" />}
                  {j.status === 'running' && <RefreshCw size={13} color="#F39C12" style={{ animation: 'spin 1s linear infinite' }} />}
                  {j.status === 'partial' && <AlertCircle size={13} color="#F39C12" />}
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1 }}>
                    {SOURCE_ICONS[j.source_key]} {j.source_key} · {j.state || 'ALL'}
                  </span>
                  <span style={{ fontSize: 11, color: '#00C37A', fontWeight: 700 }}>+{j.records_new || 0} new</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {new Date(j.started_at).toLocaleDateString()} {new Date(j.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
