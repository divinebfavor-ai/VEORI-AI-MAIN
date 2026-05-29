import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ChevronRight, ChevronLeft, CheckCircle, TrendingUp, Zap, Clock, DollarSign, Star, RefreshCw, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import useAuthStore from '../store/authStore'
import { wealth as wealthApi } from '../services/api'

// ─── Design tokens (match existing glass system) ──────────────────────────────
const GREEN  = '#00C37A'
const GOLD   = '#C9A84C'

// ─── Assessment Questions ─────────────────────────────────────────────────────
const QUESTIONS = [
  {
    id: 'home_ownership',
    question: 'Do you currently own a home?',
    options: ['Yes, I own a home', 'No, I rent', 'I own multiple properties'],
  },
  {
    id: 'equity_position',
    question: null, // dynamic based on Q1
    optionsFn: (answers) => {
      if (answers.home_ownership === 'No, I rent') {
        return {
          question: 'What is your approximate monthly income?',
          options: ['Under $3,000', '$3,000 to $5,000', '$5,000 to $10,000', 'Over $10,000'],
        }
      }
      return {
        question: 'Approximately how much equity do you have in your home?',
        options: ['Under $25,000', '$25,000 to $75,000', '$75,000 to $150,000', '$150,000 to $300,000', 'Over $300,000', 'Not sure'],
      }
    },
  },
  {
    id: 'debt_situation',
    question: 'What is your current debt situation?',
    options: ['Minimal debt, mostly clear', 'Some credit card and personal loan debt', 'Significant debt I am working to pay down', 'Mortgage only', 'No debt at all'],
  },
  {
    id: 'real_estate_goal',
    question: 'What is your primary real estate goal?',
    options: ['Earn passive income', 'Build a property portfolio', 'Buy my first home', 'Learn wholesale real estate', 'All of the above'],
  },
  {
    id: 'experience_level',
    question: 'How would you describe your real estate experience?',
    options: ['Complete beginner', 'I understand the basics', 'I have done a few deals', 'I am an experienced investor'],
  },
]

// ─── Wealth Score Gauge ───────────────────────────────────────────────────────
function WealthGauge({ score = 0, size = 120 }) {
  const r   = (size / 2) - 12
  const circ = 2 * Math.PI * r
  const pct  = score / 100
  const dash = circ * pct
  const tierColor = score >= 76 ? GOLD : score >= 51 ? '#8B5CF6' : score >= 26 ? '#3B82F6' : GREEN

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={tierColor} strokeWidth={8}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size === 120 ? 26 : 20, fontWeight: 700, color: tierColor, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 10, color: 'var(--t4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>score</span>
      </div>
    </div>
  )
}

// ─── Risk Badge ───────────────────────────────────────────────────────────────
function RiskBadge({ level }) {
  const colors = { LOW: GREEN, MEDIUM: '#FF9500', HIGH: '#FF4444' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
      color: colors[level] || 'var(--t3)',
      background: `${colors[level] || 'var(--t3)'}18`,
      border: `1px solid ${colors[level] || 'var(--t3)'}30`,
      borderRadius: 5, padding: '2px 7px',
    }}>
      {level} RISK
    </span>
  )
}

// ─── Tag Badge ────────────────────────────────────────────────────────────────
function TagBadge({ tag }) {
  const colors = { BEGINNER: GREEN, INTERMEDIATE: '#3B82F6', ADVANCED: '#8B5CF6' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
      color: colors[tag] || 'var(--t3)',
      background: `${colors[tag] || 'var(--t3)'}18`,
      border: `1px solid ${colors[tag] || 'var(--t3)'}30`,
      borderRadius: 5, padding: '2px 7px',
    }}>
      {tag}
    </span>
  )
}

// ─── Strategy Card ────────────────────────────────────────────────────────────
function StrategyCard({ strategy, isPrimary = false, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: isPrimary
          ? `linear-gradient(135deg, rgba(0,195,122,0.08) 0%, rgba(201,168,76,0.05) 100%)`
          : hov ? 'var(--card-bg-hover)' : 'var(--card-bg)',
        border: `1px solid ${isPrimary ? 'rgba(0,195,122,0.25)' : hov ? 'var(--card-border-hover)' : 'var(--card-border)'}`,
        borderRadius: 16,
        padding: isPrimary ? 24 : 20,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        transform: hov ? 'translateY(-2px)' : 'none',
        boxShadow: hov ? '0 8px 32px rgba(0,0,0,0.15)' : 'none',
      }}
    >
      {isPrimary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Star size={12} fill={GOLD} stroke={GOLD} />
          <span style={{ fontSize: 11, fontWeight: 600, color: GOLD, letterSpacing: '0.08em' }}>PRIMARY STRATEGY</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: isPrimary ? 18 : 15, fontWeight: 600, color: 'var(--t1)', margin: '0 0 4px', lineHeight: 1.3 }}>{strategy.name}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <TagBadge tag={strategy.tag} />
            <RiskBadge level={strategy.risk_level} />
          </div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--t4)', flexShrink: 0, marginTop: 4 }} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, margin: '0 0 12px' }}>{strategy.headline}</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Clock size={12} style={{ color: 'var(--t4)' }} />
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>{strategy.estimated_timeline}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <TrendingUp size={12} style={{ color: GREEN }} />
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>{strategy.potential_return}</span>
        </div>
      </div>
      {isPrimary && (
        <button style={{
          marginTop: 16, width: '100%',
          background: GREEN, color: '#000',
          border: 'none', borderRadius: 10,
          padding: '10px 0', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', letterSpacing: '-0.01em',
        }}>
          Start This Strategy →
        </button>
      )}
    </div>
  )
}

// ─── Elite Moves Feed Item ────────────────────────────────────────────────────
function FeedItem({ item }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(0,195,122,0.10)', border: '1px solid rgba(0,195,122,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: GREEN,
      }}>
        {item.user_initials}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t2)' }}>{item.user_city}, {item.user_state}</span>
          <span style={{ fontSize: 10, color: 'var(--t4)', background: 'var(--surface-bg-2)', borderRadius: 4, padding: '1px 6px' }}>{item.strategy_used}</span>
          {item.is_example && <span style={{ fontSize: 9, color: 'var(--t4)', letterSpacing: '0.05em' }}>EXAMPLE</span>}
        </div>
        <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0, lineHeight: 1.5 }}>{item.result_description}</p>
        {item.days_to_result && <p style={{ fontSize: 11, color: GREEN, margin: '4px 0 0', fontWeight: 500 }}>{item.days_to_result} days</p>}
      </div>
    </div>
  )
}

// ─── Assessment Screen ────────────────────────────────────────────────────────
function AssessmentScreen({ onComplete }) {
  const [step, setStep]       = useState(0)
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)

  const getQuestion = (idx) => {
    const q = QUESTIONS[idx]
    if (q.optionsFn) return q.optionsFn(answers)
    return { question: q.question, options: q.options }
  }

  const current   = getQuestion(step)
  const fieldId   = QUESTIONS[step].id
  const selected  = answers[fieldId]
  const progress  = ((step) / QUESTIONS.length) * 100

  const handleSelect = async (option) => {
    const newAnswers = { ...answers, [fieldId]: option }
    setAnswers(newAnswers)

    if (step < QUESTIONS.length - 1) {
      setTimeout(() => setStep(s => s + 1), 280)
    } else {
      // Final answer - submit
      setLoading(true)
      try {
        const res = await wealthApi.submitAssessment(newAnswers)
        const playbook = res.data?.playbook
        if (playbook) {
          onComplete(playbook)
        } else {
          toast.error('Could not generate your playbook. Please try again.')
          setLoading(false)
        }
      } catch (err) {
        console.error('Assessment submit error:', err)
        const msg = err?.response?.data?.error || 'Something went wrong. Please try again.'
        toast.error(msg)
        setLoading(false)
      }
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', border: `3px solid var(--border)`, borderTopColor: GREEN, animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: 16, color: 'var(--t2)', fontWeight: 500 }}>Building your personalized playbook…</p>
        <p style={{ fontSize: 13, color: 'var(--t4)' }}>Our AI is analyzing your situation and selecting the best strategies</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 24px' }}>
      {/* Progress bar */}
      <div style={{ marginBottom: 48 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--t4)', letterSpacing: '0.05em' }}>WEALTH ASSESSMENT</span>
          <span style={{ fontSize: 12, color: 'var(--t4)' }}>{step + 1} of {QUESTIONS.length}</span>
        </div>
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: GREEN, borderRadius: 2, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* Question */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.3, marginBottom: 8, letterSpacing: '-0.02em' }}>
          {current.question}
        </h1>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {current.options.map((option) => (
          <button
            key={option}
            onClick={() => handleSelect(option)}
            style={{
              width: '100%', textAlign: 'left',
              padding: '16px 20px',
              background: selected === option ? 'rgba(0,195,122,0.08)' : 'var(--card-bg)',
              border: `1px solid ${selected === option ? 'rgba(0,195,122,0.4)' : 'var(--card-border)'}`,
              borderRadius: 12, cursor: 'pointer',
              fontSize: 15, fontWeight: selected === option ? 500 : 400,
              color: selected === option ? 'var(--t1)' : 'var(--t2)',
              transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
            onMouseEnter={e => { if (selected !== option) { e.currentTarget.style.background = 'var(--card-bg-hover)'; e.currentTarget.style.borderColor = 'var(--card-border-hover)' }}}
            onMouseLeave={e => { if (selected !== option) { e.currentTarget.style.background = 'var(--card-bg)'; e.currentTarget.style.borderColor = 'var(--card-border)' }}}
          >
            {option}
            {selected === option && <CheckCircle size={18} style={{ color: GREEN, flexShrink: 0 }} />}
          </button>
        ))}
      </div>

      {/* Back */}
      {step > 0 && (
        <button
          onClick={() => setStep(s => s - 1)}
          style={{ marginTop: 24, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <ChevronLeft size={14} /> Back
        </button>
      )}
    </div>
  )
}

// ─── Playbook Dashboard ───────────────────────────────────────────────────────
function PlaybookDashboard({ playbook, score, feed, onRefresh, refreshing, onRetake }) {
  const navigate    = useNavigate()
  const [actionDone, setActionDone] = useState(false)
  const primary = playbook?.strategies?.find(s => s.id === playbook.primary_strategy) || playbook?.strategies?.[0]
  const others  = playbook?.strategies?.filter(s => s.id !== playbook.primary_strategy) || []

  const tier      = score >= 76 ? 'Elite' : score >= 51 ? 'Investor' : score >= 26 ? 'Builder' : 'Learner'
  const tierColor = score >= 76 ? GOLD : score >= 51 ? '#8B5CF6' : score >= 26 ? '#3B82F6' : GREEN

  const handleStrategyClick = (strategyId) => {
    navigate(`/wealth/strategy/${strategyId}`)
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <BookOpen size={18} style={{ color: GREEN }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Your Wealth Playbook</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.3, marginBottom: 10, letterSpacing: '-0.02em' }}>
            {playbook?.headline}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.7, maxWidth: 620 }}>{playbook?.summary}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <WealthGauge score={score} size={120} />
          <span style={{ fontSize: 12, fontWeight: 600, color: tierColor }}>{tier}</span>
          <button
            onClick={onRetake}
            style={{ fontSize: 11, color: 'var(--t4)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            Start Over
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            style={{ fontSize: 11, color: 'var(--t4)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={10} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* First Action Banner */}
      {playbook?.first_action && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(0,195,122,0.08) 0%, rgba(201,168,76,0.05) 100%)',
          border: '1px solid rgba(0,195,122,0.2)',
          borderRadius: 14, padding: '16px 20px',
          display: 'flex', alignItems: 'flex-start', gap: 16,
          marginBottom: 32,
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,195,122,0.12)', border: '1px solid rgba(0,195,122,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Zap size={18} style={{ color: GREEN }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: GREEN, letterSpacing: '0.06em', marginBottom: 4 }}>YOUR NEXT 7 DAYS</p>
            <p style={{ fontSize: 14, color: 'var(--t1)', lineHeight: 1.6, margin: 0 }}>{playbook.first_action}</p>
          </div>
          <button
            onClick={() => setActionDone(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: actionDone ? GREEN : 'var(--t4)', flexShrink: 0, paddingTop: 2 }}
            title={actionDone ? 'Mark incomplete' : 'Mark complete'}
          >
            <CheckCircle size={22} fill={actionDone ? GREEN : 'none'} />
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, marginBottom: 32 }}>
        {/* Left column - strategies */}
        <div>
          {/* Primary strategy */}
          {primary && (
            <div style={{ marginBottom: 20 }}>
              <StrategyCard strategy={primary} isPrimary onClick={() => handleStrategyClick(primary.id)} />
            </div>
          )}

          {/* Other strategies grid */}
          {others.length > 0 && (
            <>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em', marginBottom: 14 }}>MORE STRATEGIES FOR YOU</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {others.map(strategy => (
                  <StrategyCard key={strategy.id} strategy={strategy} onClick={() => handleStrategyClick(strategy.id)} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Wealth Projection */}
          {playbook?.wealth_projection && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em', marginBottom: 16 }}>WEALTH PROJECTION</p>
              {['year_1', 'year_3', 'year_5'].map((key, i) => (
                <div key={key} style={{ marginBottom: i < 2 ? 14 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? 'var(--t4)' : i === 1 ? GREEN : GOLD }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.06em' }}>YEAR {[1,3,5][i]}</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, margin: 0, paddingLeft: 14 }}>{playbook.wealth_projection[key]}</p>
                </div>
              ))}
              <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--surface-bg)', borderRadius: 8 }}>
                <p style={{ fontSize: 10, color: 'var(--t4)', lineHeight: 1.5, margin: 0 }}>
                  {playbook.wealth_projection.key_assumption} - Projections are illustrative. Results vary. Consult a financial advisor.
                </p>
              </div>
            </div>
          )}

          {/* Wealth Calculator CTA */}
          <button
            onClick={() => navigate('/wealth/calculator')}
            style={{
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: 16, padding: 20, cursor: 'pointer', textAlign: 'left',
              transition: 'all 0.2s ease', width: '100%',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-bg-hover)'; e.currentTarget.style.borderColor = 'var(--card-border-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--card-bg)'; e.currentTarget.style.borderColor = 'var(--card-border)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={16} style={{ color: GREEN }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>Wealth Calculator</span>
              </div>
              <ArrowRight size={14} style={{ color: 'var(--t4)' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.5, margin: 0 }}>Enter your numbers - see your 5-year wealth projection side by side with doing nothing.</p>
          </button>

          {/* Elite Moves Feed */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em', marginBottom: 4 }}>ELITE MOVES</p>
            <p style={{ fontSize: 11, color: 'var(--t4)', marginBottom: 12 }}>Real results from the Veori community</p>
            {feed.slice(0, 4).map((item, i) => <FeedItem key={i} item={item} />)}
          </div>
        </div>
      </div>

      {/* Legal footer */}
      <div style={{ padding: '20px 0', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: 11, color: 'var(--t4)', lineHeight: 1.7, maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
          Veori Wealth Playbook is for educational purposes only. The strategies, projections, and examples presented are illustrative and do not constitute financial, legal, or investment advice. Real estate investment involves risk including potential loss of principal. Individual results vary significantly. Always consult a licensed financial advisor, real estate attorney, and tax professional before making investment decisions.
        </p>
      </div>
    </div>
  )
}

// ─── Welcome Screen (first visit) ─────────────────────────────────────────────
function WelcomeScreen({ onStart }) {
  return (
    <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(0,195,122,0.08)', border: '1px solid rgba(0,195,122,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
        <BookOpen size={28} style={{ color: GREEN }} />
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 12, lineHeight: 1.2 }}>
        Your Wealth Playbook
      </h1>
      <p style={{ fontSize: 15, color: 'var(--t3)', lineHeight: 1.7, marginBottom: 8 }}>
        Answer 5 quick questions and our AI builds a personalized real estate wealth plan designed specifically for your situation - connected directly to live Veori deals and tools.
      </p>
      <p style={{ fontSize: 13, color: 'var(--t4)', lineHeight: 1.6, marginBottom: 36 }}>
        Takes 90 seconds. The strategies you get are executable today.
      </p>
      <button
        onClick={onStart}
        style={{
          background: GREEN, color: '#000', border: 'none',
          borderRadius: 12, padding: '14px 32px',
          fontSize: 15, fontWeight: 600, cursor: 'pointer',
          letterSpacing: '-0.01em',
        }}
      >
        Build My Playbook →
      </button>
      <p style={{ marginTop: 20, fontSize: 11, color: 'var(--t4)' }}>
        Not financial advice. Educational purposes only.
      </p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WealthPlaybook() {
  const { user }     = useAuthStore()
  const [phase, setPhase]           = useState('loading') // loading | welcome | assessment | dashboard
  const [playbook, setPlaybook]     = useState(null)
  const [score, setScore]           = useState(0)
  const [feed, setFeed]             = useState([])
  const [refreshing, setRefreshing] = useState(false)

  const loadData = useCallback(async () => {
    if (!user?.id) return
    try {
      const [checkRes, scoreRes, feedRes] = await Promise.all([
        wealthApi.checkAssessment().catch(() => ({ data: { has_assessment: false } })),
        wealthApi.getScore(user.id).catch(() => ({ data: { score: 0 } })),
        wealthApi.getFeed().catch(() => ({ data: { feed: [] } })),
      ])

      setScore(scoreRes.data?.score || 0)
      setFeed(feedRes.data?.feed || [])

      if (checkRes.data?.has_assessment) {
        const pbRes = await wealthApi.getPlaybook(user.id).catch(() => null)
        if (pbRes?.data?.playbook) {
          setPlaybook(pbRes.data.playbook)
          setPhase('dashboard')
        } else {
          setPhase('welcome')
        }
      } else {
        setPhase('welcome')
      }
    } catch (err) {
      console.error('WealthPlaybook load error:', err)
      setPhase('welcome')
    }
  }, [user?.id])

  useEffect(() => { loadData() }, [loadData])

  const handleAssessmentComplete = (pb) => {
    setPlaybook(pb)
    setScore(prev => Math.min(100, prev + 10))
    setPhase('dashboard')
  }

  const handleRetake = () => {
    setPlaybook(null)
    setPhase('assessment')
  }

  const handleRefresh = async () => {
    if (!user?.id || refreshing) return
    setRefreshing(true)
    try {
      const res = await wealthApi.regeneratePlaybook(user.id)
      if (res.data?.playbook) setPlaybook(res.data.playbook)
    } catch (err) {
      console.error('Refresh error:', err)
    } finally {
      setRefreshing(false)
    }
  }

  if (phase === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid var(--border)`, borderTopColor: GREEN, animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (phase === 'welcome') return <WelcomeScreen onStart={() => setPhase('assessment')} />
  if (phase === 'assessment') return <AssessmentScreen onComplete={handleAssessmentComplete} />

  return (
    <PlaybookDashboard
      playbook={playbook}
      score={score}
      feed={feed}
      onRefresh={handleRefresh}
      refreshing={refreshing}
      onRetake={handleRetake}
    />
  )
}
