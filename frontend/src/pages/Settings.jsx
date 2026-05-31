import React, { useState, useEffect } from 'react'
import { User, Key, Phone, Bell, Shield, Plus, Trash2, CheckCircle, Sparkles, CreditCard, Eye, EyeOff, Moon, Sun, Share2, Mail, QrCode, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import useAuthStore from '../store/authStore'
import useThemeStore from '../store/themeStore'
import { phones, operator as operatorApi, auth, twoFA } from '../services/api'

const SOCIAL_PLATFORMS = [
  { id: 'facebook',  label: 'Facebook',  icon: '📘', color: '#1877F2', hint: 'Post to your Facebook page and groups' },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#E1306C', hint: 'Reach buyers on Instagram' },
  { id: 'twitter',   label: 'Twitter/X', icon: '𝕏',  color: '#1DA1F2', hint: 'Blast deals on X' },
  { id: 'youtube',   label: 'YouTube',   icon: '▶',  color: '#FF0000', hint: 'Share virtual tours as videos' },
  { id: 'tiktok',    label: 'TikTok',    icon: '♪',  color: '#69C9D0', hint: 'Short-form property content' },
]

const API_SOCIAL = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function socialAuthHeader() {
  const t = localStorage.getItem('veori_token') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

const TABS = [
  { id: 'profile',  label: 'Profile',       icon: User },
  { id: 'phones',   label: 'Phone Numbers', icon: Phone },
  { id: 'security', label: 'Security',      icon: Shield },
  { id: 'alerts',   label: 'Alerts',        icon: Bell },
  { id: 'persona',  label: 'AI Persona',    icon: Sparkles },
  { id: 'banking',  label: 'Banking',       icon: CreditCard },
  { id: 'social',   label: 'Social Media',  icon: Share2 },
]

function Section({ title, description, children }) {
  return (
    <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-6 py-5 border-b border-border-subtle">
        <h3 className="text-[15px] font-medium text-text-primary">{title}</h3>
        {description && <p className="text-[12px] text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function PasswordStrengthBar({ password }) {
  const checks = [
    { label: '12+ chars',        pass: password.length >= 12 },
    { label: 'Uppercase',        pass: /[A-Z]/.test(password) },
    { label: 'Number',           pass: /[0-9]/.test(password) },
    { label: 'Special char',     pass: /[^A-Za-z0-9]/.test(password) },
  ]
  const score = checks.filter(c => c.pass).length
  const colors = ['', 'bg-danger', 'bg-warning', 'bg-amber', 'bg-primary']
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']

  if (!password) return null
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1.5">
        {[1,2,3,4].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= score ? colors[score] : 'bg-surface'}`} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-muted">
          {checks.filter(c => !c.pass).map(c => c.label).join(', ')}
          {score === 4 ? 'All requirements met' : ' required'}
        </p>
        <span className={`text-[11px] font-medium ${score >= 4 ? 'text-primary' : score >= 2 ? 'text-warning' : 'text-danger'}`}>
          {labels[score]}
        </span>
      </div>
    </div>
  )
}

function AddPhoneForm({ onAdd, onCancel }) {
  const [form, setForm] = useState({ number: '', friendly_name: '', state: '', area_code: '', daily_call_limit: '50' })
  const [saving, setSaving] = useState(false)

  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleAdd = async () => {
    const num = form.number.trim()
    if (!num) { toast.error('Phone number is required'); return }
    if (!/^\+?[1-9]\d{7,14}$/.test(num.replace(/[\s\-().]/g, ''))) {
      toast.error('Enter a valid phone number (e.g. +15551234567)'); return
    }
    setSaving(true)
    try {
      const { data } = await phones.addPhone({
        number: num.replace(/[\s\-().]/g, '').startsWith('+') ? num.trim() : `+1${num.replace(/[\s\-().]/g, '')}`,
        friendly_name: form.friendly_name.trim() || null,
        state: form.state.trim().toUpperCase() || null,
        area_code: form.area_code.trim() || null,
        daily_call_limit: parseInt(form.daily_call_limit) || 50,
      })
      onAdd(data.data || data)
      setForm({ number: '', friendly_name: '', state: '', area_code: '', daily_call_limit: '50' })
      toast.success('Phone number added')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add phone number')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-primary/20 rounded-xl p-5 bg-primary/5 space-y-4">
      <p className="text-[13px] font-semibold text-text-primary">Add Existing Number</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Input
            label="Phone Number *"
            value={form.number}
            onChange={set('number')}
            placeholder="+15551234567"
            hint="Include country code. US numbers without + will be auto-prefixed with +1"
          />
        </div>
        <Input label="Label (optional)" value={form.friendly_name} onChange={set('friendly_name')} placeholder="Main Line" />
        <Input label="State (optional)" value={form.state} onChange={set('state')} placeholder="TX" maxLength={2} />
        <Input label="Area Code (optional)" value={form.area_code} onChange={set('area_code')} placeholder="512" />
        <Input label="Daily Call Limit" type="number" value={form.daily_call_limit} onChange={set('daily_call_limit')} placeholder="50" min="1" max="500" />
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={handleAdd} loading={saving}>Add Number</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function PhoneTab({ phoneList, setPhoneList }) {
  const [planStatus, setPlanStatus] = useState(null)
  const [provisioning, setProvisioning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [provisionForm, setProvisionForm] = useState({ area_code: '', friendly_name: '' })
  const [showProvision, setShowProvision] = useState(false)
  const [releaseTarget, setReleaseTarget] = useState(null) // phone to release
  const [releasing, setReleasing] = useState(false)

  useEffect(() => {
    phones.getPlanStatus().then(r => setPlanStatus(r.data)).catch(() => {})
  }, [phoneList.length])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const { data } = await phones.syncFromVapi()
      if (data.imported > 0) {
        const fresh = await phones.getPhones()
        const raw = fresh.data?.numbers ?? fresh.data?.data ?? fresh.data
        setPhoneList(Array.isArray(raw) ? raw : [])
        toast.success(`Synced ${data.imported} phone number${data.imported > 1 ? 's' : ''}`)
      } else {
        toast.success('All phone numbers are already up to date')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const handleProvision = async () => {
    setProvisioning(true)
    try {
      const { data } = await phones.provision(provisionForm.area_code || '415', provisionForm.friendly_name || undefined)
      setPhoneList(prev => [...prev, data.data || data])
      setShowProvision(false)
      setProvisionForm({ area_code: '', friendly_name: '' })
      toast.success('Phone number purchased and ready to use!')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to provision number')
    } finally {
      setProvisioning(false)
    }
  }

  const healthColor = s => s === 'healthy' ? 'success' : s === 'cooling' ? 'warning' : s === 'resting' ? 'info' : 'danger'

  const handleRelease = async () => {
    if (!releaseTarget) return
    setReleasing(true)
    try {
      await phones.releasePhone(releaseTarget.id, 'operator_released')
      setPhoneList(prev => prev.filter(x => x.id !== releaseTarget.id))
      toast.success('Phone number released')
      setReleaseTarget(null)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to release number')
    } finally {
      setReleasing(false)
    }
  }

  const fmtDate = iso => {
    if (!iso) return null
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  return (
    <Section title="Phone Numbers" description="Buy and manage phone numbers for AI calling">
      {/* Plan status bar */}
      {planStatus && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderRadius: 10, marginBottom: 20,
          background: 'var(--surface-bg)', border: '1px solid var(--border)',
        }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', margin: 0 }}>
              {planStatus.used} / {planStatus.limit} numbers used
            </p>
            <p style={{ fontSize: 11, color: 'var(--t4)', margin: '2px 0 0' }}>
              {planStatus.tier} plan · {planStatus.can_provision ? `${planStatus.limit - planStatus.used} slot(s) remaining` : 'Limit reached - upgrade to add more'}
            </p>
          </div>
          <div style={{ height: 6, width: 120, background: 'var(--surface-bg-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(planStatus.used / planStatus.limit * 100, 100)}%`, background: planStatus.can_provision ? '#00C37A' : '#FF4444', borderRadius: 3, transition: 'width 0.4s ease' }} />
          </div>
        </div>
      )}

      {/* Phone list */}
      <div className="space-y-2 mb-5">
        {phoneList.length === 0 && (
          <div className="text-center py-8">
            <Phone size={28} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[14px] text-text-muted">No phone numbers yet</p>
            <p className="text-[12px] text-text-muted mt-1">Get a number below to start calling leads</p>
          </div>
        )}
        {phoneList.filter(p => !p.released_at).map(p => {
          // Real E.164 number (e.g. +17045551234) - show it directly
          // SIP URI or missing - show friendly name or state label instead
          const isRealNumber = p.number && p.number.startsWith('+')
          const displayNumber = isRealNumber
            ? p.number
            : p.friendly_name || (p.state ? `${p.state} Calling Line` : 'AI Calling Line')
          return (
          <div key={p.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }} className="last:border-0">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--t1)', margin: 0, letterSpacing: '0.03em', fontFamily: 'Geist Mono, monospace' }}>{displayNumber}</p>
                  {p.is_primary && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(0,195,122,0.12)', color: '#00C37A', letterSpacing: '0.04em' }}>PRIMARY</span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: 'var(--t4)', margin: '0 0 3px' }}>
                  {p.state || 'All states'} · {p.daily_calls_made || 0}/{p.daily_call_limit || 50} calls today
                </p>
                <div className="flex items-center gap-3">
                  {p.monthly_cost && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', background: 'var(--surface-bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                      ${Number(p.monthly_cost).toFixed(2)}/mo
                    </span>
                  )}
                  {p.purchased_at && (
                    <span style={{ fontSize: 11, color: 'var(--t4)' }}>Active since {fmtDate(p.purchased_at)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={healthColor(p.health_status)}>{p.health_status || 'healthy'}</Badge>
                <span style={{ fontSize: 11, color: 'var(--t4)' }}>Score: {p.spam_score ?? 100}</span>
                <button
                  onClick={() => setReleaseTarget(p)}
                  title="Release number"
                  style={{ color: 'var(--t4)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#D93030'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--t4)'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        )})}
      </div>

      {/* Get a Number - provisioning */}
      {!showProvision ? (
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="primary"
            onClick={() => setShowProvision(true)}
            disabled={planStatus && !planStatus.can_provision}
          >
            <Plus size={14} /> Get a Number
          </Button>
          <Button variant="secondary" loading={syncing} onClick={handleSync}>
            Sync Numbers
          </Button>
          <Button variant="ghost" onClick={() => setShowProvision('manual')}>
            <Plus size={14} /> Add Manually
          </Button>
        </div>
      ) : showProvision === 'manual' ? (
        <AddPhoneForm onAdd={(num) => { setPhoneList(prev => [...prev, num]); setShowProvision(false) }} onCancel={() => setShowProvision(false)} />
      ) : (
        <div style={{ borderRadius: 12, padding: 20, background: 'rgba(0,195,122,0.04)', border: '1px solid rgba(0,195,122,0.18)' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>Buy a Real Phone Number</p>
          <p style={{ fontSize: 12, color: 'var(--t4)', marginBottom: 16 }}>Enter the area code for the state you're targeting. You'll get a real local number (e.g. +17045551234) that sellers will see on their phone.</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Input
              label="Area Code *"
              value={provisionForm.area_code}
              onChange={e => setProvisionForm(p => ({ ...p, area_code: e.target.value.replace(/\D/, '').slice(0, 3) }))}
              placeholder="704 = Charlotte NC"
              maxLength={3}
            />
            <Input
              label="Label (optional)"
              value={provisionForm.friendly_name}
              onChange={e => setProvisionForm(p => ({ ...p, friendly_name: e.target.value }))}
              placeholder="NC Outreach Line"
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleProvision} loading={provisioning}>Buy Number</Button>
            <Button variant="ghost" onClick={() => setShowProvision(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Release confirmation modal */}
      {releaseTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 28, maxWidth: 420, width: '90%',
            boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', margin: '0 0 8px' }}>Release this number?</p>
            <p style={{ fontSize: 13, color: 'var(--t3)', margin: '0 0 6px' }}>{releaseTarget.number}</p>
            <p style={{ fontSize: 12, color: '#D93030', margin: '0 0 20px', lineHeight: 1.5 }}>
              This will permanently cancel the number in Vapi. Any active campaigns using this number will be interrupted. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleRelease}
                disabled={releasing}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                  background: '#D93030', color: '#fff', fontWeight: 700,
                  fontSize: 13, cursor: releasing ? 'not-allowed' : 'pointer', opacity: releasing ? 0.6 : 1,
                }}
              >
                {releasing ? 'Releasing…' : 'Yes, Release Number'}
              </button>
              <button
                onClick={() => setReleaseTarget(null)}
                disabled={releasing}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--border)',
                  background: 'var(--surface-bg)', color: 'var(--t2)', fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

function AddBankAccountForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    label: 'Primary',
    bank_name: '',
    account_holder_name: '',
    account_type: 'Checking',
    routing_number: '',
    account_number: '',
    bank_address: '',
    swift_code: '',
    additional_instructions: '',
    is_default: true,
  })
  const [showRouting, setShowRouting] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.value }))

  const handleSave = async () => {
    if (!form.bank_name.trim()) { toast.error('Bank name is required'); return }
    if (!form.account_holder_name.trim()) { toast.error('Account holder name is required'); return }
    if (!form.routing_number || form.routing_number.length < 9) { toast.error('Routing number must be 9 digits'); return }
    if (!form.account_number || form.account_number.length < 6) { toast.error('Account number is required'); return }

    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 border border-primary/20 rounded-lg p-4 bg-primary/5">
      <p className="text-[13px] font-medium text-text-primary mb-3">New Bank Account</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Account Label" value={form.label} onChange={set('label')} placeholder="Primary" />
        <Input label="Bank Name" value={form.bank_name} onChange={set('bank_name')} placeholder="Chase, Wells Fargo..." />
      </div>
      <Input label="Account Holder Name" value={form.account_holder_name} onChange={set('account_holder_name')} placeholder="Your full legal name" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-caps block mb-1.5">Account Type</label>
          <select value={form.account_type} onChange={set('account_type')}
            className="h-[44px] w-full bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary">
            {['Checking', 'Savings', 'Business Checking', 'Business Savings'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <Input label="SWIFT/BIC (international)" value={form.swift_code} onChange={set('swift_code')} placeholder="Optional" />
      </div>
      <div className="relative">
        <Input label="Routing Number (9 digits)" value={form.routing_number} onChange={set('routing_number')} type={showRouting ? 'text' : 'password'} placeholder="•••••••••" />
        <button onClick={() => setShowRouting(p => !p)} className="absolute right-3 top-[34px] text-text-muted hover:text-text-primary">
          {showRouting ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="relative">
        <Input label="Account Number" value={form.account_number} onChange={set('account_number')} type={showAccount ? 'text' : 'password'} placeholder="••••••••••••" />
        <button onClick={() => setShowAccount(p => !p)} className="absolute right-3 top-[34px] text-text-muted hover:text-text-primary">
          {showAccount ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <Input label="Bank Address (optional)" value={form.bank_address} onChange={set('bank_address')} placeholder="123 Main St, New York, NY 10001" />
      <Input label="Wire Instructions / Special Notes (optional)" value={form.additional_instructions} onChange={set('additional_instructions')} placeholder="Reference: Veori AI" />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.is_default} onChange={e => setForm(p => ({...p, is_default: e.target.checked}))} className="rounded" />
        <span className="text-[13px] text-text-secondary">Set as default account</span>
      </label>
      <div className="bg-warning/5 border border-warning/20 rounded-[6px] px-3 py-2">
        <p className="text-[11px] text-text-secondary">Your account numbers are stored securely. Only the last 4 digits are visible after saving.</p>
      </div>
      <div className="flex gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Save Account</Button>
      </div>
    </div>
  )
}

// ─── 2FA Panel ────────────────────────────────────────────────────────────────
function TwoFactorPanel() {
  const [status,       setStatus]       = useState(null)   // { enabled, method }
  const [loading,      setLoading]      = useState(true)
  const [step,         setStep]         = useState('idle') // idle | setup_totp_pre | setup_totp | setup_email | activating | disabling
  const [qrCode,       setQrCode]       = useState(null)
  const [secret,       setSecret]       = useState(null)
  const [code,         setCode]         = useState('')
  const [disablePass,  setDisablePass]  = useState('')
  const [working,      setWorking]      = useState(false)

  useEffect(() => {
    twoFA.status()
      .then(r => setStatus(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const startTOTP = async () => {
    setWorking(true)
    try {
      const { data } = await twoFA.setupTOTP()
      setQrCode(data.qr_code)
      setSecret(data.secret)
      setStep('setup_totp')
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to start setup') }
    finally { setWorking(false) }
  }

  const startEmail = async () => {
    setWorking(true)
    try {
      await twoFA.setupEmail()
      setStep('activating')
      toast.success('Verification code sent to your email')
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to send email') }
    finally { setWorking(false) }
  }

  const activate = async () => {
    if (!code.trim()) { toast.error('Enter the 6-digit code'); return }
    setWorking(true)
    try {
      await twoFA.activate(code.replace(/\s/g, ''))
      setStatus({ enabled: true, method: step === 'setup_totp' ? 'totp' : step === 'setup_sms' ? 'sms' : 'email' })
      setStep('idle'); setCode(''); setQrCode(null); setSecret(null)
      toast.success('Two-factor authentication is now ON')
    } catch (err) { toast.error(err.response?.data?.error || 'Invalid code') }
    finally { setWorking(false) }
  }

  const disable = async () => {
    if (!disablePass.trim()) { toast.error('Enter your password to confirm'); return }
    setWorking(true)
    try {
      await twoFA.disable(disablePass)
      setStatus({ enabled: false, method: null })
      setStep('idle'); setDisablePass('')
      toast.success('Two-factor authentication disabled')
    } catch (err) { toast.error(err.response?.data?.error || 'Incorrect password') }
    finally { setWorking(false) }
  }

  const METHOD_ICONS = { totp: QrCode, sms: Smartphone, email: Mail }
  const METHOD_LABELS = { totp: 'Authenticator App', sms: 'SMS', email: 'Email' }

  if (loading) return <p className="text-[13px] text-text-muted">Loading…</p>

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${status?.enabled ? 'bg-primary/5 border-primary/20' : 'bg-surface border-border-subtle'}`}>
        <Shield size={16} className={status?.enabled ? 'text-primary' : 'text-text-muted'} />
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-text-primary">
            {status?.enabled ? `2FA ON — ${METHOD_LABELS[status.method] || status.method}` : '2FA is OFF'}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {status?.enabled
              ? 'Your account requires a verification code at every login.'
              : 'Enable 2FA to add an extra layer of security to your account.'}
          </p>
        </div>
        {status?.enabled && <Badge variant="green">Active</Badge>}
      </div>

      {/* Enable flow */}
      {!status?.enabled && step === 'idle' && (
        <div>
          <p className="text-[12px] text-text-muted mb-3">Choose a verification method:</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'totp',  Icon: QrCode, label: 'Authenticator App', sub: 'Google Authenticator, Authy' },
              { id: 'email', Icon: Mail,   label: 'Email',             sub: 'Code sent to your email' },
            ].map(({ id, Icon, label, sub }) => (
              <button key={id}
                onClick={() => { setStep(id === 'totp' ? 'setup_totp_pre' : 'setup_email') }}
                style={{ padding: '16px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-bg)', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#00C37A'; e.currentTarget.style.background = 'rgba(0,195,122,0.04)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface-bg)' }}
              >
                <Icon size={20} style={{ color: '#00C37A', margin: '0 auto 8px' }} />
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', margin: '0 0 3px' }}>{label}</p>
                <p style={{ fontSize: 10, color: 'var(--t4)', margin: 0 }}>{sub}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TOTP — start */}
      {step === 'setup_totp_pre' && (
        <div className="space-y-3">
          <p className="text-[13px] text-text-secondary">Click below to generate your QR code, then scan it with Google Authenticator or Authy.</p>
          <div className="flex gap-2">
            <Button onClick={startTOTP} loading={working}>Generate QR Code</Button>
            <Button variant="ghost" onClick={() => setStep('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {/* TOTP — QR code + enter code */}
      {step === 'setup_totp' && (
        <div className="space-y-4">
          <div className="flex gap-6 items-start">
            <div>
              <p className="text-[12px] font-semibold text-text-primary mb-2">1. Scan with your app</p>
              {qrCode && <img src={qrCode} alt="2FA QR Code" style={{ width: 160, height: 160, borderRadius: 10, border: '1px solid var(--border)', background: '#fff' }} />}
              <p className="text-[10px] text-text-muted mt-2">Or enter manually:</p>
              <code style={{ fontSize: 10, color: 'var(--t3)', wordBreak: 'break-all', display: 'block', maxWidth: 160 }}>{secret}</code>
            </div>
            <div className="flex-1">
              <p className="text-[12px] font-semibold text-text-primary mb-2">2. Enter the 6-digit code</p>
              <Input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                style={{ fontFamily: 'Geist Mono, monospace', letterSpacing: '0.2em', fontSize: 20 }}
              />
              <div className="flex gap-2 mt-3">
                <Button onClick={activate} loading={working} disabled={code.length < 6}>Enable 2FA</Button>
                <Button variant="ghost" onClick={() => { setStep('idle'); setQrCode(null); setSecret(null); setCode('') }}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email — auto-send, go straight to activating */}
      {step === 'setup_email' && (
        <div className="space-y-3">
          <p className="text-[13px] text-text-secondary">A 6-digit code will be sent to your email at every login.</p>
          <div className="flex gap-2">
            <Button onClick={startEmail} loading={working}>Send Verification Code</Button>
            <Button variant="ghost" onClick={() => setStep('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Activate — enter code */}
      {step === 'activating' && (
        <div className="space-y-3">
          <Input
            label="Enter the 6-digit code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            style={{ fontFamily: 'Geist Mono, monospace', letterSpacing: '0.2em', fontSize: 20 }}
          />
          <div className="flex gap-2">
            <Button onClick={activate} loading={working} disabled={code.length < 6}>Confirm & Enable</Button>
            <Button variant="ghost" onClick={() => { setStep('idle'); setCode('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Disable 2FA */}
      {status?.enabled && step === 'idle' && (
        <div className="pt-2">
          <Button variant="danger" onClick={() => setStep('disabling')}>Disable 2FA</Button>
        </div>
      )}

      {step === 'disabling' && (
        <div className="space-y-3 border border-danger/20 bg-danger/5 rounded-lg p-4">
          <p className="text-[13px] font-semibold text-danger">Disable Two-Factor Authentication</p>
          <p className="text-[12px] text-text-muted">Enter your password to confirm. Your account will be less secure without 2FA.</p>
          <Input
            label="Your password"
            type="password"
            value={disablePass}
            onChange={e => setDisablePass(e.target.value)}
            placeholder="••••••••••••"
          />
          <div className="flex gap-2">
            <Button variant="danger" onClick={disable} loading={working}>Yes, Disable 2FA</Button>
            <Button variant="ghost" onClick={() => { setStep('idle'); setDisablePass('') }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const [tab, setTab]             = useState('profile')
  const [phoneList, setPhoneList] = useState([])
  const [loading, setLoading]     = useState(false)
  const [alertToggles, setAlertToggles] = useState({
    'Inbound call received': true,
    'High motivation score': true,
    'Offer accepted verbally': true,
    'Contract ready to send': true,
    'Campaign completed': false,
    'Deal velocity dropped': true,
    'Market hotspot alert': false,
    'Title confirmation overdue': true,
  })
  const [persona, setPersona]     = useState({})
  const [bankAccounts, setBankAccounts] = useState([])
  const [showAddBank, setShowAddBank]   = useState(false)
  const [profileForm, setProfileForm] = useState({ full_name: '', company_name: '', email: '', phone: '', email_from_name: '', email_reply_to: '' })
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
  const { theme, toggleTheme } = useThemeStore()

  const isAdmin = user?.role === 'admin' || user?.role === 'owner'

  // ── Subscription ─────────────────────────────────────────────────────────
  const [billingInfo, setBillingInfo] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('veori_token')
    fetch('https://veori-ai-main-production.up.railway.app/api/fw-billing/subscription', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { if (d.success) setBillingInfo(d) })
      .catch(() => {})
  }, [])

  // ── Social media connections ─────────────────────────────────────────────
  const [socialConnections, setSocialConnections] = useState([])
  const [socialLoading, setSocialLoading]         = useState(false)

  const loadSocial = () => {
    setSocialLoading(true)
    fetch(`${API_SOCIAL}/social-connections`, { headers: socialAuthHeader() })
      .then(r => r.json())
      .then(d => setSocialConnections(d.connections || []))
      .catch(() => {})
      .finally(() => setSocialLoading(false))
  }

  useEffect(() => { if (tab === 'social') loadSocial() }, [tab])

  const connectPlatform = async (platform) => {
    try {
      const r = await fetch(`${API_SOCIAL}/social-connections/auth-url/${platform}`, { headers: socialAuthHeader() })
      const d = await r.json()

      if (d.success && d.url) {
        // Open OAuth popup
        const popup = window.open(d.url, `connect_${platform}`, 'width=620,height=720,scrollbars=yes')

        // Listen for the popup to post back success/error
        const handler = (event) => {
          if (event.data?.type === 'OAUTH_SUCCESS' && event.data.platform === platform) {
            window.removeEventListener('message', handler)
            loadSocial()
            toast.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected!`)
          }
          if (event.data?.type === 'OAUTH_ERROR') {
            window.removeEventListener('message', handler)
            toast.error('Connection cancelled or failed. Please try again.')
          }
        }
        window.addEventListener('message', handler)

        // Fallback: if popup closes without posting a message, reload after 5s
        const pollClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(pollClosed)
            window.removeEventListener('message', handler)
            setTimeout(loadSocial, 500)
          }
        }, 500)
      } else {
        // Platform not yet configured - show a clean, operator-friendly message
        toast.error(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connection coming soon.`)
      }
    } catch {
      toast.error('Could not start connection. Please try again.')
    }
  }

  const disconnectPlatform = async (platform) => {
    if (!confirm(`Disconnect ${platform}?`)) return
    await fetch(`${API_SOCIAL}/social-connections/${platform}`, { method: 'DELETE', headers: socialAuthHeader() })
    loadSocial()
  }

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name || '',
      company_name: user?.company_name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      email_from_name: user?.email_from_name || '',
      email_reply_to: user?.email_reply_to || '',
    })
  }, [user])

  useEffect(() => {
    if (tab === 'phones') {
      phones.getPhones().then(r => {
        const raw = r.data?.numbers ?? r.data?.data ?? r.data
        setPhoneList(Array.isArray(raw) ? raw : [])
      }).catch(() => {})
    }
    if (tab === 'persona') {
      operatorApi.getProfile().then(r => setPersona(r.data?.profile || {})).catch(() => {})
    }
    if (tab === 'banking') {
      operatorApi.getBankAccounts().then(r => {
        const raw = r.data?.accounts ?? r.data?.data ?? r.data
        setBankAccounts(Array.isArray(raw) ? raw : [])
      }).catch(() => {})
    }
  }, [tab])

  const healthColor = (h) => {
    const s = h?.toLowerCase()
    if (s === 'healthy') return 'green'
    if (s === 'warning') return 'amber'
    return 'red'
  }

  const saveProfile = async () => {
    if (!profileForm.full_name.trim()) { toast.error('Full name is required'); return }
    if (!profileForm.email.trim())     { toast.error('Email is required'); return }

    setLoading(true)
    try {
      const { data } = await operatorApi.updateProfile({
        full_name: profileForm.full_name.trim(),
        company_name: profileForm.company_name.trim(),
        phone: profileForm.phone.trim(),
        email_from_name: profileForm.email_from_name.trim(),
        email_reply_to: profileForm.email_reply_to.trim(),
      })
      updateUser({ ...data?.profile, email: profileForm.email.trim() })
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save profile')
    } finally {
      setLoading(false)
    }
  }

  const updatePassword = async () => {
    const { current_password, new_password, confirm_password } = passwordForm
    if (!current_password || !new_password || !confirm_password) {
      toast.error('Fill in all password fields'); return
    }
    if (new_password.length < 12) {
      toast.error('New password must be at least 12 characters'); return
    }
    if (!/[A-Z]/.test(new_password)) {
      toast.error('New password must contain at least one uppercase letter'); return
    }
    if (!/[0-9]/.test(new_password)) {
      toast.error('New password must contain at least one number'); return
    }
    if (!/[^A-Za-z0-9]/.test(new_password)) {
      toast.error('New password must contain at least one special character'); return
    }
    if (new_password !== confirm_password) {
      toast.error('New passwords do not match'); return
    }

    setLoading(true)
    try {
      await auth.changePassword({ current_password, new_password })
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      toast.success('Password updated')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  const addBankAccount = async (form) => {
    try {
      const { data } = await operatorApi.addBankAccount(form)
      setBankAccounts(prev => form.is_default
        ? [data.account, ...prev.map(a => ({ ...a, is_default: false }))]
        : [...prev, data.account]
      )
      setShowAddBank(false)
      toast.success('Bank account saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save bank account')
      throw err
    }
  }

  const deleteBankAccount = async (id) => {
    try {
      await operatorApi.deleteBankAccount(id)
      setBankAccounts(prev => prev.filter(a => a.id !== id))
      toast.success('Account removed')
    } catch {
      toast.error('Failed to remove account')
    }
  }

  return (
    <div className="p-8 max-w-[900px] mx-auto">
      <div className="mb-8">
        <h1 className="text-[28px] font-medium text-text-primary">Settings</h1>
        <p className="text-[13px] text-text-muted mt-1">Manage your account, phone numbers, and integrations</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar tabs */}
        <div className="w-[180px] flex-shrink-0">
          <nav className="space-y-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[6px] text-left text-[13px] transition-colors ${
                  tab === id ? 'bg-card border border-border-subtle text-white' : 'text-text-muted hover:text-text-secondary hover:bg-surface'
                }`}>
                <Icon size={14} strokeWidth={1.5} />
                {label}
              </button>
            ))}
            {isAdmin && (
              <button onClick={() => setTab('api')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[6px] text-left text-[13px] transition-colors ${
                  tab === 'api' ? 'bg-card border border-border-subtle text-white' : 'text-text-muted hover:text-text-secondary hover:bg-surface'
                }`}>
                <Key size={14} strokeWidth={1.5} />
                API Keys
              </button>
            )}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4">

          {tab === 'profile' && (
            <>
              <Section title="Account Information" description="Your personal and business details">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Full Name" value={profileForm.full_name} onChange={e => setProfileForm(p => ({...p, full_name: e.target.value}))} placeholder="John Smith" />
                    <Input label="Company Name" value={profileForm.company_name} onChange={e => setProfileForm(p => ({...p, company_name: e.target.value}))} placeholder="Smith Acquisitions" />
                  </div>
                  <Input label="Email" type="email" value={profileForm.email} onChange={e => setProfileForm(p => ({...p, email: e.target.value}))} placeholder="you@company.com" disabled hint="Email changes are not available from Settings." />
                  <Input label="Phone" type="tel" value={profileForm.phone} onChange={e => setProfileForm(p => ({...p, phone: e.target.value}))} placeholder="+1 (555) 000-0000" />
                  <div className="pt-2">
                    <Button onClick={saveProfile} loading={loading}>Save Changes</Button>
                  </div>
                </div>
              </Section>

              <Section title="Email Settings" description="Control how your emails appear to sellers. Emails are sent from Veori's verified domain but show your name.">
                <div className="space-y-4">
                  <Input
                    label="Sender Name"
                    value={profileForm.email_from_name}
                    onChange={e => setProfileForm(p => ({...p, email_from_name: e.target.value}))}
                    placeholder={`${profileForm.full_name || 'Alex'} at ${profileForm.company_name || 'My Company'}`}
                    hint='Name sellers see in their inbox, e.g. "John at ABC Investments"'
                  />
                  <Input
                    label="Reply-To Email"
                    type="email"
                    value={profileForm.email_reply_to}
                    onChange={e => setProfileForm(p => ({...p, email_reply_to: e.target.value}))}
                    placeholder="you@yourcompany.com"
                    hint="When sellers reply to an email, it goes to this address instead of the shared inbox."
                  />
                  <div className="pt-2">
                    <Button onClick={saveProfile} loading={loading}>Save Email Settings</Button>
                  </div>
                </div>
              </Section>

              <Section title="Display Preferences" description="Theme and appearance">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-[14px] text-text-primary">Color Mode</p>
                    <p className="text-[12px] text-text-muted mt-0.5">Synced to your account across all devices</p>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className="flex items-center gap-2 px-4 py-2 bg-elevated border border-border-subtle rounded-[6px] text-[13px] text-text-primary hover:border-primary/40 transition-colors"
                  >
                    {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                    {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                  </button>
                </div>
              </Section>

              <Section title="Subscription" description="Your current plan and usage">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-[14px] font-medium text-text-primary capitalize">
                      {billingInfo?.plan_name || user?.plan || 'Free'} Plan
                    </p>
                    <p className="text-[12px] text-text-muted mt-0.5">
                      {billingInfo?.dials?.toLocaleString() || user?.calls_limit || 0} AI dials/month
                      {billingInfo?.expires_at ? ` · Renews ${new Date(billingInfo.expires_at).toLocaleDateString()}` : ''}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: billingInfo?.status === 'active' ? '#00C37A' : '#FF9500' }}>
                      {billingInfo?.status === 'active' ? '● Active' : billingInfo?.status === 'cancelled' ? '● Cancelled' : '● No active plan'}
                    </p>
                  </div>
                  <Badge variant="green">{billingInfo?.plan_name || user?.plan || 'Free'}</Badge>
                </div>
                <div className="mt-4">
                  <Button variant="secondary" onClick={() => window.location.href = '/billing'}>
                    {billingInfo?.status === 'active' ? 'Manage Plan' : 'Upgrade Plan'}
                  </Button>
                </div>
              </Section>
            </>
          )}

          {tab === 'phones' && (
            <PhoneTab phoneList={phoneList} setPhoneList={setPhoneList} />
          )}

          {tab === 'security' && (
            <>
              <Section title="Two-Factor Authentication" description="Require a verification code at login — Google Authenticator, SMS, or Email">
                <TwoFactorPanel />
              </Section>

              <Section title="Change Password" description="Use a strong password to protect your account">
                <div className="space-y-4">
                  <div className="relative">
                    <Input label="Current Password" type={showPasswords.current ? 'text' : 'password'} value={passwordForm.current_password} onChange={e => setPasswordForm(p => ({...p, current_password: e.target.value}))} placeholder="••••••••••••" />
                    <button onClick={() => setShowPasswords(p => ({...p, current: !p.current}))} className="absolute right-3 top-[34px] text-text-muted hover:text-text-primary">
                      {showPasswords.current ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="relative">
                    <Input label="New Password" type={showPasswords.new ? 'text' : 'password'} value={passwordForm.new_password} onChange={e => setPasswordForm(p => ({...p, new_password: e.target.value}))} placeholder="••••••••••••" />
                    <button onClick={() => setShowPasswords(p => ({...p, new: !p.new}))} className="absolute right-3 top-[34px] text-text-muted hover:text-text-primary">
                      {showPasswords.new ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <PasswordStrengthBar password={passwordForm.new_password} />
                  </div>
                  <div className="relative">
                    <Input label="Confirm New Password" type={showPasswords.confirm ? 'text' : 'password'} value={passwordForm.confirm_password} onChange={e => setPasswordForm(p => ({...p, confirm_password: e.target.value}))} placeholder="••••••••••••" />
                    <button onClick={() => setShowPasswords(p => ({...p, confirm: !p.confirm}))} className="absolute right-3 top-[34px] text-text-muted hover:text-text-primary">
                      {showPasswords.confirm ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="bg-surface border border-border-subtle rounded-[6px] px-4 py-3">
                    <p className="text-[12px] text-text-secondary font-medium mb-1.5">Password requirements:</p>
                    {[
                      { label: 'At least 12 characters', check: passwordForm.new_password.length >= 12 },
                      { label: 'At least one uppercase letter', check: /[A-Z]/.test(passwordForm.new_password) },
                      { label: 'At least one number', check: /[0-9]/.test(passwordForm.new_password) },
                      { label: 'At least one special character (!@#$%...)', check: /[^A-Za-z0-9]/.test(passwordForm.new_password) },
                    ].map(({ label, check }) => (
                      <div key={label} className="flex items-center gap-2 mt-1">
                        <CheckCircle size={12} className={check ? 'text-primary' : 'text-text-muted'} />
                        <span className={`text-[11px] ${check ? 'text-primary' : 'text-text-muted'}`}>{label}</span>
                      </div>
                    ))}
                  </div>
                  <Button onClick={updatePassword} loading={loading}>Update Password</Button>
                </div>
              </Section>
            </>
          )}

          {tab === 'alerts' && (
            <Section title="Notification Preferences" description="When to alert you about activity">
              {[
                { label: 'Inbound call received', desc: 'When a seller calls in to your number' },
                { label: 'High motivation score', desc: 'When a lead scores 80+ during a call' },
                { label: 'Offer accepted verbally', desc: 'When AI detects seller accepting an offer' },
                { label: 'Contract ready to send', desc: 'When a contract is generated and ready' },
                { label: 'Campaign completed', desc: 'When a dialing campaign finishes its queue' },
                { label: 'Deal velocity dropped', desc: 'When a deal velocity score drops below 40%' },
                { label: 'Market hotspot alert', desc: 'When a market motivation score rises 15%+ month-over-month' },
                { label: 'Title confirmation overdue', desc: 'When title company has not confirmed in 5+ days' },
              ].map(({ label, desc }) => {
                const on = alertToggles[label] ?? true
                return (
                  <div key={label} className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0">
                    <div>
                      <p className="text-[14px] text-text-primary">{label}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">{desc}</p>
                    </div>
                    <button
                      onClick={() => setAlertToggles(prev => ({ ...prev, [label]: !prev[label] }))}
                      className={`w-10 h-6 rounded-full flex-shrink-0 relative transition-colors ${on ? 'bg-primary' : 'bg-surface'}`}
                      style={{ border: on ? 'none' : '1px solid var(--border)' }}
                    >
                      <span
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform"
                        style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
                      />
                    </button>
                  </div>
                )
              })}
            </Section>
          )}

          {tab === 'persona' && (
            <>
              <Section title="AI Caller Persona" description="Customize how your AI caller presents itself">
                <div className="space-y-4">
                  <Input label="AI Caller Name" defaultValue={persona.ai_caller_name || 'Alex'} placeholder="Alex"
                    onChange={e => setPersona(p => ({ ...p, ai_caller_name: e.target.value }))} />
                  <div>
                    <label className="label-caps block mb-2">Personality Tone</label>
                    <select value={persona.ai_personality_tone || 'Professional'}
                      onChange={e => setPersona(p => ({ ...p, ai_personality_tone: e.target.value }))}
                      className="h-[44px] w-full bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary">
                      {['Professional', 'Friendly', 'Direct', 'Warm'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label-caps block mb-2">Custom Introduction Script (optional)</label>
                    <textarea rows={4} value={persona.ai_intro_script || ''}
                      placeholder="Hi is this [FirstName]? I'm Alex, an AI assistant from [Company] calling about your property at [Address]..."
                      onChange={e => setPersona(p => ({ ...p, ai_intro_script: e.target.value }))}
                      className="w-full bg-surface border border-border-subtle rounded-[6px] px-3 py-2.5 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none" />
                    <p className="text-[11px] text-text-muted mt-1">Note: Your AI caller will always identify itself as an AI when asked, per our compliance policy.</p>
                  </div>
                  <div>
                    <label className="label-caps block mb-2">Voicemail Script (optional)</label>
                    <textarea rows={3} value={persona.ai_voicemail_script || ''}
                      placeholder="Hi [FirstName], this is Alex, an AI assistant from [Company]. I've been trying to reach you about your property at [Address]..."
                      onChange={e => setPersona(p => ({ ...p, ai_voicemail_script: e.target.value }))}
                      className="w-full bg-surface border border-border-subtle rounded-[6px] px-3 py-2.5 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none" />
                  </div>
                  <Button onClick={() => operatorApi.updateProfile(persona).then(() => toast.success('Persona saved')).catch(() => toast.error('Failed to save'))}>
                    Save Persona
                  </Button>
                </div>
              </Section>

              <Section title="Contract Settings" description="Default values for all generated contracts">
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Input label="Earnest Money ($)" type="number" defaultValue={persona.earnest_money_default || 100}
                      onChange={e => setPersona(p => ({ ...p, earnest_money_default: Number(e.target.value) }))} />
                    <Input label="Closing Period (days)" type="number" defaultValue={persona.closing_period_default || 14}
                      onChange={e => setPersona(p => ({ ...p, closing_period_default: Number(e.target.value) }))} />
                    <Input label="Inspection Period (days)" type="number" defaultValue={persona.inspection_period_default || 10}
                      onChange={e => setPersona(p => ({ ...p, inspection_period_default: Number(e.target.value) }))} />
                  </div>
                  <Input label="Legal Name (for contracts)" defaultValue={persona.legal_name || ''} placeholder="Your full legal name"
                    onChange={e => setPersona(p => ({ ...p, legal_name: e.target.value, buyer_name_on_contract: e.target.value }))} />
                  <Input label="Entity Name (if LLC)" defaultValue={persona.entity_name || ''} placeholder="Smith Acquisitions LLC"
                    onChange={e => setPersona(p => ({ ...p, entity_name: e.target.value }))} />
                  <Button onClick={() => operatorApi.updateProfile(persona).then(() => toast.success('Contract settings saved')).catch(() => toast.error('Failed to save'))}>
                    Save Settings
                  </Button>
                </div>
              </Section>
            </>
          )}

          {tab === 'banking' && (
            <Section title="Wire Transfer Details" description="Used for receiving assignment fee payments - shown in title company notifications">
              <div className="bg-warning/5 border border-warning/20 rounded-[6px] px-4 py-3 mb-4">
                <p className="text-[12px] text-text-secondary">
                  Your banking information is stored securely. Only the last 4 digits of account and routing numbers are visible after saving. Never shared with sellers or buyers.
                </p>
              </div>

              <div className="space-y-3 mb-4">
                {bankAccounts.map(acct => (
                  <div key={acct.id} className={`flex items-center justify-between p-4 rounded-lg border ${acct.is_default ? 'border-primary/30 bg-primary/5' : 'border-border-subtle bg-elevated'}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-medium text-text-primary">{acct.label}</p>
                        {acct.is_default && <Badge variant="green">Default</Badge>}
                      </div>
                      <p className="text-[12px] text-text-muted mt-0.5">
                        {acct.bank_name} · {acct.account_type} · ****{acct.account_last4}
                      </p>
                      <p className="text-[11px] text-text-muted">Routing: ****{acct.routing_last4}</p>
                    </div>
                    <button onClick={() => deleteBankAccount(acct.id)} className="text-text-muted hover:text-danger transition-colors p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {bankAccounts.length === 0 && !showAddBank && (
                  <div className="text-center py-6 text-text-muted text-[13px]">No bank accounts added yet</div>
                )}
              </div>

              {showAddBank ? (
                <AddBankAccountForm onSave={addBankAccount} onCancel={() => setShowAddBank(false)} />
              ) : (
                <Button variant="secondary" onClick={() => setShowAddBank(true)}>
                  <Plus size={14} /> Add Bank Account
                </Button>
              )}
            </Section>
          )}

          {tab === 'social' && (
            <Section title="Social Media Accounts" description="Connect your social accounts. Once connected, Content Studio can post property listings directly to these platforms.">
              {socialLoading ? (
                <p className="text-[13px] text-text-muted">Loading…</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {SOCIAL_PLATFORMS.map(p => {
                    const conn = socialConnections.find(c => c.platform === p.id)
                    const isConnected = conn?.connected
                    return (
                      <div key={p.id} className="bg-surface border border-border-subtle rounded-xl p-5"
                        style={{ borderColor: isConnected ? `${p.color}40` : undefined }}>
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                            style={{ background: `${p.color}20` }}>{p.icon}</div>
                          <div>
                            <p className="text-[14px] font-semibold text-text-primary">{p.label}</p>
                            {isConnected && conn.account_name
                              ? <p className="text-[11px]" style={{ color: p.color }}>@{conn.account_name} connected</p>
                              : <p className="text-[11px] text-text-muted">{p.hint}</p>
                            }
                          </div>
                          {isConnected && (
                            <div className="ml-auto">
                              <CheckCircle size={16} style={{ color: p.color }} />
                            </div>
                          )}
                        </div>
                        {isConnected ? (
                          <button onClick={() => disconnectPlatform(p.id)}
                            className="w-full py-2 rounded-lg text-[12px] font-semibold text-danger bg-danger/10 border border-danger/20 hover:bg-danger/20 transition-colors">
                            Disconnect
                          </button>
                        ) : (
                          <button onClick={() => connectPlatform(p.id)}
                            className="w-full py-2 rounded-lg text-[12px] font-semibold transition-colors"
                            style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}30` }}
                            onMouseEnter={e => e.currentTarget.style.background = `${p.color}25`}
                            onMouseLeave={e => e.currentTarget.style.background = `${p.color}15`}>
                            Connect {p.label}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-4 p-4 bg-surface rounded-lg border border-border-subtle">
                <p className="text-[12px] text-text-muted leading-relaxed">
                  <strong className="text-text-secondary">How it works:</strong> Connect your accounts here once. Then go to <strong className="text-text-secondary">Content Studio</strong> to pick any property listing, generate an AI-written caption, and post it directly to your connected platforms or Facebook groups with one click.
                </p>
              </div>
            </Section>
          )}

          {tab === 'api' && isAdmin && (
            <Section title="API Keys" description="Connect external services (admin only)">
              <div className="space-y-4">
                {[
                  { label: 'AI Calling Key',      hint: 'Managed by Veori' },
                  { label: 'AI Engine Key',        hint: 'Managed by Veori' },
                  { label: 'Voice Engine Key',     hint: 'Managed by Veori' },
                  { label: 'E-Signature Key',      hint: 'Managed by Veori' },
                ].map(({ label, hint }) => (
                  <div key={label}>
                    <Input label={label} type="password" placeholder="Configured by Veori" disabled />
                    <p className="text-[11px] text-text-muted mt-1">{hint}</p>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-4 px-3 py-3 bg-primary/5 border border-primary/20 rounded-[6px]">
                  <CheckCircle size={14} className="text-primary flex-shrink-0" />
                  <p className="text-[12px] text-text-secondary">All integrations are managed securely by Veori. No setup needed on your end.</p>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
