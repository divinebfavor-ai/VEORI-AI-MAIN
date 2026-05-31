/**
 * Billing Page - In-App Subscription Management (Flutterwave)
 * Route: /billing
 */
import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../store/authStore'

const API = `${import.meta.env.VITE_API_URL || 'https://veori.net'}/api/fw-billing`

function authHeaders() {
  const token = localStorage.getItem('veori_token')
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

const PLAN_ORDER = ['founding_member', 'starter', 'growth', 'pro', 'scale', 'enterprise']

const PLAN_HIGHLIGHTS = {
  founding_member: ['3,000 AI dials/month', 'All features included', 'Rate locked forever', 'Priority support'],
  starter:         ['3,000 AI dials/month', 'All features included', 'Email support'],
  growth:          ['7,000 AI dials/month', 'All features included', 'Priority support'],
  pro:             ['15,000 AI dials/month', 'All features included', 'Priority support', 'Custom sequences'],
  scale:           ['30,000 AI dials/month', 'All features included', 'Dedicated support', 'Custom sequences'],
  enterprise:      ['50,000 AI dials/month', 'All features included', 'Dedicated account manager', 'White-glove setup'],
}

export default function Billing() {
  const navigate    = useNavigate()
  const [urlParams] = useSearchParams()
  const user        = useAuthStore(s => s.user)
  const [plans, setPlans]         = useState([])
  const [subscription, setSub]    = useState(null)
  const [loading, setLoading]     = useState(true)
  const [subscribing, setSubbing] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/plans`).then(r => r.json()),
      fetch(`${API}/subscription`, { headers: authHeaders() }).then(r => r.json()),
    ]).then(([plansData, subData]) => {
      if (plansData.success) {
        const ordered = PLAN_ORDER.map(k => plansData.plans.find(p => p.key === k)).filter(Boolean)
        setPlans(ordered)
        // Auto-launch checkout if ?plan= is in URL (coming from landing page)
        const autoPlan = urlParams.get('plan')
        if (autoPlan && ordered.find(p => p.key === autoPlan)) {
          setTimeout(() => handleSubscribe(autoPlan), 800)
        }
      }
      if (subData.success) setSub(subData)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const handleSubscribe = async (planKey) => {
    setSubbing(planKey)
    try {
      const res = await fetch(`${API}/create-payment-link`, {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (data.success && data.payment_url) {
        window.location.href = data.payment_url
      } else {
        alert(data.error || 'Could not start checkout. Please try again.')
      }
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setSubbing(null)
    }
  }

  const handleCancel = async () => {
    if (!confirm('Cancel your subscription? You keep access until end of billing period.')) return
    try {
      const res  = await fetch(`${API}/cancel`, { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (data.success) {
        alert(data.message)
        setSub(prev => ({ ...prev, status: 'cancelled' }))
      }
    } catch {
      alert('Could not cancel. Please contact support.')
    }
  }

  const currentPlan = subscription?.plan
  const isActive    = subscription?.status === 'active'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--app-bg)', padding: '40px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--t1)', margin: 0 }}>
            Subscription
          </h1>
          <p style={{ color: 'var(--t2)', marginTop: 8, fontSize: 15 }}>
            Choose the plan that fits your deal volume. Cancel anytime.
          </p>
        </div>

        {/* Current plan banner */}
        {!loading && isActive && (
          <div style={{
            background:    'linear-gradient(135deg, rgba(0,195,122,0.15), rgba(0,195,122,0.05))',
            border:        '1px solid rgba(0,195,122,0.3)',
            borderRadius:  12,
            padding:       '20px 24px',
            marginBottom:  32,
            display:       'flex',
            alignItems:    'center',
            justifyContent:'between',
            gap:           16,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#00C37A', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                Active Plan
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>
                {subscription.plan_name || currentPlan}
              </div>
              <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>
                {subscription.dials?.toLocaleString()} dials/month
                {subscription.expires_at && ` · Renews ${new Date(subscription.expires_at).toLocaleDateString()}`}
              </div>
            </div>
            <button
              onClick={handleCancel}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--t2)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel Plan
            </button>
          </div>
        )}

        {/* Plans grid */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t2)', padding: 80 }}>Loading plans…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
            {plans.map(plan => {
              const isCurrent   = plan.key === currentPlan && isActive
              const isFounding  = plan.founding
              const isLoading   = subscribing === plan.key
              const highlights  = PLAN_HIGHLIGHTS[plan.key] || []

              return (
                <div
                  key={plan.key}
                  style={{
                    background:    isFounding
                      ? 'linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.04))'
                      : 'var(--card-bg)',
                    border:        isCurrent
                      ? '2px solid #00C37A'
                      : isFounding
                      ? '1px solid rgba(201,168,76,0.4)'
                      : '1px solid var(--border)',
                    borderRadius:  14,
                    padding:       28,
                    display:       'flex',
                    flexDirection: 'column',
                    gap:           16,
                    position:      'relative',
                    transition:    'transform 0.15s, box-shadow 0.15s',
                  }}
                >
                  {/* Badges */}
                  {isFounding && (
                    <div style={{ position: 'absolute', top: -12, left: 20, background: '#C9A84C', color: '#060E1A', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase' }}>
                      Founding Rate
                    </div>
                  )}
                  {isCurrent && (
                    <div style={{ position: 'absolute', top: -12, right: 20, background: '#00C37A', color: '#060E1A', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase' }}>
                      Current Plan
                    </div>
                  )}

                  {/* Plan name & price */}
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>{plan.name}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 36, fontWeight: 800, color: isFounding ? '#C9A84C' : '#00C37A' }}>
                        ${plan.amount.toLocaleString()}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--t2)' }}>/month</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>{plan.description}</div>
                  </div>

                  {/* Highlights */}
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {highlights.map(h => (
                      <li key={h} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t1)' }}>
                        <span style={{ color: '#00C37A', fontWeight: 700, flexShrink: 0 }}>✓</span>
                        {h}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    onClick={() => !isCurrent && handleSubscribe(plan.key)}
                    disabled={isCurrent || isLoading}
                    style={{
                      marginTop:    'auto',
                      background:   isCurrent ? 'rgba(0,195,122,0.1)' : isFounding ? '#C9A84C' : '#00C37A',
                      color:        isCurrent ? '#00C37A' : '#060E1A',
                      border:       'none',
                      borderRadius: 10,
                      padding:      '14px 0',
                      fontSize:     14,
                      fontWeight:   700,
                      cursor:       isCurrent ? 'default' : 'pointer',
                      opacity:      isLoading ? 0.7 : 1,
                      transition:   'opacity 0.2s',
                      width:        '100%',
                    }}
                  >
                    {isLoading
                      ? 'Redirecting…'
                      : isCurrent
                      ? '✓ Current Plan'
                      : `Subscribe - $${plan.amount}/mo`}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer note */}
        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 13, color: 'var(--t2)' }}>
          Secure payment via Flutterwave · Cancel anytime · All plans include every feature
        </div>
      </div>
    </div>
  )
}
