/**
 * /briefing - Daily AI Briefing page
 * NEW FILE
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const token = localStorage.getItem('veori_token') || localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function DailyBriefing() {
  const [briefing, setBriefing]   = useState(null)
  const [history, setHistory]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [tab, setTab]             = useState('today')

  function load() {
    setLoading(true)
    Promise.all([
      fetch(`${API}/briefing/today`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/briefing/history`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([today, hist]) => {
      setBriefing(today.briefing)
      setHistory(hist.history || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch(`${API}/briefing/generate`, { method: 'POST', headers: authHeader() })
      const d = await res.json()
      setBriefing(d.briefing)
    } catch {}
    setGenerating(false)
  }

  const s = {
    page:  { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    h1:    { fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 },
    card:  { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '24px' },
    stat:  { background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '16px', textAlign: 'center' },
    tab:   (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={s.h1}>☀️ Daily Briefing</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>{today}</p>
        </div>
        <button onClick={generate} disabled={generating}
          style={{ padding: '10px 22px', background: '#C9A84C', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: generating ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {generating ? 'Generating…' : '↻ Refresh Briefing'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'today')} onClick={() => setTab('today')}>Today</button>
        <button style={s.tab(tab === 'history')} onClick={() => setTab('history')}>History</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading briefing…</div>}

      {/* Today's briefing */}
      {!loading && tab === 'today' && (
        <>
          {!briefing ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>☀️</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No briefing generated yet</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 }}>
                Briefings auto-generate every morning at 8am, or click below to generate now.
              </div>
              <button onClick={generate} disabled={generating}
                style={{ padding: '12px 28px', background: '#C9A84C', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                {generating ? 'Generating…' : 'Generate Today\'s Briefing'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* AI Summary */}
              <div style={{ ...s.card, background: 'linear-gradient(135deg, #0D1A0D 0%, #091205 100%)', border: '1px solid rgba(0,195,122,0.20)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#00C37A', marginBottom: 12 }}>AI Summary</div>
                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.80)', lineHeight: 1.7, margin: 0 }}>{briefing.ai_summary}</p>
              </div>

              {/* Yesterday's stats */}
              {briefing.stats && (
                <div style={s.card}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>Yesterday's Performance</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    {[
                      { label: 'Calls Made', value: briefing.stats.totalCalls, color: '#fff' },
                      { label: 'Answered', value: briefing.stats.answered, color: '#00C37A' },
                      { label: 'Avg Motivation', value: `${briefing.stats.avgMotivation}/100`, color: '#C9A84C' },
                      { label: 'New Deals', value: briefing.stats.newDeals, color: '#00C37A' },
                    ].map(item => (
                      <div key={item.label} style={s.stat}>
                        <div style={{ fontSize: 26, fontWeight: 900, color: item.color, marginBottom: 4 }}>{item.value}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Today's priorities */}
              {briefing.priorities?.length > 0 && (
                <div style={s.card}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>Today's Priority Follow-Ups</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {briefing.priorities.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.type === 'hot_lead' ? '#EF4444' : '#C9A84C', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name || 'Unknown Lead'}</div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{p.reason}</div>
                        </div>
                        {p.score && <span style={{ fontSize: 12, fontWeight: 700, color: p.score >= 70 ? '#00C37A' : '#C9A84C' }}>{p.score}/100</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* History */}
      {!loading && tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {history.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No briefing history yet.</div>
          ) : history.map(h => (
            <div key={h.briefing_date} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{new Date(h.briefing_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                  {h.ai_summary && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', maxWidth: 600 }}>{h.ai_summary}</div>}
                </div>
                {h.stats && (
                  <div style={{ display: 'flex', gap: 16, flexShrink: 0, marginLeft: 20 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{h.stats.totalCalls}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Calls</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: '#C9A84C' }}>{h.stats.avgMotivation}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Avg Score</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
