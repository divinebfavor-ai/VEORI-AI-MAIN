import React, { useState, useEffect } from 'react'
import { User, Key, Phone, Bell, Shield, Plus, Trash2, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import useAuthStore from '../store/authStore'
import { phones } from '../services/api'

const TABS = [
  { id: 'profile',  label: 'Profile',       icon: User },
  { id: 'phones',   label: 'Phone Numbers', icon: Phone },
  { id: 'api',      label: 'API Keys',      icon: Key },
  { id: 'alerts',   label: 'Alerts',        icon: Bell },
  { id: 'security', label: 'Security',      icon: Shield },
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
  const [tab, setTab]         = useState('profile')
  const [phoneList, setPhoneList] = useState([])
  const [loading, setLoading] = useState(false)
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    if (tab === 'phones') {
      phones.getPhones().then(r => setPhoneList(r.data?.numbers || r.data || [])).catch(() => {})
    }
  }, [tab])

  const healthColor = (h) => {
    const s = h?.toLowerCase()
    if (s === 'healthy') return 'green'
    if (s === 'warning') return 'amber'
    return 'red'
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
                    <Input label="Full Name" defaultValue={user?.full_name || ''} placeholder="John Smith" />
                    <Input label="Company Name" defaultValue={user?.company_name || ''} placeholder="Smith Acquisitions" />
                  </div>
                  <Input label="Email" type="email" defaultValue={user?.email || ''} placeholder="you@company.com" />
                  <Input label="Phone" type="tel" defaultValue={user?.phone || ''} placeholder="+1 (555) 000-0000" />
                  <div className="pt-2">
                    <Button onClick={() => toast.success('Profile saved')}>Save Changes</Button>
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
                <Input label="Current Password" type="password" placeholder="••••••••" />
                <Input label="New Password" type="password" placeholder="••••••••" />
                <Input label="Confirm New Password" type="password" placeholder="••••••••" />
                <Button onClick={() => toast.success('Password updated')}>Update Password</Button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
