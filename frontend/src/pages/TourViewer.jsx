/**
 * Feature 36 - Public Tour Viewer (veori.net/tour/:token)
 * No auth required - public facing
 */
import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'

export default function TourViewer() {
  const { token } = useParams()
  const [tour, setTour]       = useState(null)
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [currentPhoto, setCurrentPhoto] = useState(0)
  const startTime = useRef(Date.now())

  useEffect(() => {
    fetch(`${API}/tour/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setTour(d.tour); setListing(d.listing) }
        else setError(d.error || 'Tour not found')
      })
      .catch(() => setError('Failed to load tour'))
      .finally(() => setLoading(false))

    // Log view on mount
    fetch(`${API}/tour/${token}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: new URLSearchParams(window.location.search).get('src') || 'direct' }),
    }).catch(() => {})

    // Log duration on unmount
    return () => {
      const duration = Math.round((Date.now() - startTime.current) / 1000)
      navigator.sendBeacon && navigator.sendBeacon(
        `${API}/tour/${token}/view`,
        JSON.stringify({ duration_sec: duration })
      )
    }
  }, [token])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#060E1A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Inter,sans-serif' }}>
      Loading tour…
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#060E1A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Inter,sans-serif', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 48 }}>🏚</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>Tour Not Found</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>{error}</div>
    </div>
  )

  const photos = tour?.photos || []

  return (
    <div style={{ minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#0A1526', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em' }}>{tour?.title || 'Property Tour'}</div>
          {listing && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{listing.address}, {listing.city}, {listing.state} {listing.zip}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>Powered by</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#00C37A' }}>VEORI AI</div>
        </div>
      </div>

      {/* Main photo */}
      {photos.length > 0 && (
        <div style={{ position: 'relative', background: '#000', height: '65vh', overflow: 'hidden' }}>
          <img
            src={photos[currentPhoto]}
            alt={`Property photo ${currentPhoto + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
          {photos.length > 1 && (
            <>
              <button onClick={() => setCurrentPhoto(p => (p - 1 + photos.length) % photos.length)}
                style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
              <button onClick={() => setCurrentPhoto(p => (p + 1) % photos.length)}
                style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
              <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', padding: '6px 14px', borderRadius: 20, fontSize: 13, color: '#fff' }}>
                {currentPhoto + 1} / {photos.length}
              </div>
            </>
          )}
        </div>
      )}

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div style={{ display: 'flex', gap: 8, padding: '12px 24px', overflowX: 'auto', background: '#0A1526' }}>
          {photos.map((p, i) => (
            <img key={i} src={p} alt="" onClick={() => setCurrentPhoto(i)}
              style={{ width: 80, height: 56, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0, border: i === currentPhoto ? '2px solid #00C37A' : '2px solid transparent', opacity: i === currentPhoto ? 1 : 0.6, transition: 'all 0.2s' }} />
          ))}
        </div>
      )}

      {/* Property info */}
      {listing && (
        <div style={{ padding: '24px', maxWidth: 800, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, marginBottom: 24 }}>
            {[
              listing.asking_price && { label: 'Asking Price', value: `$${Number(listing.asking_price).toLocaleString()}`, color: '#00C37A' },
              listing.arv && { label: 'ARV', value: `$${Number(listing.arv).toLocaleString()}`, color: '#C9A84C' },
              listing.bedrooms && { label: 'Bedrooms', value: listing.bedrooms, color: '#fff' },
              listing.bathrooms && { label: 'Bathrooms', value: listing.bathrooms, color: '#fff' },
              listing.sqft && { label: 'Sq Footage', value: `${listing.sqft.toLocaleString()} sqft`, color: '#fff' },
            ].filter(Boolean).map(item => (
              <div key={item.label} style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)' }}>{item.label}</div>
              </div>
            ))}
          </div>

          {listing.description && (
            <div style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '20px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>DESCRIPTION</div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, margin: 0 }}>{listing.description}</p>
            </div>
          )}

          {listing.highlights?.length > 0 && (
            <div style={{ background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 12 }}>HIGHLIGHTS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {listing.highlights.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C37A', flexShrink: 0 }} />
                    <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.80)' }}>{h}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ background: '#0A1526', borderTop: '1px solid rgba(255,255,255,0.07)', padding: '20px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
          Interested in this property? Contact us through VEORI AI.
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.20)', marginTop: 8 }}>
          Powered by VEORI AI · Built to Achieve.
        </div>
      </div>
    </div>
  )
}
