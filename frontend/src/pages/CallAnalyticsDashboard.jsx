/**
 * Features 15 & 16 Silent Call Detection + Best Time to Call AI
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function CallAnalyticsDashboard() {
  const [bestTime, setBestTime]   = useState(null)
  const [silent, setSilent]       = useState(null)
  const [summary, setSummary]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('best-time')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/call-analytics/best-time`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/call-analytics/silent-calls`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/call-analytics/summary`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([bt, sc, sum]) => {
      setBestTime(bt)
      setSilent(sc)
      setSummary(sum.summary)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const s = {
    page:  { padding: '32px', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif' },
    card:  { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '20px' },
    tab:   (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
    stat:  { background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '16px', textAlign: 'center' },
  }

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>📊 Call Analytics</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Silent call detection + AI best time recommendations</p>
      </div>

      {/* Summary stats */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Calls', value: summary.total_calls, color: '#fff' },
            { label: 'Answered', value: summary.answered_calls, color: '#00C37A' },
            { label: 'Answer Rate', value: `${summary.answer_rate}%`, color: summary.answer_rate >= 40 ? '#00C37A' : '#EF4444' },
            { label: 'Silent Calls', value: summary.silent_calls, color: summary.silent_rate >= 20 ? '#EF4444' : '#C9A84C' },
            { label: 'Avg Duration', value: `${Math.floor((summary.avg_duration_sec||0)/60)}m ${(summary.avg_duration_sec||0)%60}s`, color: '#fff' },
          ].map(item => (
            <div key={item.label} style={s.card}>
              <div style={{ fontSize: 22, fontWeight: 900, color: item.color, marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'best-time')} onClick={() => setTab('best-time')}>⏰ Best Times</button>
        <button style={s.tab(tab === 'silent')}    onClick={() => setTab('silent')}>🔇 Silent Calls</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading analytics…</div>}

      {/* Best Time */}
      {!loading && tab === 'best-time' && bestTime && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {bestTime.ai_tip && (
            <div style={{ ...s.card, background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.25)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00C37A', marginBottom: 8 }}>AI TIP</div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', margin: 0 }}>{bestTime.ai_tip}</p>
            </div>
          )}

          {/* Top Windows */}
          {bestTime.top_windows?.length > 0 && (
            <div style={s.card}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>TOP CALLING WINDOWS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bestTime.top_windows.map((w, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: i === 0 ? '#C9A84C' : 'rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, color: i === 0 ? '#000' : '#fff', flexShrink: 0 }}>#{i+1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>{w.label}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{w.total_calls} calls · {w.answered} answered · avg {Math.floor(w.avg_duration/60)}m {w.avg_duration%60}s</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: (w.answer_rate||0) >= 50 ? '#00C37A' : '#C9A84C' }}>{w.answer_rate}%</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>answer rate</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Day breakdown */}
          {bestTime.day_breakdown?.length > 0 && (
            <div style={s.card}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>ANSWER RATE BY DAY</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 }}>
                {bestTime.day_breakdown.map(d => (
                  <div key={d.day} style={{ textAlign: 'center', padding: '12px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 4 }}>{d.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: d.answer_rate >= 50 ? '#00C37A' : d.answer_rate >= 30 ? '#C9A84C' : 'rgba(255,255,255,0.45)' }}>
                      {d.answer_rate != null ? `${d.answer_rate}%` : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{d.total} calls</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!bestTime.top_windows || bestTime.top_windows.length === 0) && (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏰</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Not enough data yet</div>
              <div style={{ fontSize: 13 }}>Make more calls to unlock AI time recommendations.</div>
            </div>
          )}
        </div>
      )}

      {/* Silent Calls */}
      {!loading && tab === 'silent' && silent && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[
              { label: 'Silent Calls', value: silent.total, color: silent.total > 10 ? '#EF4444' : '#C9A84C' },
              { label: 'Avg Silence', value: `${silent.avg_silence_sec}s`, color: '#fff' },
              { label: 'Assessment', value: silent.total > 10 ? '🚨 High' : '✅ OK', color: silent.total > 10 ? '#EF4444' : '#00C37A' },
            ].map(item => (
              <div key={item.label} style={s.card}>
                <div style={{ fontSize: 22, fontWeight: 900, color: item.color, marginBottom: 2 }}>{item.value}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{item.label}</div>
              </div>
            ))}
          </div>
          {silent.recommendation && (
            <div style={{ ...s.card, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)' }}>
              <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>{silent.recommendation}</p>
            </div>
          )}
          {silent.silent_calls?.length > 0 ? (
            <div style={s.card}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>RECENT SILENT CALLS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {silent.silent_calls.slice(0, 20).map((sc, i) => (
                  <div key={sc.id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: 13 }}>{sc.leads?.first_name} {sc.leads?.last_name} {sc.leads?.phone}</div>
                    <div style={{ fontSize: 12, color: '#EF4444' }}>{sc.silence_sec}s silent</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No silent calls detected. Great news!</div>
          )}
        </div>
      )}
    </div>
  )
}
