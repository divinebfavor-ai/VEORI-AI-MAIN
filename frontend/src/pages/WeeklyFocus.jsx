/**
 * /weekly-focus — Deal Prediction Engine: This Week's Focus
 * NEW FILE
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function RankBadge({ rank }) {
  const colors = ['#F0C96E', '#C0C0C0', '#CD7F32']
  const color = rank <= 3 ? colors[rank - 1] : 'rgba(255,255,255,0.35)'
  return (
    <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color, fontWeight: 900, fontSize: 13 }}>
      #{rank}
    </div>
  )
}

export default function WeeklyFocus() {
  const [predictions, setPredictions] = useState([])
  const [weekStart, setWeekStart]     = useState('')
  const [loading, setLoading]         = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [generated, setGenerated]     = useState(false)

  function load() {
    setLoading(true)
    fetch(`${API}/deal-prediction/this-week`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => {
        setPredictions(d.predictions || [])
        setWeekStart(d.week_start || '')
        setGenerated(d.generated || false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function generate() {
    setGenerating(true)
    try {
      await fetch(`${API}/deal-prediction/generate`, { method: 'POST', headers: authHeader() })
      load()
    } catch {}
    setGenerating(false)
  }

  async function markClose(id, status) {
    await fetch(`${API}/deal-prediction/${id}/close`, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    load()
  }

  const s = {
    page: { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    card: { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px 24px' },
    h1:   { fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 },
    score: (s) => ({ fontSize: 12, fontWeight: 700, color: s >= 70 ? '#00C37A' : s >= 50 ? '#C9A84C' : 'rgba(255,255,255,0.45)' }),
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={s.h1}>📊 This Week's Focus</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
            {weekStart ? `Week of ${weekStart}` : 'AI-ranked leads most likely to close this week.'}
          </p>
        </div>
        <button onClick={generate} disabled={generating}
          style={{ padding: '10px 22px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: generating ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {generating ? 'Generating…' : '✨ Generate Predictions'}
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading predictions…</div>}

      {!loading && !generated && (
        <div style={{ ...s.card, textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No predictions for this week yet</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 }}>
            Generate now, or predictions run automatically every Monday at 8am.
          </div>
          <button onClick={generate} disabled={generating}
            style={{ padding: '12px 28px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
            {generating ? 'Generating…' : 'Generate This Week\'s Focus'}
          </button>
        </div>
      )}

      {!loading && generated && predictions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {predictions.map((p, i) => {
            const lead = p.leads
            const name = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'Unknown'
            return (
              <div key={p.id} style={{ ...s.card, border: i === 0 ? '1px solid rgba(201,168,76,0.35)' : '1px solid rgba(255,255,255,0.07)', position: 'relative' }}>
                {i === 0 && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #C9A84C, transparent)', borderRadius: '14px 14px 0 0' }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <RankBadge rank={p.rank} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 800 }}>{name}</span>
                      <span style={s.score(p.predicted_score)}>{p.predicted_score}/100 confidence</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
                      {lead?.property_address} · {lead?.phone}
                    </div>
                    {p.reasoning && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}>{p.reasoning}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: lead?.motivation_score >= 70 ? '#00C37A' : '#C9A84C' }}>
                      Motivation {lead?.motivation_score || '?'}/100
                    </span>
                    {p.status === 'active' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => markClose(p.id, 'closed')}
                          style={{ padding: '4px 10px', background: 'rgba(0,195,122,0.12)', border: '1px solid rgba(0,195,122,0.3)', color: '#00C37A', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                          ✓ Closed
                        </button>
                        <button onClick={() => markClose(p.id, 'missed')}
                          style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                          ✗ Missed
                        </button>
                      </div>
                    )}
                    {p.status !== 'active' && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: p.status === 'closed' ? '#00C37A' : '#EF4444', textTransform: 'capitalize' }}>
                        {p.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
