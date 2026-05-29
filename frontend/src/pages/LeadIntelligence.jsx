/**
 * /intelligence - Lead Intelligence Hub
 * Shows conversation memory + sentiment timeline + deal probability for a lead
 * NEW FILE
 */
import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'

const SENTIMENT_CONFIG = {
  Motivated: { color: '#00C37A', bg: 'rgba(0,195,122,0.12)', icon: '🔥' },
  Neutral:   { color: '#C9A84C', bg: 'rgba(201,168,76,0.12)', icon: '😐' },
  Hesitant:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: '🤔' },
  Cold:      { color: '#64748B', bg: 'rgba(100,116,139,0.12)', icon: '❄️' },
  Hostile:   { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: '🚫' },
}

function authHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function ScoreBadge({ score }) {
  const color = score >= 61 ? '#00C37A' : score >= 31 ? '#C9A84C' : '#EF4444'
  const label = score >= 61 ? 'HIGH' : score >= 31 ? 'MEDIUM' : 'LOW'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        border: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: `${color}18`,
      }}>
        <span style={{ fontSize: 22, fontWeight: 900, color, fontFamily: 'Inter,sans-serif' }}>{score}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: '0.1em' }}>/ 100</span>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color, marginBottom: 2 }}>{label} PROBABILITY</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter,sans-serif' }}>Deal probability score</div>
      </div>
    </div>
  )
}

function SentimentBadge({ sentiment }) {
  const cfg = SENTIMENT_CONFIG[sentiment] || { color: '#888', bg: 'rgba(136,136,136,0.1)', icon: '❓' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: cfg.bg, border: `1px solid ${cfg.color}40`,
      color: cfg.color, borderRadius: 100,
      fontSize: 12, fontWeight: 700, padding: '3px 10px',
      fontFamily: 'Inter,sans-serif',
    }}>
      {cfg.icon} {sentiment}
    </span>
  )
}

export default function LeadIntelligence() {
  const [params] = useSearchParams()
  const leadId = params.get('lead')

  const [leads, setLeads]         = useState([])
  const [selectedLead, setSelected] = useState(leadId || '')
  const [memory, setMemory]       = useState([])
  const [timeline, setTimeline]   = useState([])
  const [prob, setProb]           = useState(null)
  const [loading, setLoading]     = useState(false)

  // Fetch lead list
  useEffect(() => {
    fetch(`${API}/leads?limit=200`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setLeads(d.data || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedLead) return
    setLoading(true)
    Promise.all([
      fetch(`${API}/lead-memory/${selectedLead}`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/sentiment/${selectedLead}`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/deal-probability/${selectedLead}/calculate`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' } }).then(r => r.json()),
    ]).then(([mem, sent, dp]) => {
      setMemory(mem.history || [])
      setTimeline(sent.timeline || [])
      setProb(dp)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [selectedLead])

  const s = {
    page:    { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    h1:      { fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 },
    card:    { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '24px' },
    label:   { fontSize: 11, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 12 },
    select:  { background: '#0A1526', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '10px 14px', fontSize: 14, fontFamily: 'Inter,sans-serif', width: '100%', outline: 'none' },
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Lead Intelligence</h1>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>
        Conversation history, sentiment timeline, and deal probability for each lead.
      </p>

      {/* Lead selector */}
      <div style={{ maxWidth: 420, marginBottom: 28 }}>
        <div style={s.label}>Select Lead</div>
        <select style={s.select} value={selectedLead} onChange={e => setSelected(e.target.value)}>
          <option value="">- Choose a lead -</option>
          {leads.map(l => (
            <option key={l.id} value={l.id}>
              {l.first_name} {l.last_name} - {l.property_address || l.phone} {l.motivation_score ? `(${l.motivation_score}/100)` : ''}
            </option>
          ))}
        </select>
      </div>

      {!selectedLead && (
        <div style={{ ...s.card, textAlign: 'center', padding: '48px', color: 'rgba(255,255,255,0.35)' }}>
          Select a lead above to view their intelligence report.
        </div>
      )}

      {selectedLead && loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(255,255,255,0.45)' }}>Loading intelligence…</div>
      )}

      {selectedLead && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Deal Probability */}
          <div style={s.card}>
            <div style={s.label}>Deal Probability Score</div>
            {prob ? (
              <>
                <ScoreBadge score={prob.score} />
                {prob.factors && (
                  <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(prob.factors).map(([key, f]) => (
                      <div key={key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                          <span style={{ color: '#fff', fontWeight: 700 }}>{f.points}/{f.max} pts</span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 100 }}>
                          <div style={{ width: `${(f.points / f.max) * 100}%`, height: '100%', background: '#00C37A', borderRadius: 100 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>No score yet.</div>}
          </div>

          {/* Sentiment Timeline */}
          <div style={s.card}>
            <div style={s.label}>Sentiment Timeline</div>
            {timeline.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>No sentiment data yet. Sentiment is logged after each call.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {timeline.map((e, i) => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: SENTIMENT_CONFIG[e.sentiment]?.color || '#888', flexShrink: 0 }} />
                      {i < timeline.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 20, background: 'rgba(255,255,255,0.08)', marginTop: 4 }} />}
                    </div>
                    <div style={{ paddingBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <SentimentBadge sentiment={e.sentiment} />
                        {e.score && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{e.score}/100</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>
                        {new Date(e.created_at).toLocaleDateString()} · {e.source}
                      </div>
                      {e.notes && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>{e.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conversation History */}
          <div style={{ ...s.card, gridColumn: '1 / -1' }}>
            <div style={s.label}>Conversation History ({memory.length} calls)</div>
            {memory.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>No conversation history yet. History is saved after each AI call.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {memory.map((m, i) => (
                  <div key={m.id} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', background: 'rgba(201,168,76,0.1)', padding: '2px 8px', borderRadius: 100 }}>Call {memory.length - i}</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{new Date(m.created_at).toLocaleDateString()}</span>
                      {m.sentiment && <SentimentBadge sentiment={m.sentiment} />}
                      {m.motivation_score && <span style={{ fontSize: 12, color: '#00C37A', fontWeight: 700 }}>{m.motivation_score}/100</span>}
                      {m.call_outcome && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textTransform: 'capitalize' }}>{m.call_outcome.replace(/_/g, ' ')}</span>}
                    </div>
                    {m.key_statements?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#00C37A', marginBottom: 4 }}>Key Statements</div>
                        {m.key_statements.map((s, j) => (
                          <div key={j} style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 2 }}>"{s}"</div>
                        ))}
                      </div>
                    )}
                    {m.objections?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#EF4444', marginBottom: 4 }}>Objections</div>
                        {m.objections.map((o, j) => (
                          <div key={j} style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 2 }}>• {o}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
