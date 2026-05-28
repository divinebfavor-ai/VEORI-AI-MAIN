/**
 * AI-Powered Driving for Dollars
 * User types a zip code → AI scans for distressed/vacant/absentee-owner properties
 * → auto-imports as leads → launches a campaign automatically
 * No physical driving required. The AI does it all.
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('veori_token') || localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const FILTERS = [
  { id: 'vacant',          label: 'Vacant Properties',        icon: '🏚', desc: 'Unoccupied homes, high seller urgency' },
  { id: 'absentee_owner',  label: 'Absentee Owners',          icon: '📍', desc: 'Owner lives elsewhere, landlord fatigue' },
  { id: 'tax_delinquent',  label: 'Tax Delinquent',           icon: '⚠️', desc: 'Behind on property taxes, motivated to sell' },
  { id: 'pre_foreclosure', label: 'Pre-Foreclosure',          icon: '🔴', desc: 'Facing foreclosure, needs quick exit' },
  { id: 'high_equity',     label: 'High Equity',              icon: '💰', desc: 'Lots of equity, room to negotiate' },
  { id: 'long_owned',      label: 'Long-Term Owners (10y+)',  icon: '📅', desc: 'Owned 10+ years, ready to cash out' },
]

const STEPS = [
  { icon: '🔍', label: 'Scanning zip code' },
  { icon: '🏘', label: 'Finding distressed properties' },
  { icon: '🧠', label: 'AI scoring motivation' },
  { icon: '📋', label: 'Importing as leads' },
  { icon: '📞', label: 'Launching call campaign' },
]

export default function VirtualDFD() {
  const [zip, setZip]               = useState('')
  const [city, setCity]             = useState('')
  const [state, setState]           = useState('')
  const [filters, setFilters]       = useState(['vacant', 'absentee_owner', 'tax_delinquent'])
  const [maxLeads, setMaxLeads]     = useState(50)
  const [autoCampaign, setAutoCampaign] = useState(true)
  const [running, setRunning]       = useState(false)
  const [step, setStep]             = useState(-1)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState('')
  const [history, setHistory]       = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setLoadingHistory(true)
    try {
      const r = await fetch(`${API}/dfd/scans`, { headers: authHeader() })
      const d = await r.json()
      if (d.success) setHistory(d.scans || [])
    } catch {}
    setLoadingHistory(false)
  }

  function toggleFilter(id) {
    setFilters(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    )
  }

  async function runScan() {
    if (!zip.trim()) { setError('Enter a zip code to scan.'); return }
    if (filters.length === 0) { setError('Select at least one property type.'); return }
    setError('')
    setRunning(true)
    setResult(null)
    setStep(0)

    // Animate through steps while waiting
    const stepInterval = setInterval(() => {
      setStep(prev => (prev < STEPS.length - 1 ? prev + 1 : prev))
    }, 2200)

    try {
      const r = await fetch(`${API}/dfd/ai-scan`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          zip: zip.trim(),
          city: city.trim(),
          state: state.trim(),
          filters,
          max_leads: maxLeads,
          auto_campaign: autoCampaign,
        }),
      })
      const d = await r.json()
      clearInterval(stepInterval)
      setStep(STEPS.length - 1)

      if (d.success) {
        setResult(d)
        loadHistory()
      } else {
        setError(d.error || 'Scan failed. Please try again.')
      }
    } catch (e) {
      clearInterval(stepInterval)
      setError('Connection error. Please try again.')
    }

    setRunning(false)
    setTimeout(() => setStep(-1), 1000)
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const s = {
    page:   { padding: 32, color: 'var(--t1,#fff)', fontFamily: 'Inter,sans-serif', maxWidth: 900 },
    card:   { background: 'var(--card-bg,#0A1526)', border: '1px solid var(--border,rgba(255,255,255,0.07))', borderRadius: 14, padding: 24, marginBottom: 20 },
    input:  { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '10px 14px', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
    label:  { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' },
    btn:    { padding: '13px 28px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif', width: '100%' },
    btnDis: { padding: '13px 28px', background: 'rgba(0,195,122,0.35)', color: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: 'not-allowed', fontFamily: 'Inter,sans-serif', width: '100%' },
  }

  return (
    <div style={s.page}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', margin: '0 0 6px' }}>
          🤖 AI Driving for Dollars
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
          Type a zip code. The AI scans the neighborhood, finds distressed properties, imports them as leads, and starts calling. You don't lift a finger.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>

        {/* Left — scan form */}
        <div>
          {/* Location */}
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#00C37A', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Area</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 12, marginBottom: 0 }}>
              <div>
                <label style={s.label}>Zip Code *</label>
                <input style={s.input} placeholder="e.g. 33101" value={zip} onChange={e => setZip(e.target.value)} maxLength={10} />
              </div>
              <div>
                <label style={s.label}>City (optional)</label>
                <input style={s.input} placeholder="Miami" value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div>
                <label style={s.label}>State</label>
                <input style={s.input} placeholder="FL" value={state} onChange={e => setState(e.target.value)} maxLength={2} />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#00C37A', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Property Types to Find</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {FILTERS.map(f => {
                const on = filters.includes(f.id)
                return (
                  <button key={f.id} onClick={() => toggleFilter(f.id)} style={{
                    background: on ? 'rgba(0,195,122,0.10)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? 'rgba(0,195,122,0.45)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'Inter,sans-serif',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#00C37A' : 'rgba(255,255,255,0.75)', marginBottom: 3 }}>
                      {f.icon} {f.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 }}>{f.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Options */}
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#00C37A', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Scan Options</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={s.label}>Max Leads to Import</label>
                <select style={s.input} value={maxLeads} onChange={e => setMaxLeads(Number(e.target.value))}>
                  {[25, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n} leads</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Auto-Launch Campaign</label>
                <button
                  onClick={() => setAutoCampaign(!autoCampaign)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${autoCampaign ? 'rgba(0,195,122,0.45)' : 'rgba(255,255,255,0.10)'}`,
                    background: autoCampaign ? 'rgba(0,195,122,0.10)' : 'rgba(255,255,255,0.03)',
                    color: autoCampaign ? '#00C37A' : 'rgba(255,255,255,0.55)',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
                    textAlign: 'left',
                  }}
                >
                  {autoCampaign ? '✅ Yes — start calling immediately' : '❌ No — just import leads'}
                </button>
              </div>
            </div>
          </div>

          {error && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '-10px 0 16px' }}>{error}</p>}

          {/* Run button */}
          {!running ? (
            <button style={s.btn} onClick={runScan}>
              🤖 Run AI Scan →
            </button>
          ) : (
            <button style={s.btnDis} disabled>
              Scanning…
            </button>
          )}
        </div>

        {/* Right — progress + result */}
        <div>
          {/* Progress */}
          {running && (
            <div style={{ ...s.card, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00C37A', marginBottom: 16 }}>AI SCAN IN PROGRESS</div>
              {STEPS.map((st, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', opacity: i <= step ? 1 : 0.25, transition: 'opacity 0.4s' }}>
                  <span style={{ fontSize: 18 }}>{i < step ? '✅' : i === step ? st.icon : '○'}</span>
                  <span style={{ fontSize: 13, color: i === step ? '#fff' : 'rgba(255,255,255,0.55)', fontWeight: i === step ? 700 : 400 }}>
                    {st.label}{i === step ? '…' : ''}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 16, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                <div style={{ height: '100%', background: '#00C37A', borderRadius: 3, width: `${((step + 1) / STEPS.length) * 100}%`, transition: 'width 0.5s' }} />
              </div>
            </div>
          )}

          {/* Result */}
          {result && !running && (
            <div style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#00C37A', marginBottom: 16 }}>✅ SCAN COMPLETE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Properties Found',  value: result.found     ?? 0 },
                  { label: 'Leads Imported',     value: result.imported  ?? 0 },
                  { label: 'Avg Score',          value: result.avg_score ? `${result.avg_score}/100` : '—' },
                  { label: 'Campaign',           value: result.campaign_started ? 'Started ✅' : 'Not started' },
                ].map(m => (
                  <div key={m.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#00C37A' }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {result.top_leads?.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Top Leads Found</div>
                  {result.top_leads.slice(0, 5).map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{l.address}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{l.tags?.join(', ')}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: l.score >= 70 ? '#00C37A' : l.score >= 40 ? '#C9A84C' : 'rgba(255,255,255,0.4)' }}>
                        {l.score}/100
                      </div>
                    </div>
                  ))}
                </>
              )}
              {result.campaign_id && (
                <a href="/campaigns" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#00C37A', textDecoration: 'none' }}>
                  View Campaign →
                </a>
              )}
            </div>
          )}

          {/* How it works */}
          {!running && !result && (
            <div style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#C9A84C', marginBottom: 14 }}>HOW IT WORKS</div>
              {[
                ['🔍', 'You type a zip code'],
                ['🏘', 'AI finds distressed & vacant properties'],
                ['🧠', 'Each property gets a motivation score'],
                ['📋', 'Leads imported to your CRM automatically'],
                ['📞', 'AI calls every lead within 60 seconds'],
                ['💰', 'Hot leads flagged for your review'],
              ].map(([icon, text], i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{icon}</span>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scan history */}
      {history.length > 0 && (
        <div style={s.card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Previous Scans</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {history.map(h => (
              <div key={h.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>📍 {h.zip}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{new Date(h.created_at).toLocaleDateString()}</div>
                <div style={{ fontSize: 12, color: '#00C37A', fontWeight: 700 }}>{h.leads_imported} leads imported</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
