import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Shield, Clock, TrendingUp, ArrowRight, AlertTriangle, CheckCircle, Zap } from 'lucide-react'
import { wealth as wealthApi } from '../services/api'
import useAuthStore from '../store/authStore'

const GREEN = '#00C37A'
const GOLD  = '#C9A84C'

// ─── Tag + Risk badges ────────────────────────────────────────────────────────
function Badge({ label, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.07em',
      color, background: `${color}18`, border: `1px solid ${color}30`,
      borderRadius: 6, padding: '3px 9px',
    }}>{label}</span>
  )
}

// ─── Step card ────────────────────────────────────────────────────────────────
function StepCard({ step, isLast }) {
  return (
    <div style={{ display: 'flex', gap: 16, position: 'relative' }}>
      {/* Connector line */}
      {!isLast && (
        <div style={{ position: 'absolute', left: 19, top: 44, width: 2, height: 'calc(100% + 8px)', background: 'var(--border)' }} />
      )}
      {/* Circle */}
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(0,195,122,0.08)', border: '2px solid rgba(0,195,122,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: GREEN, zIndex: 1,
      }}>
        {step.step}
      </div>
      <div style={{
        flex: 1, background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: 12, padding: '14px 18px', marginBottom: isLast ? 0 : 8,
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>{step.title}</p>
        <p style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.6, margin: 0 }}>{step.detail}</p>
      </div>
    </div>
  )
}

// ─── Veori Products ───────────────────────────────────────────────────────────
const PRODUCT_COLORS = {
  'Veori Acquire': GREEN,
  'Veori Lending': '#3B82F6',
  'Veori Tenant':  '#8B5CF6',
  'Veori Develop': GOLD,
  'Veori Title':   '#F59E0B',
  'Veori Credits': '#10B981',
  'Veori Home':    '#EC4899',
}

export default function WealthStrategy() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const { user }  = useAuthStore()
  const [strategy, setStrategy] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    wealthApi.getStrategy(id)
      .then(res => {
        setStrategy(res.data?.strategy)
        // Mark as viewed for score
        if (user?.id) {
          wealthApi.updateProgress({ strategy_id: id, status: 'viewed' }).catch(() => {})
        }
      })
      .catch(err => console.error('Strategy load error:', err))
      .finally(() => setLoading(false))
  }, [id, user?.id])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid var(--border)`, borderTopColor: GREEN, animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!strategy) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
        <p style={{ fontSize: 16, color: 'var(--t2)' }}>Strategy not found.</p>
        <button onClick={() => navigate('/wealth')} style={{ color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
          ← Back to Playbook
        </button>
      </div>
    )
  }

  const tagColor  = strategy.tag === 'BEGINNER' ? GREEN : strategy.tag === 'INTERMEDIATE' ? '#3B82F6' : '#8B5CF6'
  const riskColor = strategy.risk_level === 'LOW' ? GREEN : strategy.risk_level === 'MEDIUM' ? '#FF9500' : '#FF4444'

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 28px 60px' }}>
      {/* Back */}
      <button
        onClick={() => navigate('/wealth')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--t4)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, marginBottom: 28, padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--t2)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--t4)'}
      >
        <ChevronLeft size={14} /> Back to Playbook
      </button>

      {/* Strategy Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <Badge label={strategy.tag} color={tagColor} />
          <Badge label={`${strategy.risk_level} RISK`} color={riskColor} />
        </div>
        <h1 style={{ fontSize: 34, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 10 }}>
          {strategy.name}
        </h1>
        <p style={{ fontSize: 17, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 20 }}>{strategy.headline}</p>

        {/* Quick stats */}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={14} style={{ color: 'var(--t4)' }} />
            <div>
              <p style={{ fontSize: 10, color: 'var(--t4)', letterSpacing: '0.06em', margin: 0 }}>TIMELINE</p>
              <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0, fontWeight: 500 }}>{strategy.estimated_timeline}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={14} style={{ color: GREEN }} />
            <div>
              <p style={{ fontSize: 10, color: 'var(--t4)', letterSpacing: '0.06em', margin: 0 }}>POTENTIAL RETURN</p>
              <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0, fontWeight: 500 }}>{strategy.potential_return}</p>
            </div>
          </div>
        </div>
      </div>

      {/* What it is */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', marginBottom: 12, letterSpacing: '-0.01em' }}>What Is It?</h2>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 20 }}>
          <p style={{ fontSize: 14, color: 'var(--t2)', lineHeight: 1.8, margin: 0 }}>{strategy.what_it_is}</p>
        </div>
      </section>

      {/* How it works */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', marginBottom: 20, letterSpacing: '-0.01em' }}>How It Works — Step by Step</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(strategy.how_it_works || []).map((step, i) => (
            <StepCard key={i} step={step} isLast={i === (strategy.how_it_works.length - 1)} />
          ))}
        </div>
      </section>

      {/* Real Example */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', marginBottom: 12, letterSpacing: '-0.01em' }}>Real Example with Numbers</h2>
        <div style={{
          background: 'linear-gradient(135deg, rgba(0,195,122,0.06) 0%, rgba(201,168,76,0.03) 100%)',
          border: '1px solid rgba(0,195,122,0.15)',
          borderRadius: 14, padding: 20,
        }}>
          <p style={{ fontSize: 14, color: 'var(--t2)', lineHeight: 1.8, margin: '0 0 12px' }}>{strategy.real_example}</p>
          <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>
            These are illustrative examples with 2026 market assumptions. Individual results vary significantly. Not financial advice.
          </p>
        </div>
      </section>

      {/* Veori Connection */}
      {strategy.veori_products?.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', marginBottom: 12, letterSpacing: '-0.01em' }}>How Veori Executes This</h2>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 20 }}>
            <p style={{ fontSize: 14, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 16 }}>{strategy.veori_connection}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {strategy.veori_products.map(product => (
                <span key={product} style={{
                  fontSize: 12, fontWeight: 500,
                  color: PRODUCT_COLORS[product] || GREEN,
                  background: `${PRODUCT_COLORS[product] || GREEN}12`,
                  border: `1px solid ${PRODUCT_COLORS[product] || GREEN}28`,
                  borderRadius: 8, padding: '5px 12px',
                }}>
                  {product}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Risks */}
      {strategy.risks?.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--t1)', marginBottom: 12, letterSpacing: '-0.01em' }}>Risks & Considerations</h2>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {strategy.risks.map((risk, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <AlertTriangle size={14} style={{ color: '#FF9500', marginTop: 2, flexShrink: 0 }} />
                  <p style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.5, margin: 0 }}>{risk}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,195,122,0.08) 0%, rgba(201,168,76,0.04) 100%)',
        border: '1px solid rgba(0,195,122,0.2)',
        borderRadius: 16, padding: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>Ready to execute this strategy?</p>
          <p style={{ fontSize: 13, color: 'var(--t3)', margin: 0 }}>Veori automates every step — find the deal, structure the financing, close it.</p>
        </div>
        <button
          onClick={() => navigate(strategy.action_path || '/campaigns')}
          style={{
            background: GREEN, color: '#000', border: 'none',
            borderRadius: 10, padding: '12px 24px',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {strategy.action_label || 'Get Started'} <ArrowRight size={14} />
        </button>
      </div>

      {/* Legal footer */}
      <div style={{ marginTop: 40, padding: '16px 0', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: 11, color: 'var(--t4)', lineHeight: 1.7 }}>
          Veori Wealth Playbook is for educational purposes only. The strategies, projections, and examples presented are illustrative and do not constitute financial, legal, or investment advice. Real estate investment involves risk including potential loss of principal. Individual results vary significantly. Always consult a licensed financial advisor, real estate attorney, and tax professional before making investment decisions.
        </p>
      </div>
    </div>
  )
}
