/**
 * Feature 14 Driving for Dollars Mobile AI Mode
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const CONDITION_COLORS = { vacant: '#EF4444', distressed: '#F59E0B', good: '#00C37A', unknown: 'rgba(255,255,255,0.35)' }
const CONDITIONS = ['vacant','distressed','good','unknown']

export default function DrivingForDollars() {
  const [sessions, setSessions]         = useState([])
  const [pins, setPins]                 = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [tab, setTab]                   = useState('map') // map|sessions|pins
  const [loading, setLoading]           = useState(true)
  const [pinForm, setPinForm]           = useState({ address: '', notes: '', condition: 'unknown' })
  const [submitting, setSubmitting]     = useState(false)
  const [analyzing, setAnalyzing]       = useState(null)

  function load() {
    setLoading(true)
    Promise.all([
      fetch(`${API}/dfd/sessions`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/dfd/pins`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([sess, pinsData]) => {
      setSessions(sess.sessions || [])
      setPins(pinsData.pins || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function startSession() {
    const area = prompt('Name this driving area (e.g. "East Side", "Downtown"):')
    if (area === null) return
    const r = await fetch(`${API}/dfd/session/start`, { method: 'POST', headers: authHeader(), body: JSON.stringify({ area_name: area || 'Unnamed' }) })
    const d = await r.json()
    if (d.success) { setActiveSession(d.session); load() }
  }

  async function endSession() {
    if (!activeSession) return
    const miles = prompt('Miles driven (optional):')
    await fetch(`${API}/dfd/session/${activeSession.id}/end`, {
      method: 'PUT', headers: authHeader(),
      body: JSON.stringify({ miles_driven: parseFloat(miles) || 0 }),
    })
    setActiveSession(null)
    load()
  }

  async function addPin() {
    if (!pinForm.address) return alert('Enter address')
    setSubmitting(true)
    // Try to get GPS
    let lat = null, lng = null
    try {
      await new Promise((res, rej) => navigator.geolocation?.getCurrentPosition(pos => { lat = pos.coords.latitude; lng = pos.coords.longitude; res() }, rej, { timeout: 3000 }))
    } catch {}

    const body = { ...pinForm, lat: lat || 0, lng: lng || 0, session_id: activeSession?.id || null }
    const r = await fetch(`${API}/dfd/pin`, { method: 'POST', headers: authHeader(), body: JSON.stringify(body) })
    const d = await r.json()
    if (d.success) {
      setPinForm({ address: '', notes: '', condition: 'unknown' })
      load()
      // Auto-analyze
      if (d.pin?.id) analyzePin(d.pin.id, pinForm)
    }
    setSubmitting(false)
  }

  async function analyzePin(pinId, form) {
    setAnalyzing(pinId)
    await fetch(`${API}/dfd/pin/${pinId}/analyze`, {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ address: form.address, condition: form.condition, notes: form.notes }),
    })
    setAnalyzing(null)
    load()
  }

  const s = {
    page:  { padding: '32px', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif' },
    card:  { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
    tab:   (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
    btn:   (color='#00C37A') => ({ padding: '10px 22px', background: color, color: color === '#00C37A' ? '#000' : '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }),
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🚗 Driving for Dollars</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Pin distressed properties while driving. AI analyzes each one instantly.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!activeSession
            ? <button onClick={startSession} style={s.btn()}>▶ Start Session</button>
            : <button onClick={endSession}   style={s.btn('#EF4444')}>■ End Session</button>
          }
        </div>
      </div>

      {activeSession && (
        <div style={{ ...s.card, marginBottom: 20, background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.25)' }}>
          <div style={{ fontSize: 12, color: '#00C37A', fontWeight: 700, marginBottom: 4 }}>ACTIVE SESSION</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{activeSession.area_name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Started {new Date(activeSession.started_at).toLocaleTimeString()}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['map','sessions','pins'].map(t => <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>{t === 'map' ? '📍 Add Pin' : t === 'sessions' ? '📋 Sessions' : '📌 All Pins'}</button>)}
      </div>

      {tab === 'map' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#00C37A' }}>PIN A PROPERTY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input style={s.input} placeholder="Property address" value={pinForm.address} onChange={e => setPinForm(p => ({ ...p, address: e.target.value }))} />
              <textarea style={{ ...s.input, height: 60, resize: 'vertical' }} placeholder="Notes (optional)" value={pinForm.notes} onChange={e => setPinForm(p => ({ ...p, notes: e.target.value }))} />
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>Property Condition</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {CONDITIONS.map(c => (
                    <button key={c} onClick={() => setPinForm(p => ({ ...p, condition: c }))}
                      style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${pinForm.condition === c ? CONDITION_COLORS[c] : 'rgba(255,255,255,0.10)'}`, background: pinForm.condition === c ? `${CONDITION_COLORS[c]}20` : 'transparent', color: pinForm.condition === c ? CONDITION_COLORS[c] : 'rgba(255,255,255,0.55)', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700, textTransform: 'capitalize' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={addPin} disabled={submitting}
                style={{ padding: '12px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif', opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Adding…' : '📍 Add Pin + AI Analyze'}
              </button>
            </div>
          </div>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: 'rgba(255,255,255,0.45)' }}>RECENT PINS</div>
            {pins.slice(0, 8).map(pin => (
              <div key={pin.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: CONDITION_COLORS[pin.condition] || '#fff', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{pin.address || 'No address'}</div>
                  {pin.ai_analysis?.opportunity_score && (
                    <div style={{ fontSize: 11, color: '#00C37A' }}>Score: {pin.ai_analysis.opportunity_score}/100 {pin.ai_analysis.recommended_action}</div>
                  )}
                </div>
                {analyzing === pin.id && <span style={{ fontSize: 11, color: '#C9A84C' }}>Analyzing…</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map(sess => (
            <div key={sess.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{sess.area_name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{new Date(sess.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 900 }}>{sess.pin_count}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Pins</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 900 }}>{sess.miles_driven || 0}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Miles</div></div>
                </div>
              </div>
            </div>
          ))}
          {sessions.length === 0 && <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No sessions yet. Start your first drive!</div>}
        </div>
      )}

      {tab === 'pins' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pins.map(pin => (
            <div key={pin.id} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: CONDITION_COLORS[pin.condition] || '#fff', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{pin.address || 'No address'}</div>
                {pin.notes && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{pin.notes}</div>}
                {pin.ai_analysis?.reasoning && <div style={{ fontSize: 12, color: '#C9A84C', marginTop: 4 }}>{pin.ai_analysis.reasoning}</div>}
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: CONDITION_COLORS[pin.condition], textTransform: 'capitalize', background: `${CONDITION_COLORS[pin.condition]}20`, padding: '3px 10px', borderRadius: 6 }}>{pin.condition}</span>
              </div>
            </div>
          ))}
          {pins.length === 0 && <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>No pins yet. Start driving and add properties!</div>}
        </div>
      )}
    </div>
  )
}
