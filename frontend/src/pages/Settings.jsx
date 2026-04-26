import React, { useState, useEffect } from 'react'
import { User, Key, Phone, Bell, Shield, Plus, Trash2, CheckCircle, Sparkles, CreditCard, Eye, EyeOff, Moon, Sun } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import useAuthStore from '../store/authStore'
import useThemeStore from '../store/themeStore'
import { phones, operator as operatorApi, auth } from '../services/api'

const TABS = [
  { id: 'profile',  label: 'Profile',       icon: User },
  { id: 'phones',   label: 'Phone Numbers', icon: Phone },
  { id: 'security', label: 'Security',      icon: Shield },
  { id: 'alerts',   label: 'Alerts',        icon: Bell },
  { id: 'persona',  label: 'AI Persona',    icon: Sparkles },
  { id: 'banking',  label: 'Banking',       icon: CreditCard },
]

function Section({ title, description, children }) {
  return (
    <div className="bg-card border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-6 py-5 border-b border-border-subtle">
        <h3 className="text-[15px] font-medium text-white">{title}</h3>
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
      <p className="text-[13px] font-medium text-white mb-3">New Bank Account</p>
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

export default function Settings() {
  const [tab, setTab]             = useState('profile')
  const [phoneList, setPhoneList] = useState([])
  const [loading, setLoading]     = useState(false)
  const [persona, setPersona]     = useState({})
  const [bankAccounts, setBankAccounts] = useState([])
  const [showAddBank, setShowAddBank]   = useState(false)
  const [profileForm, setProfileForm] = useState({ full_name: '', company_name: '', email: '', phone: '' })
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
  const { theme, toggleTheme } = useThemeStore()

  const isAdmin = user?.role === 'admin' || user?.role === 'owner'

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name || '',
      company_name: user?.company_name || '',
      email: user?.email || '',
      phone: user?.phone || '',
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
        <h1 className="text-[28px] font-medium text-white">Settings</h1>
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
                    <p className="text-[14px] font-medium text-white capitalize">{user?.plan || 'Hustle'} Plan</p>
                    <p className="text-[12px] text-text-muted mt-0.5">{user?.calls_used || 0} / {user?.calls_limit || '∞'} calls used this month</p>
                  </div>
                  <Badge variant="green">{user?.plan || 'Hustle'}</Badge>
                </div>
                <div className="mt-4">
                  <Button variant="secondary">Upgrade Plan</Button>
                </div>
              </Section>
            </>
          )}

          {tab === 'phones' && (
            <Section title="Phone Numbers" description="Manage your Vapi calling numbers and health scores">
              <div className="space-y-2 mb-4">
                {phoneList.length === 0 && (
                  <div className="text-center py-8">
                    <Phone size={28} className="text-text-muted mx-auto mb-3" strokeWidth={1.5} />
                    <p className="text-[14px] text-text-muted">No phone numbers configured</p>
                    <p className="text-[12px] text-text-muted mt-1">Add your Vapi phone numbers to start calling</p>
                  </div>
                )}
                {phoneList.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0">
                    <div>
                      <p className="text-[14px] font-medium text-text-primary">{p.number}</p>
                      <p className="text-[11px] text-text-muted">{p.state || 'Unknown state'} · {p.daily_calls_made || 0} calls today</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={healthColor(p.health_status)}>{p.health_status || 'healthy'}</Badge>
                      <span className="text-[12px] text-text-muted">Score: {p.spam_score || 100}</span>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="secondary" onClick={() => toast.info('Add numbers in your Vapi dashboard and sync them here')}>
                <Plus size={14} /> Add Phone Number
              </Button>
            </Section>
          )}

          {tab === 'security' && (
            <>
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
              ].map(({ label, desc }) => (
                <div key={label} className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0">
                  <div>
                    <p className="text-[14px] text-text-primary">{label}</p>
                    <p className="text-[11px] text-text-muted mt-0.5">{desc}</p>
                  </div>
                  <button className="w-10 h-6 rounded-full bg-primary flex-shrink-0 relative transition-colors">
                    <span className="absolute right-1 top-1 w-4 h-4 bg-black rounded-full shadow transition-transform" />
                  </button>
                </div>
              ))}
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
            <Section title="Wire Transfer Details" description="Used for receiving assignment fee payments — shown in title company notifications">
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

          {tab === 'api' && isAdmin && (
            <Section title="API Keys" description="Connect external services (admin only)">
              <div className="space-y-4">
                {[
                  { label: 'Vapi API Key', hint: 'From vapi.ai dashboard' },
                  { label: 'Anthropic API Key', hint: 'From console.anthropic.com' },
                  { label: 'OpenAI API Key', hint: 'From platform.openai.com' },
                  { label: 'ElevenLabs API Key', hint: 'From elevenlabs.io dashboard' },
                  { label: 'Dropbox Sign API Key', hint: 'From sign.dropbox.com' },
                  { label: 'Redis URL', hint: 'Railway Redis addon or Upstash' },
                ].map(({ label, hint }) => (
                  <div key={label}>
                    <Input label={label} type="password" placeholder="Set in Railway environment variables" disabled />
                    <p className="text-[11px] text-text-muted mt-1">{hint}</p>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-4 px-3 py-3 bg-primary/5 border border-primary/20 rounded-[6px]">
                  <CheckCircle size={14} className="text-primary flex-shrink-0" />
                  <p className="text-[12px] text-text-secondary">API keys are set securely in Railway environment variables, not stored in the database.</p>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
