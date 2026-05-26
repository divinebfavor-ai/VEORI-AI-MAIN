/**
 * Features 22-24, 27 Property Listings + Disposition Engine
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const STATUS_COLORS = { draft: '#C9A84C', active: '#00C37A', under_contract: '#8B5CF6', closed: 'rgba(255,255,255,0.35)' }

const BLANK = { title: '', description: '', asking_price: '', arv: '', repair_cost: '', property_type: 'single_family', bedrooms: '', bathrooms: '', sqft: '', year_built: '', address: '', city: '', state: '', zip: '', highlights: '' }

export default function Listings() {
  const [listings, setListings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('listings')
  const [form, setForm]         = useState(BLANK)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState(null)
  const [blasting, setBlasting] = useState(false)
  const [generatePdf, setGeneratePdf] = useState(false)
  const [pdfResult, setPdfResult] = useState(null)
  const [generatingDesc, setGeneratingDesc] = useState(false)
  const [publishing, setPublishing]         = useState(null)  // listingId being published
  const [pipelineResult, setPipelineResult] = useState(null)
  const [enhancing, setEnhancing]           = useState(null)  // listingId being enhanced
  const [enhanceResult, setEnhanceResult]   = useState(null)

  function load() {
    setLoading(true)
    fetch(`${API}/listings`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setListings(d.listings || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function create() {
    if (!form.title || !form.address) return alert('Title and address required')
    setCreating(true)
    try {
      const body = {
        ...form,
        asking_price: parseFloat(form.asking_price) || null,
        arv: parseFloat(form.arv) || null,
        repair_cost: parseFloat(form.repair_cost) || null,
        bedrooms: parseInt(form.bedrooms) || null,
        bathrooms: parseFloat(form.bathrooms) || null,
        sqft: parseInt(form.sqft) || null,
        year_built: parseInt(form.year_built) || null,
        highlights: form.highlights ? form.highlights.split('\n').filter(Boolean) : [],
      }
      const r = await fetch(`${API}/listings`, { method: 'POST', headers: authHeader(), body: JSON.stringify(body) })
      const d = await r.json()
      if (d.success) { setListings(prev => [d.listing, ...prev]); setForm(BLANK); setTab('listings'); alert('Listing created!') }
      else alert(d.error)
    } catch { alert('Network error') }
    setCreating(false)
  }

  async function blast(listingId) {
    const platforms = ['facebook', 'instagram', 'email']
    setBlasting(true)
    try {
      const r = await fetch(`${API}/listings/${listingId}/blast`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ platforms }),
      })
      const d = await r.json()
      if (d.success) {
        alert(`Blasted to: ${Object.entries(d.results).map(([p,r]) => `${p}: ${r.status}`).join(', ')}`)
        load()
      }
    } catch {}
    setBlasting(false)
  }

  async function generatePackage(listingId) {
    setGeneratePdf(true)
    try {
      const r = await fetch(`${API}/deal-package/generate/${listingId}`, { method: 'POST', headers: authHeader() })
      const d = await r.json()
      if (d.success) {
        setPdfResult(d)
        // Auto-download
        const a = document.createElement('a')
        a.href = d.pdf_base64
        a.download = d.filename
        a.click()
      } else alert(d.error)
    } catch { alert('Failed to generate PDF') }
    setGeneratePdf(false)
  }

  async function generateDescription() {
    if (!form.address && !form.property_type) return alert('Fill in address and property details first')
    setGeneratingDesc(true)
    try {
      const prompt = `Write a compelling 3-sentence wholesale real estate listing description for the following property. Be concise, professional, and highlight the investment opportunity. Do not include a title.

Property details:
- Address: ${form.address || 'N/A'}${form.city ? ', ' + form.city : ''}${form.state ? ', ' + form.state : ''}
- Type: ${form.property_type?.replace(/_/g, ' ') || 'residential'}
- Bedrooms: ${form.bedrooms || 'N/A'}, Bathrooms: ${form.bathrooms || 'N/A'}
- Sq Ft: ${form.sqft || 'N/A'}, Year Built: ${form.year_built || 'N/A'}
- ARV: $${Number(form.arv || 0).toLocaleString()}
- Asking Price: $${Number(form.asking_price || 0).toLocaleString()}
- Repair Cost: $${Number(form.repair_cost || 0).toLocaleString()}
${form.highlights ? '- Highlights: ' + form.highlights : ''}`

      const r = await fetch(`${API}/aria/chat`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ message: prompt, history: [] }),
      })
      const d = await r.json()
      const text = d.reply || d.content || d.text || ''
      if (text) setForm(p => ({ ...p, description: text.trim() }))
      else alert('Could not generate description. Try again.')
    } catch { alert('Failed to generate description') }
    setGeneratingDesc(false)
  }

  async function publishPipeline(listingId) {
    if (!confirm('This will generate a video, write captions, post to all connected social accounts, and email blast all your buyers. Ready?')) return
    setPublishing(listingId)
    setPipelineResult(null)
    try {
      const r = await fetch(`${API}/pipeline/publish/${listingId}`, {
        method: 'POST', headers: authHeader(),
      })
      const d = await r.json()
      setPipelineResult(d)
      load()
    } catch { alert('Pipeline failed. Please try again.') }
    setPublishing(null)
  }

  async function enhancePhotos(listingId, photoCount) {
    if (!photoCount || photoCount === 0) return alert('This listing has no photos to enhance. Add photos first.')
    if (!confirm(`Enhance ${Math.min(photoCount, 6)} photo${photoCount > 1 ? 's' : ''} with AI upscaling? This takes 1-2 minutes.`)) return
    setEnhancing(listingId)
    setEnhanceResult(null)
    try {
      const r = await fetch(`${API}/listings/${listingId}/enhance-photos`, {
        method: 'POST', headers: authHeader(),
      })
      const d = await r.json()
      if (d.success) {
        setEnhanceResult({ listingId, enhanced: d.enhanced, total: d.photos.length })
        load()
      } else {
        alert(d.error || 'Enhancement failed. Please try again.')
      }
    } catch { alert('Enhancement failed. Please try again.') }
    setEnhancing(null)
  }

  async function updateStatus(id, status) {
    await fetch(`${API}/listings/${id}`, {
      method: 'PUT', headers: authHeader(),
      body: JSON.stringify({ status }),
    })
    load()
  }

  const s = {
    page:  { padding: '32px', color: 'var(--t1, #fff)', fontFamily: 'Inter,sans-serif' },
    card:  { background: 'var(--card-bg, #0A1526)', border: '1px solid var(--border, rgba(255,255,255,0.07))', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
    tab:   (a) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', background: a ? '#00C37A' : 'rgba(255,255,255,0.06)', color: a ? '#000' : 'rgba(255,255,255,0.55)' }),
    btn:   (bg, fg='#000') => ({ padding: '7px 14px', background: bg, color: fg, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }),
  }

  function field(label, key, type='text', placeholder='') {
    return (
      <div>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>{label}</label>
        {type === 'textarea'
          ? <textarea style={{ ...s.input, height: 80, resize: 'vertical' }} placeholder={placeholder} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
          : <input style={s.input} type={type} placeholder={placeholder} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
        }
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🏠 Property Listings</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Create, blast, and close deals from one place</p>
        </div>
        <button onClick={() => setTab('create')} style={s.btn('#00C37A')}>+ New Listing</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={s.tab(tab === 'listings')} onClick={() => setTab('listings')}>📋 All Listings</button>
        <button style={s.tab(tab === 'create')}   onClick={() => setTab('create')}>➕ Create</button>
      </div>

      {tab === 'listings' && (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading listings…</div>
          ) : listings.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🏠</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No listings yet</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 }}>Create your first property listing to start blasting to buyers</div>
              <button onClick={() => setTab('create')} style={{ padding: '10px 24px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Create First Listing</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {listings.map(l => (
                <div key={l.id} style={s.card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 800 }}>{l.title}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[l.status], background: `${STATUS_COLORS[l.status]}20`, padding: '2px 10px', borderRadius: 6, textTransform: 'capitalize' }}>{l.status}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
                        {l.address}, {l.city}, {l.state} {l.zip}
                        {l.bedrooms ? ` · ${l.bedrooms}bd/${l.bathrooms}ba` : ''}
                        {l.sqft ? ` · ${l.sqft.toLocaleString()} sqft` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                        {l.asking_price && <span>Ask: <b style={{ color: '#00C37A' }}>${Number(l.asking_price).toLocaleString()}</b></span>}
                        {l.arv && <span>ARV: <b>${Number(l.arv).toLocaleString()}</b></span>}
                        {l.equity && <span>Equity: <b style={{ color: '#C9A84C' }}>${Number(l.equity).toLocaleString()}</b></span>}
                      </div>
                      {l.published_to?.length > 0 && (
                        <div style={{ fontSize: 11, color: '#00C37A', marginTop: 4 }}>Blasted to: {l.published_to.join(', ')}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <button
                        onClick={() => publishPipeline(l.id)}
                        disabled={publishing === l.id}
                        style={{ ...s.btn('#00C37A'), display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        {publishing === l.id ? '⏳ Publishing...' : '🚀 Publish Pipeline'}
                      </button>
                      <button onClick={() => blast(l.id)} disabled={blasting} style={s.btn('#C9A84C')}>📣 Blast Only</button>
                      <button onClick={() => generatePackage(l.id)} disabled={generatePdf} style={s.btn('rgba(255,255,255,0.08)', '#fff')}>📄 PDF</button>
                      <button
                        onClick={() => enhancePhotos(l.id, l.photos?.length || 0)}
                        disabled={enhancing === l.id}
                        style={s.btn('rgba(201,168,76,0.12)', '#C9A84C')}>
                        {enhancing === l.id ? '⏳ Enhancing…' : '✦ Enhance Photos'}
                      </button>
                      {l.status === 'active' && <button onClick={() => updateStatus(l.id, 'under_contract')} style={s.btn('rgba(139,92,246,0.15)', '#8B5CF6')}>→ Under Contract</button>}
                      {l.status === 'under_contract' && <button onClick={() => updateStatus(l.id, 'closed')} style={s.btn('rgba(0,195,122,0.15)', '#00C37A')}>→ Closed</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {enhanceResult && (
        <div style={{ position: 'fixed', bottom: 80, right: 28, zIndex: 1000, background: '#0A1526', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 14, padding: '18px 24px', maxWidth: 320, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800, color: '#C9A84C' }}>✦ Photos Enhanced!</p>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                {enhanceResult.enhanced} photo{enhanceResult.enhanced !== 1 ? 's' : ''} upscaled to HD quality.
              </p>
            </div>
            <button onClick={() => setEnhanceResult(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 18, lineHeight: 1, marginLeft: 12 }}>✕</button>
          </div>
        </div>
      )}

      {pipelineResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
          <div style={{ background: 'var(--card-bg, #0A1526)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 500 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>🚀</span>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#00C37A', margin: 0 }}>Pipeline Complete!</h2>
            </div>
            {Object.entries(pipelineResult.steps || {}).map(([step, result]) => (
              <div key={step} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textTransform: 'capitalize' }}>
                  {step.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#00C37A' }}>
                  {typeof result === 'object'
                    ? result.status === 'skipped' ? `⏭ ${result.reason || 'skipped'}`
                    : result.queued ? `✓ ${result.queued.join(', ')}`
                    : result.render_id ? `✓ rendering (${result.eta})`
                    : result.sent !== undefined ? `✓ ${result.sent} emails sent`
                    : '✓ done'
                    : `✓ ${result}`}
                </span>
              </div>
            ))}
            <button onClick={() => setPipelineResult(null)} style={{ marginTop: 20, width: '100%', padding: '12px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {tab === 'create' && (
        <div style={{ maxWidth: 680 }}>
          <div style={s.card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: '#00C37A' }}>CREATE NEW LISTING</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1/-1' }}>{field('Listing Title *', 'title', 'text', '3/2/1 Great Opportunity in Downtown…')}</div>
              {field('Asking Price', 'asking_price', 'number', '125000')}
              {field('ARV', 'arv', 'number', '250000')}
              {field('Repair Cost', 'repair_cost', 'number', '30000')}
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Property Type</label>
                <select style={{ ...s.input }} value={form.property_type} onChange={e => setForm(p => ({ ...p, property_type: e.target.value }))}>
                  {['single_family','multi_family','condo','townhouse','land','commercial'].map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
                </select>
              </div>
              {field('Year Built', 'year_built', 'number', '1985')}
              {field('Bedrooms', 'bedrooms', 'number', '3')}
              {field('Bathrooms', 'bathrooms', 'number', '2')}
              {field('Sq Footage', 'sqft', 'number', '1400')}
              <div style={{ gridColumn: '1/-1' }}>{field('Property Address', 'address', 'text', '123 Main St')}</div>
              {field('City', 'city', 'text', 'Atlanta')}
              {field('State', 'state', 'text', 'GA')}
              {field('Zip', 'zip', 'text', '30301')}
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Description</label>
                  <button onClick={generateDescription} disabled={generatingDesc} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,195,122,0.35)',
                    background: 'rgba(0,195,122,0.08)', color: '#00C37A',
                    fontSize: 11, fontWeight: 600, cursor: generatingDesc ? 'default' : 'pointer',
                    opacity: generatingDesc ? 0.6 : 1, fontFamily: 'Inter,sans-serif',
                  }}>
                    {generatingDesc ? '✦ Generating...' : '✦ AI Generate'}
                  </button>
                </div>
                <textarea style={{ ...s.input, height: 80, resize: 'vertical' }} placeholder="Describe the property or click AI Generate..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>{field('Highlights (one per line)', 'highlights', 'textarea', 'Great cash flow\nLow entry price\nSolid rental demand')}</div>
              <div style={{ gridColumn: '1/-1', display: 'flex', gap: 10 }}>
                <button onClick={create} disabled={creating}
                  style={{ flex: 1, padding: '13px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                  {creating ? 'Creating…' : 'Create Listing ✓'}
                </button>
                <button onClick={() => setTab('listings')} style={{ padding: '13px 20px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
