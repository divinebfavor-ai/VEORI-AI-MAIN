import React, { useState, useEffect } from 'react'
import { User, Key, Phone, Bell, Shield, Plus, Trash2, CheckCircle, Sparkles, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import useAuthStore from '../store/authStore'
import { phones, operator as operatorApi } from '../services/api'

const TABS = [
  { id: 'profile',  label: 'Profile',       icon: User },
  { id: 'phones',   label: 'Phone Numbers', icon: Phone },
  { id: 'api',      label: 'API Keys',      icon: Key },
  { id: 'alerts',   label: 'Alerts',        icon: Bell },
  { id: 'security', label: 'Security',      icon: Shield },
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

export default function Settings() {
  const [tab, setTab]             = useState('profile')
  const [phoneList, setPhoneList] = useState([])
  const [loading, setLoading]     = useState(false)
  const [persona, setPersona]     = useState({})
  const [bankAccounts, setBankAccounts] = useState([])
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    company_name: '',
    email: '',
    phone: '',
  })
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)

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
      phones.getPhones().then(r => { const raw = r.data?.numbers ?? r.data?.data ?? r.data; setPhoneList(Array.isArray(raw) ? raw : []) }).catch(() => {})
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

  const setProfile = (field) => (e) => {
    setProfileForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const setPassword = (field) => (e) => {
    setPasswordForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const saveProfile = async () => {
    if (!profileForm.full_name.trim()) {
      toast.error('Full name is required')
      return
    }

    if (!profileForm.email.trim()) {
      toast.error('Email is required')
      return
    }

    setLoading(true)
    try {
      const { data } = await operatorApi.updateProfile({
        full_name: profileForm.full_name.trim(),
        company_name: profileForm.company_name.trim(),
        phone: profileForm.phone.trim(),
      })

      updateUser({
        ...data?.profile,
        email: profileForm.email.trim(),
      })
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save profile')
    } finally {
      setLoading(false)
    }
  }

  const updatePassword = async () => {
    if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password) {
      toast.error('Fill in all password fields')
      return
    }

    if (passwordForm.new_password.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('New passwords do not match')
      return
    }

    setLoading(true)
    try {
      await auth.changePassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      })
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      toast.success('Password updated')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update password')
    } finally {
      setLoading(false)
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
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4">
          {tab === 'profile' && (
            <>
              <Section title="Account Information" description="Your personal and business details">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Full Name" value={profileForm.full_name} onChange={setProfile('full_name')} placeholder="John Smith" />
                    <Input label="Company Name" value={profileForm.company_name} onChange={setProfile('company_name')} placeholder="Smith Acquisitions" />
                  </div>
                  <Input label="Email" type="email" value={profileForm.email} onChange={setProfile('email')} placeholder="you@company.com" disabled hint="Email changes are not yet available from Settings." />
                  <Input label="Phone" type="tel" value={profileForm.phone} onChange={setProfile('phone')} placeholder="+1 (555) 000-0000" />
                  <div className="pt-2">
                    <Button onClick={saveProfile} loading={loading}>Save Changes</Button>
                  </div>
                </div>
              </Section>

              <Section title="Subscription" description="Your current plan and usage">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-[14px] font-medium text-white capitalize">{user?.plan || 'Hustle'} Plan</p>
                    <p className="text-[12px] text-text-muted mt-0.5">{user?.calls_used || 0} / {user?.calls_limit || 500} calls used this month</p>
                  </div>
                  <Badge variant="green">{user?.plan || 'Hustle'}</Badge>
                </div>
                <div className="mt-3">
                  <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((user?.calls_used||0)/(user?.calls_limit||500))*100)}%` }} />
                  </div>
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

          {tab === 'api' && (
            <Section title="API Keys" description="Connect external services">
              <div className="space-y-4">
                {[
                  { label: 'Vapi API Key', key: 'VAPI_API_KEY', hint: 'From vapi.ai dashboard' },
                  { label: 'Anthropic API Key', key: 'ANTHROPIC_API_KEY', hint: 'From console.anthropic.com' },
                  { label: 'ElevenLabs API Key', key: 'ELEVENLABS_API_KEY', hint: 'From elevenlabs.io dashboard' },
                ].map(({ label, key, hint }) => (
                  <div key={key}>
                    <Input label={label} type="password" placeholder="Set in Railway environment variables" disabled />
                    <p className="text-[11px] text-text-muted mt-1">{hint}</p>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-4 px-3 py-3 bg-primary/5 border border-primary/20 rounded-[6px]">
                  <CheckCircle size={14} className="text-primary flex-shrink-0" />
                  <p className="text-[12px] text-text-secondary">API keys are set securely in Railway environment variables, not stored here.</p>
                </div>
              </div>
            </Section>
          )}

          {tab === 'alerts' && (
            <Section title="Notification Preferences" description="When to alert you about activity">
              {[
                { label: 'Inbound call received', desc: 'When a seller calls in to your number' },
                { label: 'High motivation score', desc: 'When a lead scores 80+ during a call' },
                { label: 'Offer accepted verbally', desc: 'When AI detects seller accepting an offer' },
                { label: 'Contract ready to send', desc: 'When a contract is generated and ready' },
                { label: 'Campaign completed', desc: 'When a dialing campaign finishes its queue' },
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

          {tab === 'security' && (
            <Section title="Security" description="Password and account security">
              <div className="space-y-4">
                <Input label="Current Password" type="password" value={passwordForm.current_password} onChange={setPassword('current_password')} placeholder="••••••••" />
                <Input label="New Password" type="password" value={passwordForm.new_password} onChange={setPassword('new_password')} placeholder="••••••••" hint="Use at least 8 characters." />
                <Input label="Confirm New Password" type="password" value={passwordForm.confirm_password} onChange={setPassword('confirm_password')} placeholder="••••••••" />
                <Button onClick={updatePassword} loading={loading}>Update Password</Button>
              </div>
            </Section>
          )}

          {tab === 'persona' && (
            <>
              <Section title="AI Caller Persona" description="Customize how your AI caller presents itself">
                <div className="space-y-4">
                  <Input
                    label="AI Caller Name"
                    defaultValue={persona.ai_caller_name || 'Alex'}
                    placeholder="Alex"
                    onChange={e => setPersona(p => ({ ...p, ai_caller_name: e.target.value }))}
                  />
                  <div>
                    <label className="label-caps block mb-2">Personality Tone</label>
                    <select
                      value={persona.ai_personality_tone || 'Professional'}
                      onChange={e => setPersona(p => ({ ...p, ai_personality_tone: e.target.value }))}
                      className="h-[44px] w-full bg-surface border border-border-subtle rounded-[6px] px-3 text-[14px] text-text-primary focus:outline-none focus:border-primary"
                    >
                      {['Professional', 'Friendly', 'Direct', 'Warm'].map(t => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-caps block mb-2">Custom Introduction Script (optional)</label>
                    <textarea
                      rows={4}
                      value={persona.ai_intro_script || ''}
                      placeholder="Hi is this [FirstName]? This is [AI Name] calling about your property at [Address]..."
                      onChange={e => setPersona(p => ({ ...p, ai_intro_script: e.target.value }))}
                      className="w-full bg-surface border border-border-subtle rounded-[6px] px-3 py-2.5 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none"
                    />
                  </div>
                  <div>
                    <label className="label-caps block mb-2">Voicemail Script (optional)</label>
                    <textarea
                      rows={3}
                      value={persona.ai_voicemail_script || ''}
                      placeholder="Hi [FirstName], this is [AI Name]. I have been trying to reach you about your property at [Address]..."
                      onChange={e => setPersona(p => ({ ...p, ai_voicemail_script: e.target.value }))}
                      className="w-full bg-surface border border-border-subtle rounded-[6px] px-3 py-2.5 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none"
                    />
                  </div>
                  <Button
                    onClick={() =>
                      operatorApi.updateProfile(persona)
                        .then(() => toast.success('Persona saved'))
                        .catch(() => toast.error('Failed to save'))
                    }
                  >
                    Save Persona
                  </Button>
                </div>
              </Section>

              <Section title="Contract Settings" description="Default values for all generated contracts">
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Input
                      label="Earnest Money ($)"
                      type="number"
                      defaultValue={persona.earnest_money_default || 100}
                      onChange={e => setPersona(p => ({ ...p, earnest_money_default: Number(e.target.value) }))}
                    />
                    <Input
                      label="Closing Period (days)"
                      type="number"
                      defaultValue={persona.closing_period_default || 14}
                      onChange={e => setPersona(p => ({ ...p, closing_period_default: Number(e.target.value) }))}
                    />
                    <Input
                      label="Inspection Period (days)"
                      type="number"
                      defaultValue={persona.inspection_period_default || 10}
                      onChange={e => setPersona(p => ({ ...p, inspection_period_default: Number(e.target.value) }))}
                    />
                  </div>
                  <Input
                    label="Legal Name (for contracts)"
                    defaultValue={persona.legal_name || persona.buyer_name_on_contract || ''}
                    placeholder="Your full legal name"
                    onChange={e => setPersona(p => ({ ...p, legal_name: e.target.value, buyer_name_on_contract: e.target.value }))}
                  />
                  <Input
                    label="Entity Name (if LLC)"
                    defaultValue={persona.entity_name || ''}
                    placeholder="Smith Acquisitions LLC"
                    onChange={e => setPersona(p => ({ ...p, entity_name: e.target.value }))}
                  />
                  <Button
                    onClick={() =>
                      operatorApi.updateProfile(persona)
                        .then(() => toast.success('Contract settings saved'))
                        .catch(() => toast.error('Failed to save'))
                    }
                  >
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
                  Your banking information is encrypted and stored securely. It is only used to populate wire transfer
                  instructions in title company communications. Never shared with sellers or buyers.
                </p>
              </div>
              <div className="space-y-3 mb-4">
                {bankAccounts.map(acct => (
                  <div
                    key={acct.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      acct.is_default ? 'border-primary/30 bg-primary/5' : 'border-border-subtle bg-elevated'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-medium text-text-primary">{acct.label}</p>
                        {acct.is_default && <Badge variant="green">Default</Badge>}
                      </div>
                      <p className="text-[12px] text-text-muted mt-0.5">
                        {acct.bank_name} · {acct.account_type} · ****{acct.account_last4}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        operatorApi.deleteBankAccount(acct.id)
                          .then(() => setBankAccounts(prev => prev.filter(a => a.id !== acct.id)))
                          .catch(() => toast.error('Failed'))
                      }
                      className="text-text-muted hover:text-danger transition-colors p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {bankAccounts.length === 0 && (
                  <div className="text-center py-6 text-text-muted text-[13px]">No bank accounts added yet</div>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() => toast.info('Enter bank details in the form below and click Add Account')}
              >
                <Plus size={14} /> Add Bank Account
              </Button>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
