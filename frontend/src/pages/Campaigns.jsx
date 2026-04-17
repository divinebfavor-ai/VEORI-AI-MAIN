import React, { useState, useEffect } from 'react'
import { Plus, Play, Pause, Square, X, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import { campaigns as campaignsApi } from '../services/api'

function statusVariant(status) {
  const map = { active: 'green', running: 'green', paused: 'yellow', stopped: 'gray', completed: 'blue', draft: 'gray' }
  return map[status?.toLowerCase()] || 'gray'
}

// Progress bar
function ProgressBar({ value, max, color = 'bg-primary' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="w-full bg-elevated rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// Create Campaign Modal
function CreateCampaignModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    concurrent_lines: 5,
    max_attempts: 3,
    call_window_start: '09:00',
    call_window_end: '20:00',
    timezone: 'America/New_York',
    voice_id: 'alex',
    script_type: 'motivated_seller',
  })
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setNum = (k) => (e) => setForm(f => ({ ...f, [k]: Number(e.target.value) }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name) { toast.error('Campaign name required'); return }
    setLoading(true)
    try {
      await campaignsApi.createCampaign(form)
      toast.success('Campaign created!')
      onCreated?.()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create campaign')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-card border border-border-subtle rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Create Campaign</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Basic Info</h3>
            <div className="space-y-3">
              <Input label="Campaign Name" value={form.name} onChange={set('name')} placeholder="Motivated Sellers — Georgia Q1" />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-secondary">Description</label>
                <textarea
                  value={form.description}
                  onChange={set('description')}
                  placeholder="Campaign description..."
                  rows={2}
                  className="w-full bg-surface border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary resize-none"
                />
              </div>
            </div>
          </div>

          {/* Calling Settings */}
          <div>
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Calling Settings</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-secondary">Concurrent Lines</label>
                <input
                  type="number"
                  min={1} max={50}
                  value={form.concurrent_lines}
                  onChange={setNum('concurrent_lines')}
                  className="bg-surface border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-secondary">Max Attempts per Lead</label>
                <input
                  type="number"
                  min={1} max={10}
                  value={form.max_attempts}
                  onChange={setNum('max_attempts')}
                  className="bg-surface border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <Input label="Call Window Start" type="time" value={form.call_window_start} onChange={set('call_window_start')} />
              <Input label="Call Window End" type="time" value={form.call_window_end} onChange={set('call_window_end')} />
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Timezone</label>
              <div className="relative">
                <select
                  value={form.timezone}
                  onChange={set('timezone')}
                  className="w-full appearance-none bg-surface border border-border-default rounded-lg px-3 py-2.5 pr-8 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* AI Settings */}
          <div>
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">AI Settings</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-secondary">Script Type</label>
                <div className="relative">
                  <select
                    value={form.script_type}
                    onChange={set('script_type')}
                    className="w-full appearance-none bg-surface border border-border-default rounded-lg px-3 py-2.5 pr-8 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="motivated_seller">Motivated Seller</option>
                    <option value="absentee_owner">Absentee Owner</option>
                    <option value="probate">Probate</option>
                    <option value="pre_foreclosure">Pre-Foreclosure</option>
                    <option value="tax_delinquent">Tax Delinquent</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-secondary">AI Voice</label>
                <div className="relative">
                  <select
                    value={form.voice_id}
                    onChange={set('voice_id')}
                    className="w-full appearance-none bg-surface border border-border-default rounded-lg px-3 py-2.5 pr-8 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="alex">Alex (Male)</option>
                    <option value="sarah">Sarah (Female)</option>
                    <option value="james">James (Male)</option>
                    <option value="aria">Aria (Female)</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                </div>
              </div>
            </div>
          </div>
        </form>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={loading}>Create Campaign</Button>
        </div>
      </div>
    </div>
  )
}

// Campaign Card
function CampaignCard({ campaign, onUpdate }) {
  const [actionLoading, setActionLoading] = useState(null)
  const stats = campaign.stats || campaign.today_stats || {}
  const totalLeads = campaign.total_leads || campaign.lead_count || 0
  const calledLeads = campaign.called_leads || stats.calls_made || 0

  const doAction = async (action, fn) => {
    setActionLoading(action)
    try {
      await fn(campaign.id)
      toast.success(`Campaign ${action}ed`)
      onUpdate?.()
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${action} campaign`)
    } finally {
      setActionLoading(null)
    }
  }

  const status = campaign.status?.toLowerCase()

  return (
    <div className="bg-card border border-border-subtle rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-text-primary truncate">{campaign.name}</h3>
          {campaign.description && (
            <p className="text-sm text-text-muted mt-0.5 truncate">{campaign.description}</p>
          )}
        </div>
        <Badge variant={statusVariant(campaign.status)} className="flex-shrink-0 ml-3">
          {campaign.status || 'Draft'}
        </Badge>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-text-muted">Progress</span>
          <span className="text-xs text-text-secondary font-medium">
            {calledLeads.toLocaleString()} / {totalLeads.toLocaleString()} leads
          </span>
        </div>
        <ProgressBar value={calledLeads} max={totalLeads} />
      </div>

      {/* Today's Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Calls', value: stats.calls || stats.calls_today || 0 },
          { label: 'Answered', value: stats.answered || stats.connected || 0 },
          { label: 'Appointments', value: stats.appointments || 0 },
          { label: 'Offers', value: stats.offers || 0 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-elevated rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-text-primary">{value}</div>
            <div className="text-xs text-text-muted mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Lines setting */}
      <div className="flex items-center justify-between text-xs text-text-muted mb-4">
        <span>{campaign.concurrent_lines || 5} concurrent lines</span>
        <span>{campaign.max_attempts || 3} max attempts</span>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        {(status === 'draft' || status === 'paused' || status === 'stopped') && (
          <Button
            size="sm"
            variant="primary"
            loading={actionLoading === 'start'}
            onClick={() => doAction('start', campaignsApi.startCampaign)}
            className="flex-1"
          >
            <Play size={14} /> Start
          </Button>
        )}
        {status === 'active' || status === 'running' ? (
          <>
            <Button
              size="sm"
              variant="warning"
              loading={actionLoading === 'pause'}
              onClick={() => doAction('pause', campaignsApi.pauseCampaign)}
              className="flex-1"
            >
              <Pause size={14} /> Pause
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={actionLoading === 'stop'}
              onClick={() => doAction('stop', campaignsApi.stopCampaign)}
              className="flex-1"
            >
              <Square size={14} /> Stop
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

export default function Campaigns() {
  const [campaignsData, setCampaignsData] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const fetchCampaigns = async () => {
    try {
      const res = await campaignsApi.getCampaigns()
      setCampaignsData(res.data?.campaigns || res.data || [])
    } catch {
      toast.error('Failed to load campaigns')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCampaigns() }, [])

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Campaigns</h1>
          <p className="text-text-secondary text-sm mt-1">{campaignsData.length} campaigns</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Create Campaign
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-64 bg-card border border-border-subtle rounded-xl animate-pulse" />
          ))}
        </div>
      ) : campaignsData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-muted">
          <div className="w-16 h-16 bg-elevated rounded-2xl flex items-center justify-center mb-4">
            <Play size={28} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-secondary text-lg">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first AI calling campaign</p>
          <Button className="mt-5" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create Campaign
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {campaignsData.map((c) => (
            <CampaignCard key={c.id} campaign={c} onUpdate={fetchCampaigns} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchCampaigns}
        />
      )}
    </div>
  )
}
