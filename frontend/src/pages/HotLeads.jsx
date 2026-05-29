/**
 * /hot-leads - Hot Lead Auto-Escalation Dashboard
 * NEW FILE
 */
import React, { useState, useEffect, useCallback } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function ScoreRing({ score }) {
  const color = '#EF4444'
  return (
    <div style={{ width: 44, height: 44, borderRadius: '50%', border: `3px solid ${color}`, background: 'rgba(239,68,68,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 900, color }}>{score}</span>
    </div>
  )
}

export default function HotLeads() {
  const [hotLeads, setHotLeads]   = useState([])
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading]     = useState(true)
  const [scanning, setScanning]   = useState(false)
  const [tab, setTab]             = useState('live') // live | history

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/hot-leads`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/hot-leads/escalations`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([hl, esc]) => {
      setHotLeads(hl.hotLeads || [])
      setEscalations(esc.escalations || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function runScan() {
    setScanning(true)
    try {
      const res = await fetch(`${API}/hot-leads/scan`, { method: 'POST', headers: authHeader() })
      const d = await res.json()
      alert(`Scan complete. ${d.escalated} new escalations, ${d.skipped} already flagged.`)
      load()
    } catch { alert('Scan failed.') }
    setScanning(false)
  }

  async function resolveEscalation(id) {
    await fetch(`${API}/hot-leads/escalations/${id}/resolve`, { method: 'PUT', headers: authHeader() })
    load()
  }

  const s = {
    page:   { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    card:   { background: '#0A1526', border: '1px solid rgba(239,68,68,0.20)', borderRadius: 14, padding: '20px' },
    h1:     { fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 },
    tab:    (active) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: active ? '#EF4444' : 'rgba(255,255,255,0.06)', color: active ? '#fff' : 'rgba(255,255,255,0.55)', transition: 'all 0.2s' }),
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={s.h1}>🔥 Hot Leads</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
            Leads with motivation score ≥ 85. Auto-escalated with tasks and notifications.
          </p>
        </div>
        <button onClick={runScan} disabled={scanning}
          style={{ padding: '10px 22px', background: '#EF4444', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: scanning ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {scanning ? 'Scanning…' : '⚡ Scan Now'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'live')} onClick={() => setTab('live')}>Live Hot Leads ({hotLeads.length})</button>
        <button style={s.tab(tab === 'history')} onClick={() => setTab('history')}>Escalation History ({escalations.length})</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading…</div>}

      {/* Live hot leads */}
      {!loading && tab === 'live' && (
        <>
          {hotLeads.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              No hot leads right now. Leads with motivation score ≥ 85 will appear here.<br />
              <button onClick={runScan} style={{ marginTop: 16, padding: '8px 18px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>Run Scan</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {hotLeads.map(lead => (
                <div key={lead.id} style={s.card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <ScoreRing score={lead.motivation_score} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 15, fontWeight: 800 }}>{lead.first_name} {lead.last_name}</span>
                        {lead.tags?.includes('HOT') && <span style={{ fontSize: 10, fontWeight: 800, background: '#EF4444', color: '#fff', padding: '2px 7px', borderRadius: 100, letterSpacing: '0.08em' }}>HOT</span>}
                        {lead.escalation && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)' }}>Escalated {new Date(lead.escalation.triggered_at).toLocaleDateString()}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)' }}>{lead.property_address} · {lead.phone}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {lead.escalation && (
                        <button onClick={() => resolveEscalation(lead.escalation.id)}
                          style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.70)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter,sans-serif' }}>
                          Mark Resolved
                        </button>
                      )}
                      {!lead.escalation && (
                        <button onClick={async () => {
                          await fetch(`${API}/hot-leads/${lead.id}/escalate`, { method: 'POST', headers: authHeader() })
                          load()
                        }}
                          style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter,sans-serif' }}>
                          Escalate Now
                        </button>
                      )}
                    </div>
                  </div>
                  {lead.escalation && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ fontSize: 11, color: lead.escalation.notification_sent ? '#00C37A' : 'rgba(255,255,255,0.30)' }}>✓ Notification sent</div>
                      <div style={{ fontSize: 11, color: lead.escalation.follow_up_created ? '#00C37A' : 'rgba(255,255,255,0.30)' }}>✓ 10-min follow-up created</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* History */}
      {!loading && tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {escalations.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No escalation history yet.</div>
          ) : escalations.map(e => (
            <div key={e.id} style={{ ...s.card, border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{e.leads?.first_name} {e.leads?.last_name}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', marginLeft: 10 }}>{e.leads?.property_address}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 700 }}>{e.motivation_score}/100</span>
                  <span style={{ fontSize: 11, color: e.resolved_at ? '#00C37A' : '#C9A84C' }}>
                    {e.resolved_at ? '✓ Resolved' : '⏳ Active'}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>{new Date(e.triggered_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
