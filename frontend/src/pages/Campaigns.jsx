import React, { useState, useEffect } from 'react'
import { Plus, Play, Pause, Square, X, ChevronRight, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { campaigns } from '../services/api'

function statusVariant(s) {
  const m = { active:'green', running:'green', paused:'amber', draft:'gray', completed:'gray', stopped:'gray' }
  return m[s?.toLowerCase()] || 'gray'
}

// Primary lead tags assigned by leadTaggingService — [value, friendly label].
// Operators pick which tags a campaign calls. None selected = call all leads.
const LEAD_TAGS = [
  ['pre_foreclosure', 'Pre-Foreclosure'], ['tax_delinquent', 'Tax Delinquent'],
  ['inherited',       'Inherited'],        ['probate',        'Probate'],
  ['vacant',          'Vacant'],           ['absentee_owner', 'Absentee Owner'],
  ['fsbo',            'FSBO'],             ['free_and_clear', 'Free & Clear'],
  ['cash_buyer',      'Cash Buyer'],
]

// ─── Create Campaign Modal ────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [step, setStep]       = useState(1)
  const [form, setForm]       = useState({ name:'', tags:[], use_case:'', concurrent_lines:1, daily_limit_per_number:50, calling_hours_start:'09:00', calling_hours_end:'20:00' })
  const [smsFirst, setSmsFirst] = useState(false)
  const [blastCount, setBlastCount] = useState(1)   // 1× / 2× / 3× non-responder cadence
  const [saving, setSaving]   = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const toggleTag = t => setForm(f => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter(x => x !== t) : [...f.tags, t] }))

  const launch = async () => {
    if (!form.name) { toast.error('Campaign name required'); return }
    setSaving(true)
    try {
      const created = await campaigns.createCampaign({ ...form, use_case: form.use_case || null, concurrent_lines: Number(form.concurrent_lines), daily_limit_per_number: Number(form.daily_limit_per_number), lead_filter: { tags: form.tags } })
      const campaignId = created?.data?.data?.id || created?.data?.id
      if (smsFirst && campaignId) {
        await campaigns.startSMSFirst(campaignId, blastCount)
        toast.success(`SMS First campaign launched — ${blastCount}× blast to non-responders`)
      } else {
        toast.success('Campaign created')
      }
      onCreated()
    } catch (err) { toast.error(err?.response?.data?.error || 'Failed to create campaign') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end justify-center z-50 p-6">
      <div className="w-full max-w-[560px] bg-card border border-border-subtle rounded-xl p-8 animate-slide-in-up">
        {/* Step dots */}
        <div className="flex items-center gap-2 mb-8">
          {[1,2,3,4].map(n => (
            <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= step ? 'bg-primary' : 'bg-border-subtle'}`} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-[22px] font-medium text-text-primary mb-1">Name your campaign</h2>
            <p className="text-[13px] text-text-muted mb-6">Give it a descriptive name so you can track it later</p>
            <div className="flex flex-col gap-1.5">
              <label className="label-caps">Campaign Name</label>
              <input value={form.name} onChange={set('name')} placeholder="Detroit Absentee Owner Blast"
                className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-4 text-[15px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1.5 mt-5">
              <label className="label-caps">Use Case</label>
              <select value={form.use_case} onChange={set('use_case')}
                className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-4 text-[15px] text-text-primary focus:outline-none focus:border-primary"
              >
                <option value="">Use my default (from Settings)</option>
                <option value="wholesale">Wholesaler / Cash Investor</option>
                <option value="agent_listing">Real Estate Agent — Listing</option>
                <option value="buyer_agent">Buyer's Agent</option>
                <option value="landlord_pm">Property Management</option>
                <option value="investor_outreach">Investor Outreach</option>
                <option value="general">General Real Estate</option>
              </select>
              <p className="text-[11px] text-text-muted mt-1">Overrides your account default just for this campaign. Sets how the AI runs the call.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-[22px] font-medium text-text-primary mb-1">Target leads</h2>
            <p className="text-[13px] text-text-muted mb-6">Pick which lead types this campaign calls. Leave all unselected to call every lead.</p>
            <div className="flex flex-wrap gap-2">
              {LEAD_TAGS.map(([value, label]) => {
                const active = form.tags.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleTag(value)}
                    className={`px-3.5 py-2 rounded-full text-[13px] font-medium border transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border-subtle text-text-muted hover:border-border-default'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-text-muted mt-4">
              {form.tags.length === 0
                ? 'All leads will be called.'
                : `${form.tags.length} tag${form.tags.length !== 1 ? 's' : ''} selected — only matching leads will be called.`}
            </p>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-[22px] font-medium text-text-primary mb-1">Calling settings</h2>
            <p className="text-[13px] text-text-muted mb-6">Configure how Alex will dial</p>

            {/* SMS First toggle */}
            <div
              onClick={() => setSmsFirst(v => !v)}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer mb-5 transition-colors ${smsFirst ? 'border-primary bg-primary/5' : 'border-border-subtle hover:border-border-default'}`}
            >
              <div className={`mt-0.5 w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${smsFirst ? 'bg-primary' : 'bg-elevated'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${smsFirst ? 'left-4' : 'left-0.5'}`} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-text-primary">SMS First mode</p>
                <p className="text-[11px] text-text-muted mt-0.5">Text every lead first. Only leads that reply get called by Alex — cuts cost, increases response rate.</p>
              </div>
            </div>

            {/* Blast cadence — how many times a non-responder gets texted (1× / 2× / 3×) */}
            {smsFirst && (
              <div className="mb-5 pl-1" onClick={e => e.stopPropagation()}>
                <label className="label-caps block mb-2">Blast cadence</label>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setBlastCount(n)}
                      className={`h-[44px] rounded-[6px] border text-[14px] font-semibold transition-colors ${blastCount === n ? 'border-primary bg-primary/10 text-text-primary' : 'border-border-subtle text-text-muted hover:border-border-default'}`}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted mt-2">
                  {blastCount === 1
                    ? 'Text non-responders once.'
                    : `Re-text leads who don't reply up to ${blastCount} times, a few days apart.`}
                </p>
              </div>
            )}
            <div className="space-y-5">
              <div>
                <label className="label-caps block mb-3">Concurrent Lines: <span className="text-text-primary">{form.concurrent_lines}</span></label>
                <input type="range" min={1} max={5} value={form.concurrent_lines} onChange={set('concurrent_lines')}
                  className="w-full accent-primary" />
                <div className="flex justify-between text-[11px] text-text-muted mt-1"><span>1</span><span>5</span></div>
                {Number(form.concurrent_lines) > 2 && (
                  <p className="text-[11px] text-amber-400 mt-2">Higher concurrency requires a plan that supports it. Contact support if you need more than 2 simultaneous calls.</p>
                )}
              </div>
              <div className="flex gap-4">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="label-caps">Daily Limit / Number</label>
                  <input type="number" value={form.daily_limit_per_number} onChange={set('daily_limit_per_number')} min={10} max={100}
                    className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="label-caps">Start Time</label>
                  <input type="time" value={form.calling_hours_start} onChange={set('calling_hours_start')}
                    className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="label-caps">End Time</label>
                  <input type="time" value={form.calling_hours_end} onChange={set('calling_hours_end')}
                    className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-[22px] font-medium text-text-primary mb-1">Review & Launch</h2>
            <p className="text-[13px] text-text-muted mb-6">Confirm your campaign settings before launching</p>
            <div className="space-y-1 mb-6">
              {[
                ['Campaign Name',  form.name],
                ['Use Case',       ({ wholesale:'Wholesaler / Cash Investor', agent_listing:'Real Estate Agent — Listing', buyer_agent:"Buyer's Agent", landlord_pm:'Property Management', investor_outreach:'Investor Outreach', general:'General Real Estate' }[form.use_case]) || 'Account default'],
                ['Target Leads',   form.tags.length === 0 ? 'All leads' : form.tags.map(t => (LEAD_TAGS.find(([v]) => v === t)?.[1]) || t).join(', ')],
                ['Mode',           smsFirst ? `💬 SMS First (${blastCount}× blast)` : '📞 Direct Call'],
                ['Concurrent Lines', form.concurrent_lines],
                ['Daily Limit',    `${form.daily_limit_per_number} calls / number`],
                ['Calling Hours',  `${form.calling_hours_start} – ${form.calling_hours_end}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5 border-b border-border-subtle last:border-0">
                  <span className="label-caps">{k}</span>
                  <span className="text-[13px] text-text-primary font-medium">{v}</span>
                </div>
              ))}
            </div>
            {smsFirst && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-[12px] text-text-muted leading-relaxed">
                <span className="text-primary font-semibold">SMS First mode:</span> Personalised texts go to every lead immediately. Leads that reply get called by Alex within 5 minutes. {blastCount > 1 ? `Non-responders are re-texted up to ${blastCount} times, a few days apart, then` : 'No-reply leads'} enter follow-up.
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <Button variant="secondary" className="flex-1" onClick={step === 1 ? onClose : () => setStep(s => s-1)}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 4
            ? <Button className="flex-1" onClick={() => setStep(s => s+1)}>Continue <ChevronRight size={14} /></Button>
            : <Button className="flex-1" loading={saving} onClick={launch}>Launch Campaign</Button>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Campaign Card ────────────────────────────────────────────────────────────
function CampaignCard({ c, onAction }) {
  const isActive  = c.status === 'active' || c.status === 'running'
  const progress  = c.total_leads > 0 ? Math.round((c.leads_called / c.total_leads) * 100) : 0

  return (
    <div className={`bg-card border rounded-lg p-6 transition-colors ${isActive ? 'border-primary' : 'border-border-subtle hover:border-border-default'}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-[16px] font-medium text-text-primary truncate">{c.name}</h3>
          <p className="text-[12px] text-text-muted mt-0.5">{c.concurrent_lines || 3} concurrent lines · {c.calling_hours_start || '09:00'}–{c.calling_hours_end || '20:00'}</p>
        </div>
        <Badge variant={statusVariant(c.status)}>{c.status || 'draft'}</Badge>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-[11px] text-text-muted mb-1.5">
          <span>{c.leads_called || 0} called</span>
          <span>{c.total_leads || 0} total</span>
        </div>
        <div className="h-1 bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Stats row */}
      {c.sms_first_mode ? (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[['Texts Sent', c.sms_first_sent||0], ['Replied', c.sms_first_replies||0], ['Called', c.sms_first_called||0]].map(([k,v]) => (
            <div key={k} className="text-center">
              <p className="text-[20px] font-semibold text-text-primary">{v}</p>
              <p className="label-caps mt-0.5">{k}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[['Answered', c.leads_answered||0], ['Offers', c.offers_made||0], ['Contracts', c.contracts_sent||0]].map(([k,v]) => (
            <div key={k} className="text-center">
              <p className="text-[20px] font-semibold text-text-primary">{v}</p>
              <p className="label-caps mt-0.5">{k}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error banner */}
      {c.error_message && (
        <div className="mb-4 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 leading-snug">
          ⚠ {c.error_message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {c.status === 'draft' && (
          <Button size="sm" className="flex-1" onClick={() => onAction('start', c.id)}>
            <Play size={12} /> Start
          </Button>
        )}
        {isActive && (
          <>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => onAction('pause', c.id)}>
              <Pause size={12} /> Pause
            </Button>
            <Button variant="danger" size="sm" onClick={() => onAction('stop', c.id)}>
              <Square size={12} />
            </Button>
          </>
        )}
        {c.status === 'paused' && (
          <Button size="sm" className="flex-1" onClick={() => onAction('start', c.id)}>
            <Play size={12} /> Resume
          </Button>
        )}
        {(c.status === 'completed' || c.status === 'stopped') && (
          <>
            <Button variant="secondary" size="sm" className="flex-1" disabled>Completed</Button>
            <Button variant="danger" size="sm" onClick={() => onAction('delete', c.id)}><Trash2 size={12} /></Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Campaigns() {
  const [list, setList]       = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setModal] = useState(false)

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try { const r = await campaigns.getCampaigns(); const raw = r.data?.campaigns ?? r.data?.data ?? r.data; setList(Array.isArray(raw) ? raw : []) }
    catch { setList([]) }
    finally { if (showSpinner) setLoading(false) }
  }

  useEffect(() => {
    load(true)
    const t = setInterval(() => load(false), 15000)
    return () => clearInterval(t)
  }, [])

  const handleAction = async (action, id) => {
    try {
      if (action === 'start')  await campaigns.startCampaign(id)
      if (action === 'pause')  await campaigns.pauseCampaign(id)
      if (action === 'stop')   await campaigns.stopCampaign(id)
      if (action === 'delete') await campaigns.deleteCampaign(id)
      toast.success(action === 'delete' ? 'Campaign deleted' : `Campaign ${action}ed`)
      load()
    } catch { toast.error(`Failed to ${action} campaign`) }
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-text-primary">Campaigns</h1>
          <p className="text-[13px] text-text-muted mt-1">{list.length} campaign{list.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setModal(true)}><Plus size={14} /> Create Campaign</Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-text-muted text-[14px]">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-lg py-24 text-center">
          <Play size={36} className="text-text-muted mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[16px] font-medium text-text-primary mb-2">No campaigns yet</p>
          <p className="text-[13px] text-text-muted mb-6">Create your first campaign to start dialing</p>
          <Button onClick={() => setModal(true)}><Plus size={14} /> Create Campaign</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {list.map(c => <CampaignCard key={c.id} c={c} onAction={handleAction} />)}
        </div>
      )}

      {showModal && <CreateModal onClose={() => setModal(false)} onCreated={() => { setModal(false); load() }} />}
    </div>
  )
}
