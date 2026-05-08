import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, DollarSign, TrendingUp, Home, Target, AlertCircle } from 'lucide-react'
import { wealth as wealthApi } from '../services/api'

const GREEN = '#00C37A'
const GOLD  = '#C9A84C'

function formatDollar(n) {
  if (!n && n !== 0) return '$0'
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n).toLocaleString()}`
}

function InputField({ label, prefix = '$', value, onChange, placeholder = '0' }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--t4)', fontWeight: 500, display: 'block', marginBottom: 6 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--t4)' }}>{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          placeholder={placeholder}
          style={{
            width: '100%', padding: `10px 12px 10px ${prefix ? '24px' : '12px'}`,
            background: 'var(--input-bg)', border: '1px solid var(--input-border)',
            borderRadius: 10, fontSize: 14, color: 'var(--input-text)',
            outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={e => e.target.style.borderColor = 'rgba(0,195,122,0.5)'}
          onBlur={e => e.target.style.borderColor = 'var(--input-border)'}
        />
      </div>
    </div>
  )
}

function ProjectionCard({ label, veoriValue, savingsValue, veoriIncome, accent }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 20, flex: 1 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em', marginBottom: 16 }}>{label}</p>
      {/* Veori scenario */}
      <div style={{ marginBottom: 14, padding: '12px 14px', background: 'rgba(0,195,122,0.06)', border: '1px solid rgba(0,195,122,0.12)', borderRadius: 10 }}>
        <p style={{ fontSize: 10, color: GREEN, fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>WITH VEORI</p>
        <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 2 }}>{formatDollar(veoriValue)}</p>
        {veoriIncome > 0 && <p style={{ fontSize: 12, color: GREEN, margin: 0 }}>{formatDollar(veoriIncome)}/month passive income</p>}
      </div>
      {/* Savings scenario */}
      <div style={{ padding: '10px 14px', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <p style={{ fontSize: 10, color: 'var(--t4)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>SAVINGS ACCOUNT (4%)</p>
        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--t3)', margin: 0 }}>{formatDollar(savingsValue)}</p>
      </div>
      {/* Difference */}
      {veoriValue > savingsValue && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>+{formatDollar(veoriValue - savingsValue)} more</span>
          <span style={{ fontSize: 11, color: 'var(--t4)' }}> vs doing nothing</span>
        </div>
      )}
    </div>
  )
}

function MiniBarChart({ data, maxVal }) {
  const barCount = Math.min(data.length, 24) // show 2-year overview
  const visible  = data.slice(0, barCount)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
      {visible.map((d, i) => {
        const h = maxVal > 0 ? Math.max(4, (d.income / maxVal) * 80) : 4
        return (
          <div
            key={i}
            title={`Month ${d.month}: ${formatDollar(d.income)}/mo`}
            style={{
              flex: 1, height: h,
              background: `rgba(0,195,122,${0.3 + (i / barCount) * 0.7})`,
              borderRadius: 3,
              transition: 'height 0.5s ease',
            }}
          />
        )
      })}
    </div>
  )
}

export default function WealthCalculatorPage() {
  const navigate = useNavigate()

  const [inputs, setInputs] = useState({
    home_value: '',
    mortgage_balance: '',
    monthly_income: '',
    monthly_expenses: '',
    current_savings: '',
    monthly_investment: '',
    investment_goal: 'passive_income',
  })
  const [results, setResults]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const set = (key) => (val) => setInputs(prev => ({ ...prev, [key]: val }))

  const handleCalculate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await wealthApi.calculate(inputs)
      if (res.data?.results) setResults(res.data.results)
    } catch (err) {
      setError('Calculation failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const maxIncome = results?.income_timeline ? Math.max(...results.income_timeline.slice(0, 24).map(d => d.income)) : 0

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 28px 60px' }}>
      {/* Header */}
      <button
        onClick={() => navigate('/wealth')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--t4)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, marginBottom: 28, padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--t2)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--t4)'}
      >
        <ChevronLeft size={14} /> Back to Playbook
      </button>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <DollarSign size={18} style={{ color: GREEN }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.10em' }}>WEALTH CALCULATOR</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 8 }}>
          See What Your Money Could Become
        </h1>
        <p style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.6 }}>
          Enter your numbers and compare your wealth trajectory — investing through Veori vs leaving money in a savings account.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, alignItems: 'start' }}>
        {/* Input form */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: 24 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)', marginBottom: 20 }}>Your Numbers</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.06em', marginBottom: 12 }}>HOME (if you own)</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <InputField label="Home Value" value={inputs.home_value} onChange={set('home_value')} placeholder="320,000" />
                <InputField label="Mortgage Balance" value={inputs.mortgage_balance} onChange={set('mortgage_balance')} placeholder="200,000" />
              </div>
            </div>

            <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.06em', marginBottom: 12 }}>MONTHLY CASH FLOW</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <InputField label="Monthly Income" value={inputs.monthly_income} onChange={set('monthly_income')} placeholder="8,000" />
                <InputField label="Monthly Expenses" value={inputs.monthly_expenses} onChange={set('monthly_expenses')} placeholder="5,500" />
              </div>
            </div>

            <div>
              <p style={{ fontSize: 11, color: 'var(--t4)', letterSpacing: '0.06em', marginBottom: 12 }}>SAVINGS & INVESTMENT</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <InputField label="Current Savings" value={inputs.current_savings} onChange={set('current_savings')} placeholder="15,000" />
                <InputField label="Monthly Amount to Invest" value={inputs.monthly_investment} onChange={set('monthly_investment')} placeholder="500" />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--t4)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Investment Goal</label>
              <select
                value={inputs.investment_goal}
                onChange={e => set('investment_goal')(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                  borderRadius: 10, fontSize: 14, color: 'var(--input-text)', outline: 'none',
                }}
              >
                <option value="passive_income">Earn Passive Income</option>
                <option value="portfolio">Build a Property Portfolio</option>
                <option value="homeownership">Buy My First Home</option>
                <option value="all">All Three</option>
              </select>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(255,68,68,0.06)', border: '1px solid rgba(255,68,68,0.2)', borderRadius: 8, fontSize: 12, color: '#FF4444' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleCalculate}
            disabled={loading}
            style={{
              marginTop: 20, width: '100%',
              background: GREEN, color: '#000', border: 'none',
              borderRadius: 10, padding: '13px 0',
              fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Calculating…' : 'Calculate My Wealth Trajectory'}
          </button>
        </div>

        {/* Results */}
        {results ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* HELOC potential */}
            {results.heloc_potential > 0 && (
              <div style={{ background: 'linear-gradient(135deg, rgba(0,195,122,0.08) 0%, transparent 100%)', border: '1px solid rgba(0,195,122,0.2)', borderRadius: 14, padding: 20, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <Home size={22} style={{ color: GREEN, flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: GREEN, letterSpacing: '0.06em', marginBottom: 4 }}>YOUR HELOC POTENTIAL</p>
                  <p style={{ fontSize: 26, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>{formatDollar(results.heloc_potential)}</p>
                  <p style={{ fontSize: 13, color: 'var(--t3)', margin: 0, lineHeight: 1.5 }}>
                    Available to use as a down payment on investment properties. At {formatDollar(results.heloc_potential)} you could fund a down payment on a property worth {formatDollar(results.heloc_potential / 0.22)}.
                  </p>
                </div>
              </div>
            )}

            {/* Projections */}
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em', marginBottom: 14 }}>5-YEAR WEALTH PROJECTION</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <ProjectionCard
                  label="YEAR 1"
                  veoriValue={results.veori.year1}
                  savingsValue={results.savings.year1}
                  veoriIncome={results.veori.income1}
                />
                <ProjectionCard
                  label="YEAR 3"
                  veoriValue={results.veori.year3}
                  savingsValue={results.savings.year3}
                  veoriIncome={results.veori.income3}
                />
                <ProjectionCard
                  label="YEAR 5"
                  veoriValue={results.veori.year5}
                  savingsValue={results.savings.year5}
                  veoriIncome={results.veori.income5}
                />
              </div>
            </div>

            {/* Income timeline chart */}
            {results.income_timeline?.length > 0 && (
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t4)', letterSpacing: '0.08em', margin: 0 }}>MONTHLY PASSIVE INCOME GROWTH</p>
                    <p style={{ fontSize: 11, color: 'var(--t4)', margin: '2px 0 0' }}>First 24 months investing through Veori</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 11, color: 'var(--t4)', margin: 0 }}>Month 24</p>
                    <p style={{ fontSize: 16, fontWeight: 700, color: GREEN, margin: 0 }}>
                      {formatDollar(results.income_timeline[23]?.income || 0)}/mo
                    </p>
                  </div>
                </div>
                <MiniBarChart data={results.income_timeline} maxVal={maxIncome} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--t4)' }}>Month 1</span>
                  <span style={{ fontSize: 10, color: 'var(--t4)' }}>Month 24</span>
                </div>
              </div>
            )}

            {/* First Move */}
            {results.first_move && (
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: 20, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <Target size={20} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: GOLD, letterSpacing: '0.06em', marginBottom: 6 }}>YOUR FIRST MOVE</p>
                  <p style={{ fontSize: 14, color: 'var(--t2)', lineHeight: 1.6, margin: 0 }}>{results.first_move}</p>
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div style={{ padding: '14px 16px', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertCircle size={14} style={{ color: 'var(--t4)', flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: 'var(--t4)', lineHeight: 1.6, margin: 0 }}>
                  These projections are illustrative and based on assumptions that may not reflect your actual results. Past performance does not guarantee future results. Consult a licensed financial advisor before making investment decisions. Real estate investment involves risk including potential loss of principal.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: 40, textAlign: 'center' }}>
            <TrendingUp size={40} style={{ color: 'var(--t4)', marginBottom: 16 }} />
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--t3)', marginBottom: 8 }}>Enter your numbers on the left</p>
            <p style={{ fontSize: 13, color: 'var(--t4)' }}>We'll show you exactly what your financial future looks like — with Veori and without it.</p>
          </div>
        )}
      </div>
    </div>
  )
}
