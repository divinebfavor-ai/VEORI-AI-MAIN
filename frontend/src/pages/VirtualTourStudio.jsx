/**
 * Features 34-38 — 3D Virtual Tour Engine
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
const FRONTEND = import.meta.env.VITE_FRONTEND_URL || 'https://veori.net'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const TOUR_TYPES = [
  { id: 'slideshow', label: '🖼 Photo Slideshow', description: 'Smooth photo tour — no API key needed' },
  { id: '360',       label: '🔄 360° Tour',       description: 'Powered by Trolto API (key required)' },
  { id: 'kuula',     label: '🌐 Kuula Tour',      description: 'Professional 360° walkthrough' },
]

export default function VirtualTourStudio() {
  const [tours, setTours]       = useState([])
  const [listings, setListings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('tours')
  const [form, setForm]         = useState({ listing_id: '', title: '', tour_type: 'slideshow', photos: '' })
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState(null)
  const [analytics, setAnalytics] = useState(null)

  function load() {
    setLoading(true)
    Promise.all([
      fetch(`${API}/tours`, { headers: authHeader() }).then(r => r.json()),
      fetch(`${API}/listings`, { headers: authHeader() }).then(r => r.json()),
    ]).then(([t, l]) => {
      setTours(t.tours || [])
      setListings(l.listings || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function createTour() {
    if (!form.photos) return alert('Enter at least one photo URL')
    const photos = form.photos.split('\n').map(s => s.trim()).filter(Boolean)
    if (photos.length === 0) return alert('No valid photo URLs')

    setCreating(true)
    try {
      const r = await fetch(`${API}/tours`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({
          listing_id: form.listing_id || null,
          title:      form.title || 'Property Tour',
          tour_type:  form.tour_type,
          photos,
        }),
      })
      const d = await r.json()
      if (d.success) {
        setTours(prev => [d.tour, ...prev])
        setForm({ listing_id: '', title: '', tour_type: 'slideshow', photos: '' })
        setTab('tours')
        alert(`Tour created! Public URL: ${d.public_url}`)
      } else alert(d.error)
    } catch { alert('Network error') }
    setCreating(false)
  }

  async function loadAnalytics(tourId) {
    try {
      const r = await fetch(`${API}/tours/${tourId}/analytics`, { headers: authHeader() })
      const d = await r.json()
      if (d.success) setAnalytics({ ...d.analytics, tourId })
    } catch {}
  }

  async function deleteTour(id) {
    if (!confirm('Delete this tour?')) return
    await fetch(`${API}/tours/${id}`, { method: 'DELETE', headers: authHeader() })
    setTours(prev => prev.filter(t => t.id !== id))
  }

  const s = {
    page:  { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    card:  { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
    tab:   (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🏛 Virtual Tour Studio</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Create public 360° tours from property photos — share links with buyers</p>
        </div>
        <button onClick={() => setTab('create')} style={{ padding: '10px 22px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>+ Create Tour</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'tours')}   onClick={() => setTab('tours')}>🎥 All Tours</button>
        <button style={s.tab(tab === 'create')}  onClick={() => setTab('create')}>➕ Create</button>
        {analytics && <button style={s.tab(tab === 'analytics')} onClick={() => setTab('analytics')}>📊 Analytics</button>}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading tours…</div>}

      {/* Tours list */}
      {!loading && tab === 'tours' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tours.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🏛</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No virtual tours yet</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 }}>Create your first tour to impress buyers with immersive property walkthroughs</div>
              <button onClick={() => setTab('create')} style={{ padding: '10px 24px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Create First Tour</button>
            </div>
          ) : tours.map(tour => {
            const publicUrl = `${FRONTEND}/tour/${tour.tour_token}`
            return (
              <div key={tour.id} style={s.card}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ width: 60, height: 60, borderRadius: 10, background: 'rgba(255,255,255,0.05)', flexShrink: 0, overflow: 'hidden' }}>
                    {tour.photos?.[0] && <img src={tour.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 800 }}>{tour.title}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: tour.status === 'ready' ? '#00C37A' : '#C9A84C', background: tour.status === 'ready' ? 'rgba(0,195,122,0.15)' : 'rgba(201,168,76,0.15)', padding: '2px 8px', borderRadius: 4, textTransform: 'capitalize' }}>{tour.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
                      {tour.photos?.length || 0} photos · {tour.tour_type} · {tour.listings?.address || 'No listing linked'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#00C37A', textDecoration: 'none', fontWeight: 600 }}>
                        🔗 View Public Tour
                      </a>
                      <button onClick={() => navigator.clipboard.writeText(publicUrl)}
                        style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                        📋 Copy Link
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button onClick={() => { loadAnalytics(tour.id); setTab('analytics') }}
                      style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>
                      📊 Analytics
                    </button>
                    <button onClick={() => deleteTour(tour.id)}
                      style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 700 }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create */}
      {!loading && tab === 'create' && (
        <div style={{ maxWidth: 560 }}>
          <div style={s.card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: '#00C37A' }}>CREATE VIRTUAL TOUR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Link to Listing (optional)</label>
                <select style={{ ...s.input, background: '#0A1526' }} value={form.listing_id} onChange={e => {
                  const l = listings.find(l => l.id === e.target.value)
                  setForm(p => ({ ...p, listing_id: e.target.value, title: l ? `${l.address} Tour` : p.title }))
                }}>
                  <option value="">— No listing —</option>
                  {listings.map(l => <option key={l.id} value={l.id}>{l.title} — {l.address}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Tour Title</label>
                <input style={s.input} placeholder="123 Main St Virtual Tour" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 8 }}>Tour Type</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {TOUR_TYPES.map(t => (
                    <button key={t.id} onClick={() => setForm(p => ({ ...p, tour_type: t.id }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${form.tour_type === t.id ? '#00C37A' : 'rgba(255,255,255,0.10)'}`, background: form.tour_type === t.id ? 'rgba(0,195,122,0.10)' : 'rgba(255,255,255,0.03)', cursor: 'pointer', textAlign: 'left', fontFamily: 'Inter,sans-serif' }}>
                      <span style={{ fontSize: 20 }}>{t.label.split(' ')[0]}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: form.tour_type === t.id ? '#00C37A' : '#fff' }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{t.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Photo URLs (one per line) *</label>
                <textarea style={{ ...s.input, height: 100, resize: 'vertical' }}
                  placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg&#10;https://example.com/photo3.jpg"
                  value={form.photos}
                  onChange={e => setForm(p => ({ ...p, photos: e.target.value }))}
                />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>Enter property photo URLs from your Deal Photo Gallery or any public image URL</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={createTour} disabled={creating}
                  style={{ flex: 1, padding: '13px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                  {creating ? 'Creating…' : '🏛 Create Virtual Tour'}
                </button>
                <button onClick={() => setTab('tours')} style={{ padding: '13px 20px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analytics */}
      {tab === 'analytics' && analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {[
            { label: 'Total Views', value: analytics.total_views, color: '#fff' },
            { label: 'Avg Duration', value: `${Math.floor((analytics.avg_duration_sec||0)/60)}m ${(analytics.avg_duration_sec||0)%60}s`, color: '#C9A84C' },
            { label: 'Sources', value: Object.keys(analytics.by_source).length, color: '#00C37A' },
          ].map(item => (
            <div key={item.label} style={s.card}>
              <div style={{ fontSize: 28, fontWeight: 900, color: item.color, marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>{item.label}</div>
            </div>
          ))}
          {Object.entries(analytics.by_source).length > 0 && (
            <div style={{ ...s.card, gridColumn: '1/-1' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>TRAFFIC SOURCES</div>
              {Object.entries(analytics.by_source).map(([src, count]) => (
                <div key={src} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ textTransform: 'capitalize', color: 'rgba(255,255,255,0.65)' }}>{src}</span>
                  <span style={{ fontWeight: 700 }}>{count} views</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
