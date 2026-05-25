/**
 * Feature 13 — Smart List Prioritization Engine
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const TIER_COLORS = { A: '#00C37A', B: '#C9A84C', C: '#F59E0B', D: 'rgba(255,255,255,0.35)' }
const TIER_LABELS = { A: 'A-Tier — Call Today', B: 'B-Tier — Call This Week', C: 'C-Tier — Nurture', D: 'D-Tier — Low Priority' }

export default function SmartList() {
  const [leads, setLeads]     = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/smart-list/prioritized`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setLeads(d.leads || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = leads.filter(l => {
    const matchTier = filter === 'all' || l.priority_tier === filter
    const q = search.toLowerCase()
    const matchSearch = !q || `${l.first_name} ${l.last_name} ${l.property_address}`.toLowerCase().includes(q)
    return matchTier && matchSearch
  })

  const counts = { A: leads.filter(l => l.priority_tier === 'A').length, B: leads.filter(l => l.priority_tier === 'B').length, C: leads.filter(l => l.priority_tier === 'C').length, D: leads.filter(l => l.priority_tier === 'D').length }

  const s = {
    page:  { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    card:  { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: 240 },
    btn:   (a) => ({ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
  }

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🎯 Smart List</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>AI-ranked leads by deal probability. Call A-tier first.</p>
      </div>

      {/* Tier summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {['A','B','C','D'].map(tier => (
          <div key={tier} style={{ ...s.card, cursor: 'pointer', border: filter === tier ? `1px solid ${TIER_COLORS[tier]}` : '1px solid rgba(255,255,255,0.07)' }} onClick={() => setFilter(filter === tier ? 'all' : tier)}>
            <div style={{ fontSize: 28, fontWeight: 900, color: TIER_COLORS[tier] }}>{counts[tier]}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{TIER_LABELS[tier]}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          style={s.input}
          placeholder="Search name or address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {['all','A','B','C','D'].map(t => (
            <button key={t} style={s.btn(filter === t)} onClick={() => setFilter(t)}>{t === 'all' ? 'All' : `${t}-Tier`}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>{filtered.length} leads</span>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Calculating priorities…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No leads match this filter.</div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((lead, i) => {
            const tierColor = TIER_COLORS[lead.priority_tier] || '#fff'
            const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown'
            return (
              <div key={lead.id} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${tierColor}20`, border: `2px solid ${tierColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: tierColor, fontWeight: 900, fontSize: 13 }}>
                  {lead.priority_tier}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{name}</span>
                    <span style={{ fontSize: 12, color: tierColor, fontWeight: 700 }}>{lead.priority_score}/100</span>
                    {lead.days_since_contact !== null && (
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Last contact {lead.days_since_contact}d ago</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{lead.property_address}{lead.city ? `, ${lead.city}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {lead.motivation_score != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: (lead.motivation_score||0) >= 70 ? '#00C37A' : '#C9A84C' }}>{lead.motivation_score}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Motivation</div>
                    </div>
                  )}
                  {lead.equity_percent != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{lead.equity_percent}%</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Equity</div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
