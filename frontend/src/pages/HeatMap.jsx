/**
 * /heatmap — Market Heat Map by zip code
 * NEW FILE — visual zip code grid, no external map library needed
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const HEAT_COLORS = {
  red:    { bg: 'rgba(239,68,68,0.20)',    border: 'rgba(239,68,68,0.45)',    text: '#EF4444',  label: 'Hot Market' },
  yellow: { bg: 'rgba(245,158,11,0.15)',   border: 'rgba(245,158,11,0.40)',   text: '#F59E0B',  label: 'Warm Market' },
  grey:   { bg: 'rgba(255,255,255,0.04)',  border: 'rgba(255,255,255,0.08)',  text: 'rgba(255,255,255,0.45)', label: 'Cool Market' },
}

export default function HeatMap() {
  const [heatmap, setHeatmap]   = useState([])
  const [topZips, setTopZips]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all') // all|red|yellow|grey
  const [sortBy, setSortBy]     = useState('count') // count|avg_score|hot_count

  useEffect(() => {
    Promise.all([
      fetch(`${API}/heatmap`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/heatmap/top-zips`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([hm, top]) => {
      setHeatmap(hm.heatmap || [])
      setTopZips(top.topZips || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = heatmap
    .filter(z => filter === 'all' || z.heat === filter)
    .sort((a, b) => b[sortBy] - a[sortBy])

  const totals = {
    red:    heatmap.filter(z => z.heat === 'red').length,
    yellow: heatmap.filter(z => z.heat === 'yellow').length,
    grey:   heatmap.filter(z => z.heat === 'grey').length,
    total:  heatmap.reduce((s, z) => s + z.count, 0),
  }

  const s = {
    page:  { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    h1:    { fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 },
    card:  { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px' },
    btn:   (active) => ({ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Inter,sans-serif', transition: 'all 0.2s', background: active ? '#00C37A' : 'rgba(255,255,255,0.06)', color: active ? '#000' : 'rgba(255,255,255,0.55)' }),
    select: { background: '#0A1526', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '7px 12px', fontSize: 12, fontFamily: 'Inter,sans-serif', outline: 'none' },
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>🗺 Market Heat Map</h1>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 24 }}>
        Lead density and motivation score by zip code. Red = highest opportunity.
      </p>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Leads', value: totals.total, color: '#fff' },
          { label: '🔴 Hot Zip Codes', value: totals.red, color: '#EF4444' },
          { label: '🟡 Warm Zip Codes', value: totals.yellow, color: '#F59E0B' },
          { label: 'Zip Codes Tracked', value: heatmap.length, color: 'rgba(255,255,255,0.55)' },
        ].map(item => (
          <div key={item.label} style={s.card}>
            <div style={{ fontSize: 26, fontWeight: 900, color: item.color, marginBottom: 2 }}>{item.value}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600, letterSpacing: '0.05em' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Top hot zips sidebar + grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20 }}>

        {/* Sidebar */}
        <div style={s.card}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#EF4444', marginBottom: 14 }}>Top Hot Zip Codes</div>
          {topZips.length === 0 ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>No hot zips yet.</div>
          ) : topZips.map((z, i) => (
            <div key={z.zip} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < topZips.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{z.zip}</span>
              <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 700 }}>{z.hot_leads} hot leads</span>
            </div>
          ))}
          <div style={{ marginTop: 20, padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>Legend</div>
            {Object.entries(HEAT_COLORS).map(([heat, cfg]) => (
              <div key={heat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: cfg.bg, border: `1px solid ${cfg.border}` }} />
                <span style={{ fontSize: 11, color: cfg.text }}>{cfg.label}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', marginLeft: 'auto' }}>
                  {heat === 'red' ? '≥65 avg' : heat === 'yellow' ? '40-64 avg' : '<40 avg'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['all', 'All'], ['red', '🔴 Hot'], ['yellow', '🟡 Warm'], ['grey', '⚪ Cool']].map(([val, label]) => (
                <button key={val} style={s.btn(filter === val)} onClick={() => setFilter(val)}>{label}</button>
              ))}
            </div>
            <select style={s.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="count">Sort by: Lead Count</option>
              <option value="avg_score">Sort by: Avg Score</option>
              <option value="hot_count">Sort by: Hot Leads</option>
            </select>
          </div>

          {loading && <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.45)' }}>Loading heat map…</div>}

          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.35)' }}>
              No leads with zip codes found. Add zip codes to your leads to enable the heat map.
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {filtered.map(z => {
                const cfg = HEAT_COLORS[z.heat] || HEAT_COLORS.grey
                return (
                  <div key={z.zip} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: cfg.text, marginBottom: 2 }}>{z.zip}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 6 }}>
                      {z.count} lead{z.count !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: 'rgba(255,255,255,0.45)' }}>Avg score</span>
                      <span style={{ fontWeight: 700, color: cfg.text }}>{z.avg_score}</span>
                    </div>
                    {z.hot_count > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
                        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Hot leads</span>
                        <span style={{ fontWeight: 700, color: '#EF4444' }}>{z.hot_count}</span>
                      </div>
                    )}
                    {z.avg_equity_pct > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
                        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Avg equity</span>
                        <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.70)' }}>{z.avg_equity_pct}%</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
