/**
 * Feature 17 — Live Caller ID Reputation Score
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

function SpamBar({ score }) {
  const color = score >= 60 ? '#EF4444' : score >= 40 ? '#F59E0B' : '#00C37A'
  return (
    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  )
}

export default function CallerReputation() {
  const [numbers, setNumbers]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  function load() {
    setLoading(true)
    fetch(`${API}/caller-reputation`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setNumbers(d.numbers || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  async function refresh() {
    setRefreshing(true)
    await fetch(`${API}/caller-reputation/refresh`, { method: 'POST', headers: authHeader() })
    setRefreshing(false)
    load()
  }

  useEffect(() => { load() }, [])

  const s = {
    page: { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    card: { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px' },
  }

  const flagged   = numbers.filter(n => n.reputation?.flagged_spam)
  const degrading = numbers.filter(n => !n.reputation?.flagged_spam && (n.reputation?.spam_score || 0) >= 40)
  const healthy   = numbers.filter(n => (n.reputation?.spam_score || 0) < 40)

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>📡 Caller ID Reputation</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Monitor your phone number health. Rotate flagged numbers immediately.</p>
        </div>
        <button onClick={refresh} disabled={refreshing}
          style={{ padding: '10px 22px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: refreshing ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {refreshing ? 'Refreshing…' : '↻ Refresh All'}
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: '🚨 Flagged as Spam', value: flagged.length, color: '#EF4444' },
          { label: '⚠️ Degrading', value: degrading.length, color: '#F59E0B' },
          { label: '✅ Healthy', value: healthy.length, color: '#00C37A' },
        ].map(item => (
          <div key={item.label} style={s.card}>
            <div style={{ fontSize: 28, fontWeight: 900, color: item.color, marginBottom: 2 }}>{item.value}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading reputation data…</div>}

      {!loading && numbers.length === 0 && (
        <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
          No phone numbers found. Add numbers in your Phones dashboard first.
        </div>
      )}

      {!loading && numbers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {numbers.map(n => {
            const rep   = n.reputation || {}
            const spam  = rep.spam_score || 0
            const color = spam >= 60 ? '#EF4444' : spam >= 40 ? '#F59E0B' : '#00C37A'
            const label = spam >= 60 ? '🚨 Flagged' : spam >= 40 ? '⚠️ Degrading' : '✅ Healthy'
            return (
              <div key={n.id || n.number} style={{ ...s.card, border: rep.flagged_spam ? '1px solid rgba(239,68,68,0.30)' : '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 800 }}>{n.number}</span>
                      {n.label && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>{n.label}</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}20`, padding: '2px 10px', borderRadius: 6 }}>{label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
                      Answer rate: {rep.answer_rate || 0}% · {rep.total_calls || 0} calls tracked
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
                        <span>Spam risk</span>
                        <span>{spam}/100</span>
                      </div>
                      <SpamBar score={spam} />
                    </div>
                  </div>
                </div>
                {rep.flagged_spam && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.10)', borderRadius: 8, fontSize: 12, color: '#EF4444' }}>
                    ⚠️ This number may be flagged as spam by carriers. Rotate to a fresh number to restore answer rates.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
