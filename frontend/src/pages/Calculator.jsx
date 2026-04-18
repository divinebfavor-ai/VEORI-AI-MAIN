import React, { useState } from 'react'
import { Calculator as CalcIcon, RefreshCw } from 'lucide-react'
import Button from '../components/ui/Button'

const SCENARIO_LABELS = {
  conservative: { label: 'Conservative', arvMult: 0.90, repairMult: 1.20, color: 'text-warning' },
  moderate:     { label: 'Moderate',     arvMult: 1.00, repairMult: 1.00, color: 'text-text-primary' },
  aggressive:   { label: 'Aggressive',   arvMult: 1.05, repairMult: 0.90, color: 'text-primary' },
}

function fmt$(n) { return n ? '$' + Math.round(Number(n)).toLocaleString() : '$0' }

function ScenarioCol({ scenario, arvBase, repairBase }) {
  const { label, arvMult, repairMult, color } = SCENARIO_LABELS[scenario]
  const arv           = Math.round(arvBase * arvMult)
  const repairs       = Math.round(repairBase * repairMult)
  const mao           = Math.round(arv * 0.70 - repairs)
  const firstOffer    = Math.round(mao * 0.85)
  const assignmentFee = Math.round(mao * 0.15)
  const buyerProfit   = Math.round(arv - mao - repairs)
  const buyerROI      = mao > 0 ? Math.round((buyerProfit / (mao + repairs)) * 100) : 0

  return (
    <div className="bg-card border border-border-subtle rounded-lg p-6">
      <p className={`text-[15px] font-semibold mb-5 ${color}`}>{label}</p>
      <div className="space-y-0">
        {[
          ['ARV', fmt$(arv)],
          ['Repairs', fmt$(repairs)],
          ['MAO', fmt$(mao)],
          ['First Offer', fmt$(firstOffer)],
          ['Assignment Fee', fmt$(assignmentFee)],
          ['Buyer Profit', fmt$(buyerProfit)],
          ['Buyer ROI', `${buyerROI}%`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-2.5 border-b border-border-subtle last:border-0">
            <span className="label-caps">{k}</span>
            <span className={`text-[14px] font-semibold ${
              k === 'MAO' || k === 'Assignment Fee'
                ? 'text-gold'
                : k === 'First Offer'
                ? 'text-primary'
                : 'text-text-primary'
            }`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Calculator() {
  const [arv, setArv]         = useState('')
  const [repairs, setRepairs] = useState('')
  const [desired, setDesired] = useState('')

  const arvNum     = parseFloat(arv) || 0
  const repairNum  = parseFloat(repairs) || 0
  const mao        = Math.round(arvNum * 0.70 - repairNum)
  const firstOffer = Math.round(mao * 0.85)
  const assignFee  = Math.round(mao * 0.15)

  const reset = () => { setArv(''); setRepairs(''); setDesired('') }

  const inputClass = "h-[44px] w-full bg-surface border border-border-subtle rounded-[6px] px-4 text-[15px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-white">Wholesale Calculator</h1>
          <p className="text-[13px] text-text-muted mt-1">Calculate MAO, offers, and assignment fees across three scenarios</p>
        </div>
        <Button variant="secondary" onClick={reset}>
          <RefreshCw size={14} /> Reset
        </Button>
      </div>

      {/* Inputs */}
      <div className="bg-card border border-border-subtle rounded-lg p-6 mb-6">
        <h2 className="text-[15px] font-medium text-white mb-5">Property Details</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label-caps block mb-2">After Repair Value (ARV)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[14px]">$</span>
              <input
                type="number"
                value={arv}
                onChange={e => setArv(e.target.value)}
                placeholder="150,000"
                className={inputClass + " pl-7"}
              />
            </div>
          </div>
          <div>
            <label className="label-caps block mb-2">Repair Estimate</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[14px]">$</span>
              <input
                type="number"
                value={repairs}
                onChange={e => setRepairs(e.target.value)}
                placeholder="25,000"
                className={inputClass + " pl-7"}
              />
            </div>
          </div>
          <div>
            <label className="label-caps block mb-2">Desired Assignment Fee</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[14px]">$</span>
              <input
                type="number"
                value={desired}
                onChange={e => setDesired(e.target.value)}
                placeholder="10,000"
                className={inputClass + " pl-7"}
              />
            </div>
          </div>
        </div>
      </div>

      {arvNum > 0 && (
        <>
          {/* Quick summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'MAO',             value: fmt$(mao),       accent: 'text-gold',         sub: '70% Rule' },
              { label: 'First Offer',     value: fmt$(firstOffer), accent: 'text-primary',     sub: '85% of MAO' },
              { label: 'Max Assignment',  value: fmt$(assignFee), accent: 'text-gold',          sub: 'At first offer' },
              {
                label: 'Target Purchase',
                value: desired ? fmt$(mao - parseFloat(desired)) : '—',
                accent: 'text-text-primary',
                sub: desired ? 'For your fee' : 'Enter desired fee',
              },
            ].map(({ label, value, accent, sub }) => (
              <div key={label} className="bg-card border border-border-subtle rounded-lg p-5">
                <p className="label-caps mb-2">{label}</p>
                <p className={`text-[32px] font-bold leading-none ${accent}`}>{value}</p>
                <p className="text-[11px] text-text-muted mt-2">{sub}</p>
              </div>
            ))}
          </div>

          {/* Three scenarios */}
          <div className="mb-6">
            <h2 className="text-[15px] font-medium text-white mb-4">Three-Scenario Analysis</h2>
            <div className="grid grid-cols-3 gap-4">
              {['conservative', 'moderate', 'aggressive'].map(s => (
                <ScenarioCol key={s} scenario={s} arvBase={arvNum} repairBase={repairNum} />
              ))}
            </div>
          </div>

          {/* Negotiation guide */}
          <div className="bg-card border border-border-subtle rounded-lg p-6">
            <h2 className="text-[15px] font-medium text-white mb-4">Negotiation Range</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-elevated rounded-[6px]">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Opening offer (anchor low)</p>
                  <p className="text-[11px] text-text-muted">Start here — leaves room to negotiate</p>
                </div>
                <p className="text-[18px] font-bold text-primary">{fmt$(firstOffer)}</p>
              </div>
              <div className="flex items-center justify-between p-3 bg-elevated rounded-[6px]">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">Midpoint (splitting the diff)</p>
                  <p className="text-[11px] text-text-muted">If seller counters above MAO</p>
                </div>
                <p className="text-[18px] font-bold text-text-primary">{fmt$(Math.round((firstOffer + mao) / 2))}</p>
              </div>
              <div className="flex items-center justify-between p-3 bg-elevated rounded-[6px] border border-gold/20">
                <div>
                  <p className="text-[13px] font-medium text-gold">Maximum offer (MAO)</p>
                  <p className="text-[11px] text-text-muted">Never exceed this — walk away if seller is above</p>
                </div>
                <p className="text-[18px] font-bold text-gold">{fmt$(mao)}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {!arvNum && (
        <div className="bg-card border border-border-subtle rounded-lg py-24 text-center">
          <CalcIcon size={36} className="text-text-muted mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[15px] text-text-primary mb-1">Enter ARV and repair estimate to calculate</p>
          <p className="text-[13px] text-text-muted">Three scenarios will appear automatically</p>
        </div>
      )}
    </div>
  )
}
