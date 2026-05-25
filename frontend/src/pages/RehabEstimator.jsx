/**
 * Feature 18 — Rehab Cost Estimator
 */
import React, { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const t = localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

export default function RehabEstimator() {
  const [items, setItems]       = useState([])
  const [selected, setSelected] = useState({}) // { [category]: { option, quantity } }
  const [arv, setArv]           = useState('')
  const [askingPrice, setAskingPrice] = useState('')
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [calculating, setCalc]  = useState(false)

  useEffect(() => {
    fetch(`${API}/rehab/items`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function selectOption(category, optionId) {
    setSelected(prev => ({
      ...prev,
      [category]: prev[category]?.option === optionId
        ? undefined // deselect
        : { option: optionId, quantity: 1 },
    }))
  }

  function setQty(category, qty) {
    setSelected(prev => ({ ...prev, [category]: { ...prev[category], quantity: Math.max(1, qty) } }))
  }

  async function calculate() {
    setCalc(true)
    try {
      const repairItems = Object.entries(selected)
        .filter(([, v]) => v)
        .map(([category, v]) => ({ category, option: v.option, quantity: v.quantity }))

      const r = await fetch(`${API}/rehab/estimate`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ items: repairItems, arv: parseFloat(arv) || 0, asking_price: parseFloat(askingPrice) || 0 }),
      })
      const d = await r.json()
      if (d.success) setResult(d)
    } catch {}
    setCalc(false)
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  const s = {
    page:  { minHeight: '100vh', background: '#060E1A', color: '#fff', fontFamily: 'Inter,sans-serif', padding: '32px' },
    card:  { background: '#0A1526', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '20px' },
    input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#fff', padding: '9px 14px', fontSize: 13, fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' },
  }

  return (
    <div style={s.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4 }}>🔨 Rehab Cost Estimator</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Select repair items → get low/mid/high estimate + profit scenarios</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
        {/* Left: item selector */}
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.45)' }}>Loading repair catalog…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map(item => (
                <div key={item.key} style={s.card}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{item.label}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {item.options.map(opt => {
                      const isSelected = selected[item.key]?.option === opt.id
                      return (
                        <button key={opt.id} onClick={() => selectOption(item.key, opt.id)}
                          style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${isSelected ? '#00C37A' : 'rgba(255,255,255,0.10)'}`, background: isSelected ? 'rgba(0,195,122,0.15)' : 'transparent', color: isSelected ? '#00C37A' : 'rgba(255,255,255,0.65)', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
                          {opt.label}
                          <span style={{ color: isSelected ? '#00C37A' : 'rgba(255,255,255,0.35)', marginLeft: 4 }}>
                            ${opt.min.toLocaleString()}–${opt.max.toLocaleString()}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {selected[item.key] && ['windows','bathrooms'].includes(item.key) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Qty:</span>
                      <input type="number" min={1} max={20} value={selected[item.key].quantity}
                        onChange={e => setQty(item.key, parseInt(e.target.value) || 1)}
                        style={{ ...s.input, width: 70 }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: inputs + result */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={s.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: '#C9A84C' }}>DEAL INPUTS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>After Repair Value (ARV)</label>
                <input style={s.input} type="number" placeholder="e.g. 250000" value={arv} onChange={e => setArv(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 4 }}>Asking / Offer Price</label>
                <input style={s.input} type="number" placeholder="e.g. 120000" value={askingPrice} onChange={e => setAskingPrice(e.target.value)} />
              </div>
              <button onClick={calculate} disabled={calculating || selectedCount === 0}
                style={{ padding: '12px', background: '#00C37A', color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: calculating ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif', opacity: selectedCount === 0 ? 0.4 : 1, marginTop: 4 }}>
                {calculating ? 'Calculating…' : `Calculate (${selectedCount} items selected)`}
              </button>
            </div>
          </div>

          {result?.estimate && (
            <div style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#00C37A' }}>REPAIR ESTIMATE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'Low', value: `$${result.estimate.low.toLocaleString()}`, color: '#00C37A' },
                  { label: 'Mid', value: `$${result.estimate.midpoint.toLocaleString()}`, color: '#C9A84C' },
                  { label: 'High', value: `$${result.estimate.high.toLocaleString()}`, color: '#EF4444' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{item.label}</div>
                  </div>
                ))}
              </div>

              {result.profit_snapshot && (
                <div style={{ padding: '12px', background: 'rgba(0,195,122,0.08)', borderRadius: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#00C37A', marginBottom: 6 }}>DEAL SNAPSHOT</div>
                  <div style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>MAO (70% rule)</span>
                    <span style={{ fontWeight: 700 }}>${result.profit_snapshot.mao?.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>Asking Price</span>
                    <span style={{ fontWeight: 700 }}>${result.profit_snapshot.asking_price?.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ fontWeight: 700 }}>Spread</span>
                    <span style={{ fontWeight: 900, color: result.profit_snapshot.spread >= 0 ? '#00C37A' : '#EF4444' }}>
                      ${result.profit_snapshot.spread?.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13, fontWeight: 800, color: result.profit_snapshot.deal_quality === 'Excellent' ? '#00C37A' : result.profit_snapshot.deal_quality === 'Good' ? '#C9A84C' : '#EF4444' }}>
                    {result.profit_snapshot.deal_quality}
                  </div>
                </div>
              )}

              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>BREAKDOWN</div>
              {result.estimate.breakdown?.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ color: 'rgba(255,255,255,0.65)' }}>{item.label} ({item.option}{item.quantity > 1 ? ` × ${item.quantity}` : ''})</span>
                  <span style={{ fontWeight: 700 }}>${item.low.toLocaleString()}–${item.high.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {result?.scenarios && (
            <div style={s.card}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'rgba(255,255,255,0.45)' }}>3 SCENARIOS</div>
              {['conservative','moderate','aggressive'].map(key => {
                const sc = result.scenarios[key]
                return (
                  <div key={key} style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'capitalize', marginBottom: 6 }}>{key}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,0.45)' }}>ARV</span><span>${sc.arv?.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,0.45)' }}>MAO</span><span style={{ color: '#00C37A', fontWeight: 700 }}>${sc.mao?.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,0.45)' }}>Buyer Profit</span><span>${sc.buyer_profit_at_mao?.toLocaleString()}</span>
                    </div>
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
