/**
 * Feature 14 — Driving for Dollars with Real Interactive Map
 * Uses Leaflet + OpenStreetMap (no API key required)
 * Click anywhere on the map to drop a pin and analyze the property
 */
import React, { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default icon URLs in Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const makeIcon = (color) => new L.DivIcon({
  html: `<div style="width:14px;height:14px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.45)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -10],
  className: '',
})

const PIN_COLORS = { vacant: '#EF4444', distressed: '#F59E0B', good: '#00C37A', unknown: '#94A3B8' }
const CONDITIONS = ['vacant', 'distressed', 'good', 'unknown']

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

// Reverse-geocode a lat/lng to a street address using Nominatim (free)
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const d = await r.json()
    return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

// Map click handler component
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) })
  return null
}

export default function DrivingForDollars() {
  const [sessions, setSessions]         = useState([])
  const [pins, setPins]                 = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [tab, setTab]                   = useState('map')
  const [loading, setLoading]           = useState(true)
  const [pendingPin, setPendingPin]     = useState(null) // {lat, lng, address}
  const [pinForm, setPinForm]           = useState({ condition: 'unknown', notes: '' })
  const [submitting, setSubmitting]     = useState(false)
  const [analyzing, setAnalyzing]       = useState(null)
  const [geocoding, setGeocoding]       = useState(false)
  const mapRef = useRef(null)

  // Default to user's rough location, fallback to US center
  const [mapCenter, setMapCenter] = useState([39.5, -98.35])
  const [mapZoom, setMapZoom]     = useState(4)

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(pos => {
      setMapCenter([pos.coords.latitude, pos.coords.longitude])
      setMapZoom(13)
    }, () => {})
    load()
  }, [])

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

  async function handleMapClick(latlng) {
    if (tab !== 'map') return
    setGeocoding(true)
    const address = await reverseGeocode(latlng.lat, latlng.lng)
    setPendingPin({ lat: latlng.lat, lng: latlng.lng, address })
    setGeocoding(false)
  }

  async function savePin() {
    if (!pendingPin) return
    setSubmitting(true)
    try {
      const body = {
        address: pendingPin.address,
        notes: pinForm.notes,
        condition: pinForm.condition,
        lat: pendingPin.lat,
        lng: pendingPin.lng,
        session_id: activeSession?.id || null,
      }
      const r = await fetch(`${API}/dfd/pin`, { method: 'POST', headers: authHeader(), body: JSON.stringify(body) })
      const d = await r.json()
      if (d.success) {
        setPendingPin(null)
        setPinForm({ condition: 'unknown', notes: '' })
        load()
        if (d.pin?.id) analyzePin(d.pin.id, body)
      }
    } catch {}
    setSubmitting(false)
  }

  async function analyzePin(pinId, form) {
    setAnalyzing(pinId)
    try {
      await fetch(`${API}/dfd/pin/${pinId}/analyze`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ address: form.address, condition: form.condition, notes: form.notes }),
      })
    } catch {}
    setAnalyzing(null)
    load()
  }

  async function startSession() {
    const area = prompt('Name this driving area (e.g. "East Side", "Downtown"):')
    if (area === null) return
    try {
      const r = await fetch(`${API}/dfd/session/start`, { method: 'POST', headers: authHeader(), body: JSON.stringify({ area_name: area || 'Unnamed' }) })
      const d = await r.json()
      if (d.success) { setActiveSession(d.session); load() }
    } catch {}
  }

  async function endSession() {
    if (!activeSession) return
    const miles = prompt('Miles driven (optional):')
    try {
      await fetch(`${API}/dfd/session/${activeSession.id}/end`, {
        method: 'PUT', headers: authHeader(),
        body: JSON.stringify({ miles_driven: parseFloat(miles) || 0 }),
      })
    } catch {}
    setActiveSession(null)
    load()
  }

  const s = {
    page:  { padding: '0', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif', height: '100%', display: 'flex', flexDirection: 'column' },
    card:  { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '16px' },
    tab:   (a) => ({ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
  }

  return (
    <div style={s.page}>
      {/* Header strip */}
      <div style={{ padding: '20px 28px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', margin: 0 }}>🚗 Driving for Dollars</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '2px 0 0' }}>Click anywhere on the map to pin a distressed property. AI analyzes each one instantly.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {activeSession && (
            <div style={{ padding: '6px 14px', background: 'rgba(0,195,122,0.12)', border: '1px solid rgba(0,195,122,0.3)', borderRadius: 8, fontSize: 12, color: '#00C37A', fontWeight: 700 }}>
              LIVE: {activeSession.area_name}
            </div>
          )}
          {!activeSession
            ? <button onClick={startSession} style={{ padding: '9px 18px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>▶ Start Session</button>
            : <button onClick={endSession}   style={{ padding: '9px 18px', background: '#EF4444', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>■ End Session</button>
          }
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: '10px 28px', display: 'flex', gap: 8, borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))' }}>
        {[['map','🗺 Live Map'],['sessions','📋 Sessions'],['pins','📌 All Pins']].map(([t,l]) =>
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>{l}</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: '32px' }}>
          {pins.length} properties pinned · {sessions.length} sessions
        </span>
      </div>

      {/* ── LIVE MAP TAB ── */}
      {tab === 'map' && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Map (takes most of the space) */}
          <div style={{ flex: 1, position: 'relative' }}>
            {geocoding && (
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontFamily: 'Inter,sans-serif' }}>
                Finding address…
              </div>
            )}
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              style={{ height: '100%', width: '100%' }}
              ref={mapRef}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
              />
              <MapClickHandler onMapClick={handleMapClick} />

              {/* Existing pins */}
              {pins.filter(p => p.lat && p.lng).map(pin => (
                <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={makeIcon(PIN_COLORS[pin.condition] || '#94A3B8')}>
                  <Popup>
                    <div style={{ fontFamily: 'Inter,sans-serif', minWidth: 200 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{pin.address}</div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 4, textTransform: 'capitalize' }}>Condition: {pin.condition}</div>
                      {pin.ai_analysis?.opportunity_score && (
                        <div style={{ fontSize: 11, color: '#00C37A', fontWeight: 700 }}>
                          AI Score: {pin.ai_analysis.opportunity_score}/100
                        </div>
                      )}
                      {pin.ai_analysis?.recommended_action && (
                        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{pin.ai_analysis.recommended_action}</div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* Pending (unsubmitted) pin */}
              {pendingPin && (
                <Marker position={[pendingPin.lat, pendingPin.lng]} icon={makeIcon('#C9A84C')}>
                  <Popup autoOpen>
                    <div style={{ fontFamily: 'Inter,sans-serif', fontSize: 12 }}>
                      <b>New pin</b><br />{pendingPin.address}
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>

          {/* Right sidebar — pin form or pin list */}
          <div style={{ width: 300, borderLeft: '1px solid var(--border, rgba(255,255,255,0.07))', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--app-bg, #060E1A)' }}>
            {/* Pending pin form */}
            {pendingPin ? (
              <div style={s.card}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#C9A84C', marginBottom: 10 }}>PIN PROPERTY</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 10, lineHeight: 1.5 }}>{pendingPin.address}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Condition</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {CONDITIONS.map(c => (
                    <button key={c} onClick={() => setPinForm(p => ({ ...p, condition: c }))}
                      style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${pinForm.condition === c ? PIN_COLORS[c] : 'rgba(255,255,255,0.10)'}`, background: pinForm.condition === c ? `${PIN_COLORS[c]}20` : 'transparent', color: pinForm.condition === c ? PIN_COLORS[c] : 'rgba(255,255,255,0.55)', fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700, textTransform: 'capitalize' }}>
                      {c}
                    </button>
                  ))}
                </div>
                <textarea
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '8px 12px', fontSize: 12, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box', height: 60, resize: 'none', marginBottom: 10 }}
                  placeholder="Notes (optional)..."
                  value={pinForm.notes}
                  onChange={e => setPinForm(p => ({ ...p, notes: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={savePin} disabled={submitting}
                    style={{ flex: 1, padding: '10px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                    {submitting ? 'Saving…' : '📍 Save + Analyze'}
                  </button>
                  <button onClick={() => setPendingPin(null)}
                    style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ ...s.card, textAlign: 'center', padding: '24px 16px' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Click the map</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', lineHeight: 1.5 }}>Tap any property on the map to drop a pin. The address auto-fills and AI analyzes it instantly.</div>
              </div>
            )}

            {/* Recent pins list */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginTop: 4 }}>RECENT PINS</div>
            {loading ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: 16 }}>Loading…</div>
            ) : pins.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: 16 }}>No pins yet. Click the map to start!</div>
            ) : pins.slice(0, 20).map(pin => (
              <div key={pin.id} style={{ ...s.card, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: PIN_COLORS[pin.condition] || '#94A3B8', flexShrink: 0, marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1, #fff)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.address}</div>
                    {pin.ai_analysis?.opportunity_score && (
                      <div style={{ fontSize: 11, color: '#00C37A', marginTop: 2 }}>Score: {pin.ai_analysis.opportunity_score}/100</div>
                    )}
                    {analyzing === pin.id && <div style={{ fontSize: 11, color: '#C9A84C', marginTop: 2 }}>AI analyzing…</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SESSIONS TAB ── */}
      {tab === 'sessions' && (
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {sessions.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              No sessions yet. Hit "Start Session" and go drive your neighborhood.
            </div>
          ) : sessions.map(sess => (
            <div key={sess.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{sess.area_name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    {new Date(sess.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{sess.pin_count || 0}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>PINS</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{sess.miles_driven || 0}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>MILES</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ALL PINS TAB ── */}
      {tab === 'pins' && (
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
          {pins.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.35)' }}>
              No properties pinned yet. Go to the map and start clicking!
            </div>
          ) : pins.map(pin => (
            <div key={pin.id} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: PIN_COLORS[pin.condition] || '#94A3B8', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{pin.address}</div>
                {pin.notes && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{pin.notes}</div>}
                {pin.ai_analysis?.reasoning && <div style={{ fontSize: 12, color: '#C9A84C', marginTop: 2 }}>{pin.ai_analysis.reasoning}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PIN_COLORS[pin.condition], textTransform: 'capitalize', background: `${PIN_COLORS[pin.condition]}20`, padding: '3px 10px', borderRadius: 6 }}>{pin.condition}</span>
                {pin.ai_analysis?.opportunity_score && (
                  <span style={{ fontSize: 11, color: '#00C37A', fontWeight: 700 }}>Score: {pin.ai_analysis.opportunity_score}/100</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
