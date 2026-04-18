import React, { useState, useEffect } from 'react'
import { Plus, Play, Pause, Square, X, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { campaigns } from '../services/api'

function statusVariant(s) {
  const m = { active:'green', running:'green', paused:'amber', draft:'gray', completed:'gray', stopped:'gray' }
  return m[s?.toLowerCase()] || 'gray'
}

// ─── Create Campaign Modal ────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name:'', concurrent_lines:3, daily_limit_per_number:50, calling_hours_start:'09:00', calling_hours_end:'20:00' })
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const launch = async () => {
    if (!form.name) { toast.error('Campaign name required'); return }
    setSaving(true)
    try {
      await campaigns.createCampaign({ ...form, concurrent_lines: Number(form.concurrent_lines), daily_limit_per_number: Number(form.daily_limit_per_number) })
      toast.success('Campaign created')
      onCreated()
    } catch { toast.error('Failed to create campaign') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end justify-center z-50 p-6">
      <div className="w-full max-w-[560px] bg-card border border-border-subtle rounded-xl p-8 animate-slide-in-up">
        {/* Step dots */}
        <div className="flex items-center gap-2 mb-8">
          {[1,2,3].map(n => (
            <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= step ? 'bg-primary' : 'bg-border-subtle'}`} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-[22px] font-medium text-white mb-1">Name your campaign</h2>
            <p className="text-[13px] text-text-muted mb-6">Give it a descriptive name so you can track it later</p>
            <div className="flex flex-col gap-1.5">
              <label className="label-caps">Campaign Name</label>
              <input value={form.name} onChange={set('name')} placeholder="Detroit Absentee Owner Blast"
                className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-4 text-[15px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-[22px] font-medium text-white mb-1">Calling settings</h2>
            <p className="text-[13px] text-text-muted mb-6">Configure how Alex will dial</p>
            <div className="space-y-5">
              <div>
                <label className="label-caps block mb-3">Concurrent Lines: <span className="text-white">{form.concurrent_lines}</span></label>
                <input type="range" min={1} max={5} value={form.concurrent_lines} onChange={set('concurrent_lines')}
                  className="w-full accent-primary" />
                <div className="flex justify-between text-[11px] text-text-muted mt-1"><span>1</span><span>5</span></div>
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

        {step === 3 && (
          <div>
            <h2 className="text-[22px] font-medium text-white mb-1">Review & Launch</h2>
            <p className="text-[13px] text-text-muted mb-6">Confirm your campaign settings before launching</p>
            <div className="space-y-1">
              {[
                ['Campaign Name', form.name],
                ['Concurrent Lines', form.concurrent_lines],
                ['Daily Limit', `${form.daily_limit_per_number} calls / number`],
                ['Calling Hours', `${form.calling_hours_start} – ${form.calling_hours_end}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5 border-b border-border-subtle last:border-0">
                  <span className="label-caps">{k}</span>
                  <span className="text-[13px] text-text-primary font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <Button variant="secondary" className="flex-1" onClick={step === 1 ? onClose : () => setStep(s => s-1)}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3
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
          <h3 className="text-[16px] font-medium text-white truncate">{c.name}</h3>
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
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[['Answered', c.leads_answered||0], ['Offers', c.offers_made||0], ['Contracts', c.contracts_sent||0]].map(([k,v]) => (
          <div key={k} className="text-center">
            <p className="text-[20px] font-semibold text-text-primary">{v}</p>
            <p className="label-caps mt-0.5">{k}</p>
          </div>
        ))}
      </div>

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
          <Button variant="secondary" size="sm" className="flex-1" disabled>Completed</Button>
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

  const load = async () => {
    setLoading(true)
    try { const r = await campaigns.getCampaigns(); const raw = r.data?.campaigns ?? r.data?.data ?? r.data; setList(Array.isArray(raw) ? raw : []) }
    catch { setList([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  const handleAction = async (action, id) => {
    try {
      if (action === 'start')  await campaigns.startCampaign(id)
      if (action === 'pause')  await campaigns.pauseCampaign(id)
      if (action === 'stop')   await campaigns.stopCampaign(id)
      toast.success(`Campaign ${action}ed`)
      load()
    } catch { toast.error(`Failed to ${action} campaign`) }
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-white">Campaigns</h1>
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
