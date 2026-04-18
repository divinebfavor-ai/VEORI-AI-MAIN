import React, { useState, useCallback } from 'react'
import { Wrench } from 'lucide-react'
import Button from './Button'

const REPAIR_ITEMS = {
  roof:        { label: 'Roof',             options: [{ id: 'minor',    label: 'Minor repairs',         min: 2000,  max: 5000  }, { id: 'partial',  label: 'Partial replacement',     min: 5000,  max: 12000 }, { id: 'full',     label: 'Full replacement',         min: 10000, max: 22000 }] },
  hvac:        { label: 'HVAC',             options: [{ id: 'service',  label: 'Service/tune-up',       min: 500,   max: 500   }, { id: 'repair',   label: 'Repair',                  min: 1000,  max: 3000  }, { id: 'full',     label: 'Full replacement',         min: 5000,  max: 12000 }] },
  plumbing:    { label: 'Plumbing',         options: [{ id: 'minor',    label: 'Minor repairs',         min: 500,   max: 2000  }, { id: 'major',    label: 'Major repairs',           min: 3000,  max: 8000  }, { id: 'repipe',   label: 'Full repipe',              min: 8000,  max: 20000 }] },
  electrical:  { label: 'Electrical',       options: [{ id: 'panel',    label: 'Panel upgrade',         min: 2000,  max: 5000  }, { id: 'rewire',   label: 'Full rewire',             min: 8000,  max: 20000 }] },
  foundation:  { label: 'Foundation',       options: [{ id: 'minor',    label: 'Minor repairs',         min: 3000,  max: 8000  }, { id: 'major',    label: 'Major repairs',           min: 15000, max: 50000 }] },
  kitchen:     { label: 'Kitchen',          options: [{ id: 'cosmetic', label: 'Cosmetic update',       min: 3000,  max: 8000  }, { id: 'semi',     label: 'Semi renovation',         min: 8000,  max: 20000 }, { id: 'full',     label: 'Full gut',                 min: 20000, max: 50000 }] },
  bathrooms:   { label: 'Bathrooms (ea.)',  options: [{ id: 'cosmetic', label: 'Cosmetic update',       min: 2000,  max: 5000  }, { id: 'full',     label: 'Full renovation',         min: 8000,  max: 20000 }] },
  flooring:    { label: 'Flooring',         options: [{ id: 'carpet',   label: 'Carpet',                min: 2000,  max: 5000  }, { id: 'hardwood', label: 'Hardwood',                min: 5000,  max: 15000 }, { id: 'full',     label: 'Full replacement',         min: 8000,  max: 20000 }] },
  paint_int:   { label: 'Paint (Interior)', options: [{ id: 'full',     label: 'Full interior',         min: 2000,  max: 6000  }] },
  paint_ext:   { label: 'Paint (Exterior)', options: [{ id: 'full',     label: 'Full exterior',         min: 2000,  max: 8000  }] },
  landscaping: { label: 'Landscaping',      options: [{ id: 'basic',    label: 'Basic cleanup',         min: 1000,  max: 5000  }] },
  windows:     { label: 'Windows (ea.)',    options: [{ id: 'each',     label: 'Per window',            min: 300,   max: 800   }] },
  garage_door: { label: 'Garage Door',      options: [{ id: 'replace',  label: 'Replacement',           min: 800,   max: 2000  }] },
  driveway:    { label: 'Driveway',         options: [{ id: 'repave',   label: 'Repave',                min: 2000,  max: 8000  }] },
}

function fmt$(n) { return '$' + Math.round(n).toLocaleString() }

export default function RepairEstimator({ onEstimate, initialItems = [] }) {
  const [selections, setSelections] = useState({}) // { category: { option, qty } }

  const toggle = useCallback((cat, optId) => {
    setSelections(prev => {
      const curr = prev[cat]
      if (curr?.option === optId) {
        const next = { ...prev }
        delete next[cat]
        return next
      }
      return { ...prev, [cat]: { option: optId, qty: 1 } }
    })
  }, [])

  const setQty = (cat, qty) =>
    setSelections(prev => ({ ...prev, [cat]: { ...prev[cat], qty: Math.max(1, qty) } }))

  let low = 0
  let high = 0
  const breakdown = []

  for (const [cat, sel] of Object.entries(selections)) {
    const item = REPAIR_ITEMS[cat]
    const opt  = item?.options.find(o => o.id === sel.option)
    if (!opt) continue
    const qty = sel.qty || 1
    low  += opt.min * qty
    high += opt.max * qty
    breakdown.push({ cat, label: item.label, option: opt.label, qty, low: opt.min * qty, high: opt.max * qty })
  }

  const midpoint = Math.round((low + high) / 2)

  const apply = () => { if (onEstimate) onEstimate(midpoint, breakdown) }

  return (
    <div className="space-y-1">
      {Object.entries(REPAIR_ITEMS).map(([cat, item]) => {
        const sel = selections[cat]
        return (
          <div
            key={cat}
            className={`rounded-[6px] border transition-colors ${
              sel ? 'border-primary/30 bg-primary/5' : 'border-border-subtle bg-elevated'
            }`}
          >
            <div className="px-3 py-2.5">
              <p className="text-[12px] font-medium text-text-secondary mb-1.5">{item.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {item.options.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => toggle(cat, opt.id)}
                    className={`text-[11px] px-2.5 py-1 rounded-[4px] border transition-colors ${
                      sel?.option === opt.id
                        ? 'bg-primary text-black border-primary font-semibold'
                        : 'border-border-default text-text-muted hover:border-primary/40 hover:text-text-secondary'
                    }`}
                  >
                    {opt.label} ({fmt$(opt.min)}–{fmt$(opt.max)})
                  </button>
                ))}
                {sel && (cat === 'bathrooms' || cat === 'windows') && (
                  <div className="flex items-center gap-1 ml-2">
                    <span className="text-[11px] text-text-muted">Qty:</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={sel.qty || 1}
                      onChange={e => setQty(cat, parseInt(e.target.value) || 1)}
                      className="w-12 h-6 text-[11px] text-center bg-surface border border-border-default rounded-[3px] text-text-primary focus:outline-none focus:border-primary"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Totals */}
      <div className="mt-4 p-4 bg-card border border-border-subtle rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <span className="label-caps">Estimated Total</span>
          <div className="text-right">
            <p className="text-[22px] font-bold text-gold">{fmt$(midpoint)}</p>
            <p className="text-[11px] text-text-muted">Range: {fmt$(low)} – {fmt$(high)}</p>
          </div>
        </div>
        {breakdown.length > 0 && (
          <div className="space-y-1 mb-3">
            {breakdown.map(b => (
              <div key={b.cat} className="flex justify-between text-[12px]">
                <span className="text-text-muted">
                  {b.label}{b.qty > 1 ? ` ×${b.qty}` : ''} — {b.option}
                </span>
                <span className="text-text-secondary">{fmt$(b.low)}–{fmt$(b.high)}</span>
              </div>
            ))}
          </div>
        )}
        {onEstimate && (
          <Button className="w-full" size="sm" onClick={apply} disabled={breakdown.length === 0}>
            Apply to Deal
          </Button>
        )}
      </div>
    </div>
  )
}
