/**
 * Feature 27 — Virtual Driving for Dollars
 * Google Maps + Street View virtual neighborhood walk
 * Requires: VITE_GOOGLE_MAPS_API_KEY in Vercel environment variables
 *
 * Flow:
 *   1. Search a city/zip → map appears, user picks start point
 *   2. Street View loads full-screen → user navigates street by street
 *   3. Spot a distressed property → click "Add Lead"
 *   4. AI calls owner within 60 seconds automatically
 *   5. Session summary shows all pins + motivation scores
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'

function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const DISTRESS_TAGS = [
  { id: 'overgrown',  label: 'Overgrown Lawn',     icon: '🌿' },
  { id: 'peeling',    label: 'Peeling Paint',       icon: '🎨' },
  { id: 'windows',    label: 'Broken Windows',      icon: '🪟' },
  { id: 'tarp',       label: 'Tarp on Roof',        icon: '🏚' },
  { id: 'boarded',    label: 'Boarded Up',          icon: '🚪' },
  { id: 'vehicle',    label: 'Abandoned Vehicle',   icon: '🚗' },
  { id: 'mailbox',    label: 'Stuffed Mailbox',     icon: '📬' },
]

// ── Load Google Maps script once ─────────────────────────────────────────────
let mapsPromise = null
function loadGoogleMaps(key) {
  if (!key) return Promise.reject(new Error('NO_KEY'))
  if (window.google?.maps) return Promise.resolve()
  if (mapsPromise) return mapsPromise
  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,drawing,geometry`
    script.async = true
    script.onload  = resolve
    script.onerror = () => reject(new Error('LOAD_FAILED'))
    document.head.appendChild(script)
  })
  return mapsPromise
}

// ── Setup screen shown when no API key configured ────────────────────────────
function SetupScreen() {
  return (
    <div style={{ padding: 48, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>🗺</div>
      <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 8, color: 'var(--t1,#fff)' }}>
        Google Maps API Key Required
      </h2>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, marginBottom: 28 }}>
        Virtual Driving for Dollars uses Google Maps + Street View to let you virtually drive any neighborhood.
        Add your Google Maps API key to Vercel environment variables to activate it.
      </p>
      <div style={{ background: 'var(--card-bg,#0A1526)', border: '1px solid var(--border,rgba(255,255,255,0.07))', borderRadius: 14, padding: 24, textAlign: 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: '#C9A84C', marginBottom: 14 }}>SETUP STEPS</div>
        {[
          { n: 1, text: 'Go to console.cloud.google.com and create a project' },
          { n: 2, text: 'Enable: Maps JavaScript API, Street View API, Places API, Geocoding API, Drawing Library' },
          { n: 3, text: 'Create an API key under Credentials' },
          { n: 4, text: 'In Vercel dashboard → your project → Settings → Environment Variables' },
          { n: 5, text: 'Add: VITE_GOOGLE_MAPS_API_KEY = your_key_here' },
          { n: 6, text: 'Redeploy — Virtual DFD will be fully active' },
        ].map(({ n, text }) => (
          <div key={n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#C9A84C', color: '#000', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</div>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.25)', borderRadius: 10, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
        While you set up the API key, use the regular <strong style={{ color: '#00C37A' }}>Driving for Dollars</strong> page which uses OpenStreetMap (no key needed).
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VirtualDFD() {
  const [mode, setMode]               = useState('area')  // area | driving | summary
  const [mapsReady, setMapsReady]     = useState(false)
  const [mapsError, setMapsError]     = useState(null)
  const [searchInput, setSearchInput] = useState('')
  const [currentAddress, setCurrentAddress] = useState('')
  const [currentLatLng, setCurrentLatLng]   = useState(null)
  const [activeSession, setActiveSession]   = useState(null)
  const [sessionLeads, setSessionLeads]     = useState([])
  const [addingLead, setAddingLead]         = useState(false)
  const [leadForm, setLeadForm]             = useState({ tags: [], notes: '', condition: 'distressed' })
  const [showLeadPanel, setShowLeadPanel]   = useState(false)
  const [analyzing, setAnalyzing]           = useState(false)
  const [streetCount, setStreetCount]       = useState(0)
  const [summaryData, setSummaryData]       = useState(null)

  const mapRef   = useRef(null)   // div for area-select map
  const svRef    = useRef(null)   // div for street view
  const gMapRef  = useRef(null)   // google.maps.Map instance
  const gSvRef   = useRef(null)   // google.maps.StreetViewPanorama instance
  const geocoderRef = useRef(null)

  // Load Google Maps
  useEffect(() => {
    if (!GMAPS_KEY) return
    loadGoogleMaps(GMAPS_KEY)
      .then(() => { setMapsReady(true); geocoderRef.current = new window.google.maps.Geocoder() })
      .catch(e => setMapsError(e.message))
  }, [])

  // Init area-select map once Maps ready + in area mode
  useEffect(() => {
    if (!mapsReady || mode !== 'area' || !mapRef.current) return
    gMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 39.5, lng: -98.35 },
      zoom: 4,
      mapTypeId: 'roadmap',
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
    })
    // Search box
    const input = document.getElementById('vdfd-search')
    if (input) {
      const autocomplete = new window.google.maps.places.Autocomplete(input)
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (place.geometry?.location) {
          gMapRef.current.setCenter(place.geometry.location)
          gMapRef.current.setZoom(15)
        }
      })
    }
    // Click on map to start drive from that point
    gMapRef.current.addListener('click', (e) => {
      startDriving(e.latLng.lat(), e.latLng.lng())
    })
  }, [mapsReady, mode])

  // Init Street View when entering driving mode
  useEffect(() => {
    if (!mapsReady || mode !== 'driving' || !svRef.current || !currentLatLng) return
    gSvRef.current = new window.google.maps.StreetViewPanorama(svRef.current, {
      position: { lat: currentLatLng.lat, lng: currentLatLng.lng },
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      addressControl: true,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      enableCloseButton: false,
    })
    // Update address on position change
    gSvRef.current.addListener('position_changed', () => {
      const pos = gSvRef.current.getPosition()
      if (!pos) return
      setStreetCount(n => n + 1)
      geocoderRef.current?.geocode({ location: { lat: pos.lat(), lng: pos.lng() } }, (results, status) => {
        if (status === 'OK' && results[0]) {
          setCurrentAddress(results[0].formatted_address)
          setCurrentLatLng({ lat: pos.lat(), lng: pos.lng() })
        }
      })
    })
  }, [mapsReady, mode, currentLatLng?.lat])

  // ── Handlers ─────────────────────────────────────────────────────────────
  async function startDriving(lat, lng) {
    // Geocode to get address first
    let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    try {
      await new Promise(res => {
        geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === 'OK' && results[0]) address = results[0].formatted_address
          res()
        })
      })
    } catch {}

    // Start backend session
    try {
      const r = await fetch(`${API}/dfd/session/start`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ area_name: address.split(',')[0] || 'Virtual Drive' }),
      })
      const d = await r.json()
      if (d.success) setActiveSession(d.session)
    } catch {}

    setCurrentLatLng({ lat, lng })
    setCurrentAddress(address)
    setMode('driving')
  }

  async function searchAndDrive() {
    if (!searchInput.trim()) return
    geocoderRef.current?.geocode({ address: searchInput }, (results, status) => {
      if (status === 'OK' && results[0]?.geometry) {
        const loc = results[0].geometry.location
        startDriving(loc.lat(), loc.lng())
      } else {
        alert('Location not found. Try a city name or zip code.')
      }
    })
  }

  async function addLead() {
    if (!currentLatLng || !currentAddress) return
    setAddingLead(true)
    try {
      const body = {
        address:    currentAddress,
        lat:        currentLatLng.lat,
        lng:        currentLatLng.lng,
        condition:  leadForm.condition,
        notes:      leadForm.notes + (leadForm.tags.length ? ` | Tags: ${leadForm.tags.join(', ')}` : ''),
        session_id: activeSession?.id || null,
      }
      const r = await fetch(`${API}/dfd/pin`, { method: 'POST', headers: authHeader(), body: JSON.stringify(body) })
      const d = await r.json()
      if (d.success) {
        const newLead = { ...d.pin, address: currentAddress, tags: [...leadForm.tags], status: 'added' }
        setSessionLeads(prev => [newLead, ...prev])
        setLeadForm({ tags: [], notes: '', condition: 'distressed' })
        setShowLeadPanel(false)
        // Trigger AI analysis
        if (d.pin?.id) triggerAnalysis(d.pin.id, body)
      }
    } catch { alert('Failed to add lead') }
    setAddingLead(false)
  }

  async function triggerAnalysis(pinId, form) {
    setAnalyzing(true)
    try {
      await fetch(`${API}/dfd/pin/${pinId}/analyze`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ address: form.address, condition: form.condition, notes: form.notes }),
      })
      // Update lead status in list
      setSessionLeads(prev => prev.map(l => l.id === pinId ? { ...l, status: 'analyzed' } : l))
    } catch {}
    setAnalyzing(false)
  }

  async function endSession() {
    if (activeSession) {
      try {
        await fetch(`${API}/dfd/session/${activeSession.id}/end`, {
          method: 'PUT', headers: authHeader(),
          body: JSON.stringify({ miles_driven: 0 }),
        })
      } catch {}
    }
    setSummaryData({
      area:        activeSession?.area_name || 'Virtual Drive',
      leads:       sessionLeads.length,
      streets:     streetCount,
      analyzed:    sessionLeads.filter(l => l.status === 'analyzed').length,
    })
    setMode('summary')
  }

  const toggleTag = (id) => setLeadForm(p => ({
    ...p,
    tags: p.tags.includes(id) ? p.tags.filter(t => t !== id) : [...p.tags, id]
  }))

  // ── Render: No API key ────────────────────────────────────────────────────
  if (!GMAPS_KEY) return (
    <div style={{ padding: '32px', color: 'var(--t1,#fff)', fontFamily: 'Inter,sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🗺 Virtual DFD</h1>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '0 0 28px' }}>Drive any neighborhood virtually using Google Street View</p>
      <SetupScreen />
    </div>
  )

  if (mapsError) return (
    <div style={{ padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div>Failed to load Google Maps. Check your API key and billing settings.</div>
      <div style={{ fontSize: 12, marginTop: 8, color: 'rgba(255,255,255,0.35)' }}>{mapsError}</div>
    </div>
  )

  // ── Render: Summary ───────────────────────────────────────────────────────
  if (mode === 'summary' && summaryData) {
    return (
      <div style={{ padding: '32px', color: 'var(--t1,#fff)', fontFamily: 'Inter,sans-serif', maxWidth: 720 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>✅ Session Complete</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>{summaryData.area}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Streets Covered', value: summaryData.streets, color: '#fff' },
            { label: 'Leads Added',     value: summaryData.leads,   color: '#00C37A' },
            { label: 'AI Analyzed',     value: summaryData.analyzed,color: '#C9A84C' },
            { label: 'Calls Queued',    value: summaryData.leads,   color: '#8B5CF6' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--card-bg,#0A1526)', border: '1px solid var(--border,rgba(255,255,255,0.07))', borderRadius: 14, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: item.color }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--card-bg,#0A1526)', border: '1px solid var(--border,rgba(255,255,255,0.07))', borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>LEADS FOUND</div>
          {sessionLeads.length === 0
            ? <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>No leads added this session.</div>
            : sessionLeads.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.status === 'analyzed' ? '#00C37A' : '#C9A84C', flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13 }}>{l.address}</div>
                <span style={{ fontSize: 11, color: l.status === 'analyzed' ? '#00C37A' : '#C9A84C' }}>
                  {l.status === 'analyzed' ? 'AI Analyzed' : 'Added'}
                </span>
              </div>
            ))
          }
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => { setMode('area'); setSessionLeads([]); setStreetCount(0); setActiveSession(null) }}
            style={{ padding: '12px 24px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
            Start New Drive
          </button>
          <a href="/leads" style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            View Leads in CRM
          </a>
        </div>
      </div>
    )
  }

  // ── Render: Area Selection ────────────────────────────────────────────────
  if (mode === 'area') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--t1,#fff)', fontFamily: 'Inter,sans-serif' }}>
        {/* Header */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border,rgba(255,255,255,0.07))', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>🗺 Virtual Driving for Dollars</h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '2px 0 0' }}>Search any city or zip code, then click any street on the map to start your virtual drive</p>
          </div>
        </div>

        {/* Search bar */}
        <div style={{ padding: '14px 28px', background: 'var(--card-bg,#0A1526)', borderBottom: '1px solid var(--border,rgba(255,255,255,0.07))', display: 'flex', gap: 10 }}>
          <input
            id="vdfd-search"
            type="text"
            placeholder="Search city, neighborhood, or zip code (e.g. 'Atlanta, GA' or '30301')"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchAndDrive()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '10px 14px', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none' }}
          />
          <button onClick={searchAndDrive}
            style={{ padding: '10px 22px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif', whiteSpace: 'nowrap' }}>
            Search
          </button>
        </div>

        {/* Instructions overlay when map not loaded yet */}
        {!mapsReady && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
            Loading Google Maps…
          </div>
        )}

        {/* Map */}
        <div ref={mapRef} style={{ flex: 1, display: mapsReady ? 'block' : 'none' }} />

        {mapsReady && (
          <div style={{ padding: '10px 28px', background: 'var(--card-bg,#0A1526)', borderTop: '1px solid var(--border,rgba(255,255,255,0.07))', fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
            Click any location on the map to drop into Street View and start driving
          </div>
        )}
      </div>
    )
  }

  // ── Render: Street View Driving ───────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter,sans-serif', color: 'var(--t1,#fff)', overflow: 'hidden', position: 'relative' }}>
      {/* Street View — full area minus sidebar */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={svRef} style={{ width: '100%', height: '100%' }} />

        {/* Top HUD */}
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', gap: 10, alignItems: 'flex-start', pointerEvents: 'none', zIndex: 10 }}>
          {/* Address chip */}
          <div style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 600, maxWidth: 400 }}>
            📍 {currentAddress || 'Loading address…'}
          </div>
          {/* Stats */}
          <div style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 14px', fontSize: 12, display: 'flex', gap: 16 }}>
            <span>🛣 {streetCount} moves</span>
            <span style={{ color: '#00C37A' }}>📍 {sessionLeads.length} leads</span>
          </div>
        </div>

        {/* Bottom action buttons */}
        <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 10 }}>
          <button onClick={() => setShowLeadPanel(true)}
            style={{ padding: '12px 28px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: 'Inter,sans-serif', boxShadow: '0 4px 24px rgba(0,195,122,0.40)' }}>
            📍 Add Lead
          </button>
          <button onClick={endSession}
            style={{ padding: '12px 22px', background: 'rgba(0,0,0,0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.20)', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif', backdropFilter: 'blur(8px)' }}>
            End Session
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <div style={{ width: 280, borderLeft: '1px solid var(--border,rgba(255,255,255,0.07))', background: 'var(--app-bg,#060E1A)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Session info */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border,rgba(255,255,255,0.07))' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#00C37A', marginBottom: 4 }}>ACTIVE SESSION</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{activeSession?.area_name || 'Virtual Drive'}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>AI calls owners automatically</div>
        </div>

        {/* How it works */}
        <div style={{ padding: '14px 16px', background: 'rgba(201,168,76,0.06)', borderBottom: '1px solid rgba(201,168,76,0.15)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', marginBottom: 6 }}>HOW IT WORKS</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            Navigate the street using the arrows in Street View. When you spot a distressed property, click <strong style={{ color: '#00C37A' }}>Add Lead</strong>. The AI calls the owner within 60 seconds automatically.
          </div>
        </div>

        {/* Recent leads */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 10 }}>LEADS THIS SESSION</div>
          {sessionLeads.length === 0 ? (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '20px 0' }}>None yet. Start adding properties.</div>
          ) : sessionLeads.map((l, i) => (
            <div key={i} style={{ background: 'var(--card-bg,#0A1526)', border: '1px solid var(--border,rgba(255,255,255,0.07))', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t1,#fff)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.address}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {l.tags?.map(t => {
                  const tag = DISTRESS_TAGS.find(dt => dt.id === t)
                  return tag ? <span key={t} style={{ fontSize: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px' }}>{tag.icon}</span> : null
                })}
                <span style={{ fontSize: 10, color: l.status === 'analyzed' ? '#00C37A' : '#C9A84C', marginLeft: 'auto' }}>
                  {l.status === 'analyzed' ? '✓ Analyzed' : '⏳ Added'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Lead Modal */}
      {showLeadPanel && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.60)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--card-bg,#0A1526)', border: '1px solid var(--border,rgba(255,255,255,0.07))', borderRadius: 16, padding: 24, width: 400, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>📍 Add Lead</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 16 }}>{currentAddress}</div>

            {/* Condition */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Property Condition</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {['vacant','distressed','unknown'].map(c => (
                <button key={c} onClick={() => setLeadForm(p => ({ ...p, condition: c }))}
                  style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${leadForm.condition === c ? '#00C37A' : 'rgba(255,255,255,0.10)'}`, background: leadForm.condition === c ? 'rgba(0,195,122,0.15)' : 'transparent', color: leadForm.condition === c ? '#00C37A' : 'rgba(255,255,255,0.55)', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600, textTransform: 'capitalize' }}>
                  {c}
                </button>
              ))}
            </div>

            {/* Distress Tags */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Distress Tags</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
              {DISTRESS_TAGS.map(tag => (
                <button key={tag.id} onClick={() => toggleTag(tag.id)}
                  style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${leadForm.tags.includes(tag.id) ? '#C9A84C' : 'rgba(255,255,255,0.08)'}`, background: leadForm.tags.includes(tag.id) ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)', color: leadForm.tags.includes(tag.id) ? '#C9A84C' : 'rgba(255,255,255,0.55)', fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif', textAlign: 'left' }}>
                  {tag.icon} {tag.label}
                </button>
              ))}
            </div>

            {/* Notes */}
            <textarea
              placeholder="Additional notes..."
              value={leadForm.notes}
              onChange={e => setLeadForm(p => ({ ...p, notes: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 12px', fontSize: 12, fontFamily: 'Inter,sans-serif', outline: 'none', height: 60, resize: 'none', marginBottom: 14 }}
            />

            <div style={{ fontSize: 11, color: 'rgba(0,195,122,0.70)', background: 'rgba(0,195,122,0.07)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
              ⚡ AI will call the owner within 60 seconds of saving
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={addLead} disabled={addingLead}
                style={{ flex: 1, padding: '12px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                {addingLead ? 'Saving…' : 'Save Lead + Call Owner'}
              </button>
              <button onClick={() => setShowLeadPanel(false)}
                style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
