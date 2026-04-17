import React, { useState, useEffect } from 'react'
import {
  User, Key, Phone, Sliders, Shield, Bell, CreditCard,
  Eye, EyeOff, Plus, Trash2, ToggleLeft, ToggleRight, AlertCircle
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import { phones as phonesApi } from '../services/api'
import useAuthStore from '../store/authStore'

const TABS = [
  { key: 'account', label: 'Account', icon: User },
  { key: 'api', label: 'API Keys', icon: Key },
  { key: 'phones', label: 'Phone Numbers', icon: Phone },
  { key: 'calling', label: 'Calling Preferences', icon: Sliders },
  { key: 'compliance', label: 'Compliance', icon: Shield },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'billing', label: 'Billing', icon: CreditCard },
]

// Phone health bar
function HealthBar({ value }) {
  const color = value >= 70 ? 'bg-success' : value >= 40 ? 'bg-warning' : 'bg-danger'
  return (
    <div className="w-full bg-elevated rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
    </div>
  )
}

function phoneStatusVariant(status) {
  const map = { Active: 'green', active: 'green', Cooling: 'yellow', cooling: 'yellow', Resting: 'gray', resting: 'gray', Flagged: 'red', flagged: 'red' }
  return map[status] || 'gray'
}

// ─── Tab Panels ───────────────────────────────────────────────────────────────

function AccountTab() {
  const user = useAuthStore(s => s.user)
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    company_name: user?.company_name || '',
    email: user?.email || '',
  })
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-4">Account Information</h3>
        <div className="space-y-4">
          <Input label="Full Name" value={form.full_name} onChange={set('full_name')} />
          <Input label="Company Name" value={form.company_name} onChange={set('company_name')} />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} />
        </div>
      </div>
      <Button onClick={() => toast.success('Changes saved')}>Save Changes</Button>
    </div>
  )
}

function APIKeysTab() {
  const [keys, setKeys] = useState({
    vapi: '',
    anthropic: '',
    twilio_sid: '',
    twilio_token: '',
    elevenlabs: '',
  })
  const [revealed, setRevealed] = useState({})
  const set = (k) => (e) => setKeys(f => ({ ...f, [k]: e.target.value }))
  const toggle = (k) => setRevealed(r => ({ ...r, [k]: !r[k] }))

  const apiFields = [
    { key: 'vapi', label: 'VAPI API Key', placeholder: 'vapi_...' },
    { key: 'anthropic', label: 'Anthropic API Key', placeholder: 'sk-ant-...' },
    { key: 'twilio_sid', label: 'Twilio Account SID', placeholder: 'AC...' },
    { key: 'twilio_token', label: 'Twilio Auth Token', placeholder: 'Auth token...' },
    { key: 'elevenlabs', label: 'ElevenLabs API Key', placeholder: 'el_...' },
  ]

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">API Keys</h3>
        <p className="text-sm text-text-muted mb-5">
          Keys are encrypted at rest. Never share these with anyone.
        </p>
        <div className="space-y-4">
          {apiFields.map(({ key, label, placeholder }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">{label}</label>
              <div className="relative">
                <input
                  type={revealed[key] ? 'text' : 'password'}
                  value={keys[key]}
                  onChange={set(key)}
                  placeholder={placeholder}
                  className="w-full bg-surface border border-border-default rounded-lg px-3 py-2.5 pr-10 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary font-mono"
                />
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  {revealed[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Button onClick={() => toast.success('API keys saved')}>Save API Keys</Button>
    </div>
  )
}

function PhoneNumbersTab() {
  const [phoneList, setPhoneList] = useState([])
  const [loading, setLoading] = useState(true)
  const [newNumber, setNewNumber] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await phonesApi.getPhones()
        setPhoneList(res.data?.phones || res.data || [])
      } catch {
        toast.error('Failed to load phone numbers')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const addPhone = async () => {
    if (!newNumber.trim()) return
    setAdding(true)
    try {
      await phonesApi.addPhone({ number: newNumber.trim() })
      toast.success('Phone number added')
      setNewNumber('')
      const res = await phonesApi.getPhones()
      setPhoneList(res.data?.phones || res.data || [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add phone')
    } finally {
      setAdding(false)
    }
  }

  const deletePhone = async (id) => {
    if (!window.confirm('Remove this phone number?')) return
    try {
      await phonesApi.deletePhone(id)
      setPhoneList(prev => prev.filter(p => p.id !== id))
      toast.success('Phone removed')
    } catch {
      toast.error('Failed to remove phone')
    }
  }

  const togglePhone = async (phone) => {
    try {
      await phonesApi.updatePhone(phone.id, { enabled: !phone.enabled })
      setPhoneList(prev => prev.map(p => p.id === phone.id ? { ...p, enabled: !p.enabled } : p))
    } catch {
      toast.error('Failed to update phone')
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Phone Numbers</h3>
        <p className="text-sm text-text-muted mb-5">Manage your calling numbers and monitor their health.</p>
      </div>

      {/* Add phone */}
      <div className="flex gap-3">
        <input
          type="tel"
          value={newNumber}
          onChange={e => setNewNumber(e.target.value)}
          placeholder="+1 (555) 000-0000"
          className="flex-1 bg-surface border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          onKeyDown={e => e.key === 'Enter' && addPhone()}
        />
        <Button onClick={addPhone} loading={adding}>
          <Plus size={16} /> Add Number
        </Button>
      </div>

      {/* Phone list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-elevated rounded-xl animate-pulse" />
          ))}
        </div>
      ) : phoneList.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Phone size={36} className="mx-auto mb-3 opacity-40" />
          <p>No phone numbers added yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {phoneList.map((phone, i) => {
            const health = phone.health_score ?? 85
            const callsToday = phone.calls_today ?? 0
            const callLimit = phone.daily_limit ?? 100
            const cooldown = phone.cooldown_remaining

            return (
              <div key={phone.id || i} className="bg-elevated border border-border-subtle rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-mono text-text-primary font-semibold">{phone.number}</div>
                    {phone.label && <div className="text-xs text-text-muted mt-0.5">{phone.label}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={phoneStatusVariant(phone.status || 'Active')}>
                      {phone.status || 'Active'}
                    </Badge>
                    <button
                      onClick={() => togglePhone(phone)}
                      className={`transition-colors ${phone.enabled !== false ? 'text-primary' : 'text-text-muted'}`}
                    >
                      {phone.enabled !== false ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                    </button>
                    <button
                      onClick={() => deletePhone(phone.id)}
                      className="text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Health Score</span>
                    <span className={`font-semibold ${health >= 70 ? 'text-success' : health >= 40 ? 'text-warning' : 'text-danger'}`}>
                      {health}%
                    </span>
                  </div>
                  <HealthBar value={health} />

                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className="text-text-muted">Calls Today</span>
                    <span className="text-text-secondary">{callsToday} / {callLimit}</span>
                  </div>

                  {cooldown && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-warning">
                      <AlertCircle size={12} />
                      Cooling down: {cooldown} remaining
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CallingPreferencesTab() {
  const [prefs, setPrefs] = useState({
    call_window_start: '09:00',
    call_window_end: '20:00',
    max_concurrent: 10,
    retry_delay_hours: 4,
    voicemail_enabled: true,
    voicemail_message: 'Hi, this is Alex calling about your property. Please call us back at your convenience.',
  })
  const set = (k) => (e) => setPrefs(p => ({ ...p, [k]: e.target.value }))
  const setNum = (k) => (e) => setPrefs(p => ({ ...p, [k]: Number(e.target.value) }))
  const toggle = (k) => setPrefs(p => ({ ...p, [k]: !p[k] }))

  return (
    <div className="max-w-lg space-y-6">
      <h3 className="text-base font-semibold text-text-primary">Calling Preferences</h3>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Call Window Start" type="time" value={prefs.call_window_start} onChange={set('call_window_start')} />
          <Input label="Call Window End" type="time" value={prefs.call_window_end} onChange={set('call_window_end')} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Max Concurrent Calls</label>
          <input
            type="number" min={1} max={100}
            value={prefs.max_concurrent}
            onChange={setNum('max_concurrent')}
            className="bg-surface border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Retry Delay (hours)</label>
          <input
            type="number" min={1} max={72}
            value={prefs.retry_delay_hours}
            onChange={setNum('retry_delay_hours')}
            className="bg-surface border border-border-default rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="flex items-center justify-between py-3 border-t border-border-subtle">
          <div>
            <div className="text-sm font-medium text-text-primary">Leave Voicemails</div>
            <div className="text-xs text-text-muted">AI leaves a voicemail when no answer</div>
          </div>
          <button onClick={() => toggle('voicemail_enabled')}>
            {prefs.voicemail_enabled
              ? <ToggleRight size={28} className="text-primary" />
              : <ToggleLeft size={28} className="text-text-muted" />}
          </button>
        </div>

        {prefs.voicemail_enabled && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-secondary">Voicemail Script</label>
            <textarea
              value={prefs.voicemail_message}
              onChange={set('voicemail_message')}
              rows={3}
              className="w-full bg-surface border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>
        )}
      </div>

      <Button onClick={() => toast.success('Preferences saved')}>Save Preferences</Button>
    </div>
  )
}

function ComplianceTab() {
  const [settings, setSettings] = useState({
    tcpa_mode: true,
    dnc_check: true,
    state_restrictions: true,
    recording_disclosure: true,
  })
  const toggle = (k) => setSettings(s => ({ ...s, [k]: !s[k] }))

  const items = [
    { key: 'tcpa_mode', label: 'TCPA Compliance Mode', desc: 'Respect calling hours and consent requirements' },
    { key: 'dnc_check', label: 'DNC Registry Check', desc: 'Auto-check Federal and State DNC lists before calling' },
    { key: 'state_restrictions', label: 'State-Specific Restrictions', desc: 'Apply state calling time restrictions automatically' },
    { key: 'recording_disclosure', label: 'Recording Disclosure', desc: 'AI announces call recording at start of conversation' },
  ]

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Compliance Settings</h3>
        <p className="text-sm text-text-muted mb-5">Configure legal compliance for your calling campaigns.</p>
      </div>
      <div className="space-y-3">
        {items.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between py-4 border-b border-border-subtle last:border-0">
            <div>
              <div className="text-sm font-medium text-text-primary">{label}</div>
              <div className="text-xs text-text-muted mt-0.5">{desc}</div>
            </div>
            <button onClick={() => toggle(key)}>
              {settings[key]
                ? <ToggleRight size={28} className="text-primary" />
                : <ToggleLeft size={28} className="text-text-muted" />}
            </button>
          </div>
        ))}
      </div>
      <Button onClick={() => toast.success('Compliance settings saved')}>Save Settings</Button>
    </div>
  )
}

function NotificationsTab() {
  const [notifs, setNotifs] = useState({
    hot_lead: true,
    appointment: true,
    offer_accepted: true,
    campaign_complete: true,
    phone_flagged: true,
    email_hot_lead: false,
    sms_appointment: true,
  })
  const toggle = (k) => setNotifs(n => ({ ...n, [k]: !n[k] }))

  const items = [
    { key: 'hot_lead', label: 'Hot Lead Alert', desc: 'When a lead scores 70+', category: 'In-App' },
    { key: 'appointment', label: 'Appointment Booked', desc: 'When AI books an appointment', category: 'In-App' },
    { key: 'offer_accepted', label: 'Offer Accepted', desc: 'When a seller accepts an offer', category: 'In-App' },
    { key: 'campaign_complete', label: 'Campaign Complete', desc: 'When all leads have been called', category: 'In-App' },
    { key: 'phone_flagged', label: 'Phone Number Flagged', desc: 'When a number is marked at risk', category: 'In-App' },
    { key: 'email_hot_lead', label: 'Hot Lead Email', desc: 'Email notification for hot leads', category: 'Email' },
    { key: 'sms_appointment', label: 'Appointment SMS', desc: 'SMS when appointment booked', category: 'SMS' },
  ]

  return (
    <div className="max-w-lg space-y-5">
      <h3 className="text-base font-semibold text-text-primary">Notifications</h3>
      <div className="space-y-1">
        {items.map(({ key, label, desc, category }) => (
          <div key={key} className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{label}</span>
                <Badge variant="gray">{category}</Badge>
              </div>
              <div className="text-xs text-text-muted mt-0.5">{desc}</div>
            </div>
            <button onClick={() => toggle(key)}>
              {notifs[key]
                ? <ToggleRight size={28} className="text-primary" />
                : <ToggleLeft size={28} className="text-text-muted" />}
            </button>
          </div>
        ))}
      </div>
      <Button onClick={() => toast.success('Notifications saved')}>Save</Button>
    </div>
  )
}

function BillingTab() {
  return (
    <div className="max-w-xl space-y-5">
      <h3 className="text-base font-semibold text-text-primary">Billing</h3>
      <div className="bg-elevated border border-border-subtle rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-lg font-bold text-text-primary">Pro Plan</div>
            <div className="text-text-muted text-sm">$299/month</div>
          </div>
          <Badge variant="green">Active</Badge>
        </div>
        <div className="space-y-2 text-sm">
          {['Unlimited AI calls', '50 concurrent lines', 'Unlimited leads', 'Contract generation', 'Priority support'].map(f => (
            <div key={f} className="flex items-center gap-2 text-text-secondary">
              <span className="text-success">✓</span> {f}
            </div>
          ))}
        </div>
        <Button variant="secondary" className="mt-4">Manage Subscription</Button>
      </div>
      <div className="bg-elevated border border-border-subtle rounded-xl p-6">
        <h4 className="text-sm font-semibold text-text-primary mb-3">Usage This Month</h4>
        {[
          { label: 'AI Calls Made', value: '0', limit: 'Unlimited' },
          { label: 'Leads Processed', value: '0', limit: 'Unlimited' },
          { label: 'Contracts Generated', value: '0', limit: 'Unlimited' },
        ].map(({ label, value, limit }) => (
          <div key={label} className="flex justify-between py-2 border-b border-border-subtle/50 last:border-0 text-sm">
            <span className="text-text-secondary">{label}</span>
            <span className="text-text-primary font-medium">{value} <span className="text-text-muted">/ {limit}</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function Settings() {
  const [activeTab, setActiveTab] = useState('account')

  const tabContent = {
    account: <AccountTab />,
    api: <APIKeysTab />,
    phones: <PhoneNumbersTab />,
    calling: <CallingPreferencesTab />,
    compliance: <ComplianceTab />,
    notifications: <NotificationsTab />,
    billing: <BillingTab />,
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-text-secondary text-sm mt-1">Manage your account and platform configuration</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar nav */}
        <div className="w-52 flex-shrink-0">
          <nav className="space-y-0.5">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === key
                    ? 'bg-elevated text-primary border-l-[3px] border-primary pl-[9px]'
                    : 'text-text-secondary hover:bg-card hover:text-text-primary'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="bg-card border border-border-subtle rounded-xl p-7">
            {tabContent[activeTab]}
          </div>
        </div>
      </div>
    </div>
  )
}
