/**
 * Seller Photo Upload Page
 * Public route: /upload/:token
 * No login required — sellers use this to send property photos directly to Veori
 */
import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, CheckCircle, XCircle, Loader, Image, X } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'https://veori.net'

export default function PropertyPhotoUpload() {
  const { token } = useParams()
  const [property, setProperty]   = useState(null)
  const [status,   setStatus]     = useState('loading') // loading | ready | uploading | success | error | expired
  const [files,    setFiles]       = useState([])
  const [previews, setPreviews]    = useState([])
  const [progress, setProgress]    = useState(0)
  const [message,  setMessage]     = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/api/photo-upload/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setProperty(d.property); setStatus('ready') }
        else setStatus('expired')
      })
      .catch(() => setStatus('error'))
  }, [token])

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return

    const newFiles    = [...files, ...selected].slice(0, 20)
    const newPreviews = newFiles.map(f => URL.createObjectURL(f))

    // Clean up old previews
    previews.forEach(url => URL.revokeObjectURL(url))

    setFiles(newFiles)
    setPreviews(newPreviews)
  }

  const removeFile = (i) => {
    URL.revokeObjectURL(previews[i])
    setFiles(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => prev.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async () => {
    if (!files.length) return
    setStatus('uploading')
    setProgress(0)

    const formData = new FormData()
    files.forEach(f => formData.append('photos', f))

    try {
      // Simulate progress
      const timer = setInterval(() => setProgress(p => Math.min(p + 8, 90)), 300)

      const res  = await fetch(`${API}/api/photo-upload/${token}`, {
        method: 'POST',
        body:   formData,
      })
      clearInterval(timer)
      setProgress(100)

      const data = await res.json()
      if (data.success) {
        setMessage(data.message || `${data.uploaded} photo${data.uploaded !== 1 ? 's' : ''} received!`)
        setStatus('success')
      } else {
        setMessage(data.error || 'Upload failed. Please try again.')
        setStatus('ready')
      }
    } catch {
      setMessage('Network error. Please check your connection and try again.')
      setStatus('ready')
    }
  }

  const s = {
    page: {
      minHeight: '100vh',
      background: '#060E1A',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: '32px 16px 48px',
      fontFamily: 'Inter, -apple-system, sans-serif',
    },
    card: {
      width: '100%',
      maxWidth: 480,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 20,
      overflow: 'hidden',
    },
    header: {
      padding: '28px 28px 20px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      textAlign: 'center',
    },
    body: { padding: 28 },
  }

  if (status === 'loading') return (
    <div style={s.page}>
      <Loader size={32} style={{ color: '#00C37A', animation: 'spin 1s linear infinite', margin: '80px auto' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (status === 'expired') return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.04em', marginBottom: 6 }}>VEORI</div>
        </div>
        <div style={{ ...s.body, textAlign: 'center' }}>
          <XCircle size={48} style={{ color: '#FF4444', margin: '0 auto 16px', display: 'block' }} />
          <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 10px' }}>Link Expired</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
            This upload link has expired or is no longer valid. Please contact us to get a new link.
          </p>
        </div>
      </div>
    </div>
  )

  if (status === 'success') return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.04em', marginBottom: 6 }}>VEORI</div>
        </div>
        <div style={{ ...s.body, textAlign: 'center' }}>
          <CheckCircle size={56} style={{ color: '#00C37A', margin: '0 auto 20px', display: 'block' }} />
          <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 0 12px' }}>Photos Received!</p>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: '0 0 6px' }}>{message}</p>
          {property?.address && (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
              {property.address}{property.city ? `, ${property.city}` : ''}{property.state ? `, ${property.state}` : ''}
            </p>
          )}
          <div style={{ marginTop: 28, padding: '16px', background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.15)', borderRadius: 12 }}>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.6 }}>
              Thank you! We will review the photos and be in touch with you shortly.
            </p>
          </div>
        </div>
      </div>
    </div>
  )

  const address = property
    ? [property.address, property.city, property.state].filter(Boolean).join(', ')
    : ''

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.04em', marginBottom: 4 }}>VEORI</div>
          <p style={{ fontSize: 11, color: '#00C37A', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Property Photos
          </p>
        </div>

        <div style={s.body}>
          {/* Property info */}
          {property && (
            <div style={{ marginBottom: 24, padding: '14px 16px', background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.15)', borderRadius: 12 }}>
              {property.seller && (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 4px' }}>Hi {property.seller.split(' ')[0]},</p>
              )}
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.5 }}>
                Please send us photos of <strong style={{ color: '#fff' }}>{address || 'your property'}</strong>.
                The more photos the better — inside and outside.
              </p>
              {property.photo_count > 0 && (
                <p style={{ fontSize: 11, color: '#00C37A', margin: '8px 0 0' }}>
                  {property.photo_count} photo{property.photo_count !== 1 ? 's' : ''} already received
                </p>
              )}
            </div>
          )}

          {/* Photo previews */}
          {previews.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
                {previews.length} photo{previews.length !== 1 ? 's' : ''} selected
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {previews.map((url, i) => (
                  <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: '#0A1526' }}>
                    <img src={url} alt={`Photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      onClick={() => removeFile(i)}
                      style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.7)', border: 'none',
                        color: '#fff', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload area */}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {status === 'uploading' ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Loader size={28} style={{ color: '#00C37A', animation: 'spin 1s linear infinite', margin: '0 auto 14px', display: 'block' }} />
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: '0 0 12px' }}>Uploading photos...</p>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: '#00C37A', borderRadius: 3, transition: 'width 0.3s ease' }} />
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Camera button — opens camera on mobile */}
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  width: '100%', padding: '18px 0',
                  background: 'rgba(0,195,122,0.08)',
                  border: '1.5px dashed rgba(0,195,122,0.35)',
                  borderRadius: 12, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 10,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,195,122,0.14)'; e.currentTarget.style.borderColor = 'rgba(0,195,122,0.6)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,195,122,0.08)'; e.currentTarget.style.borderColor = 'rgba(0,195,122,0.35)' }}
              >
                <Camera size={28} style={{ color: '#00C37A' }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
                  {previews.length > 0 ? 'Add More Photos' : 'Take or Choose Photos'}
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Tap to open camera or photo library
                </span>
              </button>

              {/* Send button */}
              {files.length > 0 && (
                <button
                  onClick={handleSubmit}
                  style={{
                    width: '100%', padding: '16px 0',
                    background: '#00C37A', border: 'none',
                    borderRadius: 12, cursor: 'pointer',
                    fontSize: 16, fontWeight: 700, color: '#000',
                    boxShadow: '0 0 20px rgba(0,195,122,0.3)',
                    transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Image size={18} />
                  Send {files.length} Photo{files.length !== 1 ? 's' : ''}
                </button>
              )}

              {message && (
                <p style={{ fontSize: 13, color: '#FF9500', textAlign: 'center', margin: 0 }}>{message}</p>
              )}
            </div>
          )}

          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 24, lineHeight: 1.5 }}>
            Your photos are sent securely and only seen by the person who contacted you.
          </p>
        </div>
      </div>
    </div>
  )
}
