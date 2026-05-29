import React, { useState, useEffect, useRef } from 'react'
import { Film, Zap, Download, Share2, RefreshCw, ChevronDown, Check, Play, Loader2, Copy, CheckCheck } from 'lucide-react'
import toast from 'react-hot-toast'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'

function authHeaders() {
  const token = localStorage.getItem('veori_token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

const STYLES = [
  {
    id:    'investment',
    label: 'Investor ROI',
    desc:  'Numbers-focused, sharp, profit-driven',
    color: '#00C37A',
    bg:    'rgba(0,195,122,0.08)',
    border:'rgba(0,195,122,0.3)',
  },
  {
    id:    'luxury',
    label: 'Luxury',
    desc:  'Aspirational, elegant, lifestyle',
    color: '#C9A84C',
    bg:    'rgba(201,168,76,0.08)',
    border:'rgba(201,168,76,0.3)',
  },
  {
    id:    'family',
    label: 'Family Home',
    desc:  'Warm, emotional, community-focused',
    color: '#60A5FA',
    bg:    'rgba(96,165,250,0.08)',
    border:'rgba(96,165,250,0.3)',
  },
  {
    id:    'distressed',
    label: 'Fix & Flip',
    desc:  'Urgent, opportunity-focused, fast',
    color: '#F97316',
    bg:    'rgba(249,115,22,0.08)',
    border:'rgba(249,115,22,0.3)',
  },
]

const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', sub: 'YouTube · Facebook',  icon: '▬' },
  { id: '9:16', label: '9:16', sub: 'Instagram · Stories', icon: '▮' },
]

const PLATFORMS = ['facebook', 'instagram', 'twitter', 'youtube']

const STATUS_STEPS = [
  { key: 'script',    label: 'Writing cinematic script',   duration: 2000 },
  { key: 'voiceover', label: 'Generating AI voiceover',    duration: 2500 },
  { key: 'effects',   label: 'Applying Ken Burns effects', duration: 2000 },
  { key: 'music',     label: 'Adding background music',    duration: 1500 },
  { key: 'rendering', label: 'Rendering final video',      duration: 3000 },
]

export default function PropertyMarketing() {
  const [listings, setListings]           = useState([])
  const [selectedListing, setSelectedListing] = useState(null)
  const [showListings, setShowListings]   = useState(false)
  const [selectedStyle, setSelectedStyle] = useState('investment')
  const [aspectRatio, setAspectRatio]     = useState('16:9')
  const [withVoiceover, setWithVoiceover] = useState(true)
  const [generating, setGenerating]       = useState(false)
  const [currentStep, setCurrentStep]     = useState(-1)
  const [renderId, setRenderId]           = useState(null)
  const [videoResult, setVideoResult]     = useState(null)
  const [videoUrl, setVideoUrl]           = useState(null)
  const [script, setScript]              = useState(null)
  const [captions, setCaptions]          = useState({})
  const [generatingCaptions, setGeneratingCaptions] = useState(false)
  const [copied, setCopied]              = useState({})
  const [videos, setVideos]              = useState([])
  const pollRef                          = useRef(null)

  useEffect(() => {
    fetch(`${API}/listings`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setListings(d.listings || d.data || []))
      .catch(() => {})

    fetch(`${API}/property-marketing/videos`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setVideos(d.videos || []))
      .catch(() => {})
  }, [])

  // Poll render status
  useEffect(() => {
    if (!renderId) return
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/property-marketing/status/${renderId}`, { headers: authHeaders() })
        const d = await r.json()
        if (d.status === 'done' && d.url) {
          setVideoUrl(d.url)
          setGenerating(false)
          setCurrentStep(STATUS_STEPS.length)
          clearInterval(pollRef.current)
          toast.success('Your cinematic video is ready!')
          // Refresh list
          fetch(`${API}/property-marketing/videos`, { headers: authHeaders() })
            .then(r => r.json()).then(d => setVideos(d.videos || []))
        } else if (d.status === 'failed') {
          setGenerating(false)
          clearInterval(pollRef.current)
          toast.error('Video rendering failed. Please try again.')
        }
      } catch {}
    }, 5000)
    return () => clearInterval(pollRef.current)
  }, [renderId])

  async function handleGenerate() {
    if (!selectedListing) { toast.error('Select a listing first'); return }
    setGenerating(true)
    setCurrentStep(0)
    setVideoUrl(null)
    setScript(null)
    setCaptions({})

    // Animate steps
    let step = 0
    const stepInterval = setInterval(() => {
      step++
      if (step < STATUS_STEPS.length) {
        setCurrentStep(step)
      } else {
        clearInterval(stepInterval)
      }
    }, STATUS_STEPS[step]?.duration || 2000)

    try {
      const r = await fetch(`${API}/property-marketing/generate`, {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({
          listing_id:    selectedListing.id,
          style:         selectedStyle,
          aspect_ratio:  aspectRatio,
          with_voiceover: withVoiceover,
        }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error)

      setVideoResult(d.video)
      setScript(d.script)
      setRenderId(d.render_id)

      if (d.script) {
        // Generate captions in parallel
        handleGenerateCaptions(selectedListing.id)
      }
    } catch (err) {
      clearInterval(stepInterval)
      setGenerating(false)
      setCurrentStep(-1)
      toast.error(err.message || 'Failed to generate video')
    }
  }

  async function handleGenerateCaptions(listingId) {
    setGeneratingCaptions(true)
    try {
      const r = await fetch(`${API}/property-marketing/generate-captions`, {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({
          listing_id: listingId || selectedListing?.id,
          style:      selectedStyle,
          platforms:  PLATFORMS,
        }),
      })
      const d = await r.json()
      if (d.success) setCaptions(d.captions || {})
    } catch {}
    setGeneratingCaptions(false)
  }

  function copyCaption(platform, text) {
    navigator.clipboard.writeText(text)
    setCopied(prev => ({ ...prev, [platform]: true }))
    setTimeout(() => setCopied(prev => ({ ...prev, [platform]: false })), 2000)
  }

  const style = STYLES.find(s => s.id === selectedStyle)

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,195,122,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Film size={20} color="#00C37A" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>Property Marketing Studio</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--t3)' }}>AI-generated cinematic property videos with voiceover, music & transitions</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* LEFT: Config Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Listing Selector */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>Select Property</label>
            <div
              onClick={() => setShowListings(!showListings)}
              style={{ marginTop: 10, padding: '12px 16px', background: 'var(--app-bg)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ color: selectedListing ? 'var(--t1)' : 'var(--t3)', fontSize: 14 }}>
                {selectedListing ? `${selectedListing.address}, ${selectedListing.city}` : 'Choose a listing...'}
              </span>
              <ChevronDown size={16} color="var(--t3)" />
            </div>
            {showListings && (
              <div style={{ marginTop: 4, background: 'var(--app-bg)', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
                {listings.length === 0 && (
                  <div style={{ padding: 16, color: 'var(--t3)', fontSize: 13 }}>No listings found. Add listings first.</div>
                )}
                {listings.map(l => (
                  <div
                    key={l.id}
                    onClick={() => { setSelectedListing(l); setShowListings(false) }}
                    style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--card-bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 500 }}>{l.address}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)' }}>{l.city}, {l.state} · ${l.asking_price?.toLocaleString()}</div>
                    </div>
                    {selectedListing?.id === l.id && <Check size={14} color="#00C37A" />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Style Selector */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>Video Style</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              {STYLES.map(s => (
                <div
                  key={s.id}
                  onClick={() => setSelectedStyle(s.id)}
                  style={{
                    padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${selectedStyle === s.id ? s.border : 'var(--border)'}`,
                    background: selectedStyle === s.id ? s.bg : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: selectedStyle === s.id ? s.color : 'var(--t1)' }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>Format</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {ASPECT_RATIOS.map(r => (
                <div
                  key={r.id}
                  onClick={() => setAspectRatio(r.id)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                    border: `1px solid ${aspectRatio === r.id ? 'rgba(0,195,122,0.4)' : 'var(--border)'}`,
                    background: aspectRatio === r.id ? 'rgba(0,195,122,0.07)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{r.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{r.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Voiceover toggle */}
          <div
            onClick={() => setWithVoiceover(!withVoiceover)}
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>AI Voiceover</div>
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>Real human-sounding voice narrates the property</div>
            </div>
            <div style={{
              width: 44, height: 24, borderRadius: 12,
              background: withVoiceover ? '#00C37A' : 'var(--border)',
              position: 'relative', transition: 'background 0.2s',
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3,
                left: withVoiceover ? 23 : 3,
                transition: 'left 0.2s',
              }} />
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedListing}
            style={{
              padding: '16px 24px',
              background: generating || !selectedListing ? 'var(--border)' : 'linear-gradient(135deg, #00C37A, #00A865)',
              color: generating || !selectedListing ? 'var(--t3)' : '#fff',
              border: 'none', borderRadius: 12, cursor: generating || !selectedListing ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.2s',
            }}
          >
            {generating ? <Loader2 size={18} className="spin" /> : <Zap size={18} />}
            {generating ? 'Generating...' : 'Generate Cinematic Video'}
          </button>
        </div>

        {/* RIGHT: Preview + Progress */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Progress */}
          {generating && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 20 }}>🎬 Creating your video...</div>
              {STATUS_STEPS.map((step, i) => (
                <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: i < currentStep ? '#00C37A' : i === currentStep ? 'rgba(0,195,122,0.2)' : 'var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {i < currentStep
                      ? <Check size={12} color="#fff" />
                      : i === currentStep
                        ? <Loader2 size={12} color="#00C37A" className="spin" />
                        : null
                    }
                  </div>
                  <span style={{
                    fontSize: 13,
                    color: i < currentStep ? 'var(--t3)' : i === currentStep ? 'var(--t1)' : 'var(--t3)',
                    fontWeight: i === currentStep ? 600 : 400,
                  }}>{step.label}</span>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(0,195,122,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--t3)' }}>
                Render takes 2-3 minutes. You can leave this page — we'll save it.
              </div>
            </div>
          )}

          {/* Video Player */}
          {videoUrl && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid rgba(0,195,122,0.3)', borderRadius: 12, overflow: 'hidden' }}>
              <video
                src={videoUrl}
                controls
                style={{ width: '100%', display: 'block', background: '#000', maxHeight: 280 }}
              />
              <div style={{ padding: 16, display: 'flex', gap: 10 }}>
                <a
                  href={videoUrl}
                  download
                  style={{ flex: 1, padding: '10px 16px', background: '#00C37A', color: '#fff', borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Download size={15} /> Download MP4
                </a>
                <button
                  onClick={() => navigator.clipboard.writeText(videoUrl).then(() => toast.success('Link copied!'))}
                  style={{ padding: '10px 16px', background: 'var(--app-bg)', border: '1px solid var(--border)', color: 'var(--t1)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <Share2 size={15} /> Share Link
                </button>
              </div>
            </div>
          )}

          {/* Script */}
          {script && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>AI Voiceover Script</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--t1)', lineHeight: 1.7, fontStyle: 'italic' }}>"{script}"</p>
            </div>
          )}

          {/* Captions */}
          {Object.keys(captions).length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
                Platform Captions
              </div>
              {PLATFORMS.filter(p => captions[p]).map(platform => (
                <div key={platform} style={{ marginBottom: 14, padding: 14, background: 'var(--app-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', textTransform: 'capitalize' }}>{platform}</span>
                    <button
                      onClick={() => copyCaption(platform, captions[platform])}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                    >
                      {copied[platform] ? <><CheckCheck size={12} color="#00C37A" /> Copied</> : <><Copy size={12} /> Copy</>}
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto' }}>
                    {captions[platform]}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!generating && !videoUrl && !script && (
            <div style={{ background: 'var(--card-bg)', border: '1px dashed var(--border)', borderRadius: 12, padding: 48, textAlign: 'center' }}>
              <Film size={40} color="var(--t3)" style={{ margin: '0 auto 16px' }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t2)', marginBottom: 8 }}>Your video will appear here</div>
              <div style={{ fontSize: 13, color: 'var(--t3)' }}>Select a listing and click Generate to create a cinematic property video</div>
            </div>
          )}
        </div>
      </div>

      {/* Past Videos */}
      {videos.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginBottom: 16 }}>Past Videos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {videos.slice(0, 12).map(v => (
              <div key={v.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {v.video_url
                  ? <video src={v.video_url} style={{ width: '100%', height: 120, objectFit: 'cover', background: '#000' }} />
                  : <div style={{ height: 120, background: 'var(--app-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {v.status === 'rendering'
                        ? <Loader2 size={20} color="var(--t3)" className="spin" />
                        : <Play size={20} color="var(--t3)" />
                      }
                    </div>
                }
                <div style={{ padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', marginBottom: 2 }}>{v.listings?.address || 'Property'}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8, display: 'flex', gap: 6 }}>
                    <span style={{ textTransform: 'capitalize' }}>{v.style}</span>
                    <span>·</span>
                    <span>{v.aspect_ratio}</span>
                    <span>·</span>
                    <span style={{ color: v.status === 'done' ? '#00C37A' : v.status === 'failed' ? '#f87171' : 'var(--t3)' }}>{v.status}</span>
                  </div>
                  {v.video_url && (
                    <a href={v.video_url} download style={{ fontSize: 11, color: '#00C37A', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Download size={11} /> Download
                    </a>
                  )}
                  {v.status === 'rendering' && (
                    <button
                      onClick={() => setRenderId(v.render_id)}
                      style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--t3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
                    >
                      <RefreshCw size={11} /> Check status
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
