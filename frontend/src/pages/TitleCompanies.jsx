import React, { useState, useEffect } from 'react'
import { Plus, X, Building2, Phone, Mail, MapPin, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import { titleCompanies } from '../services/api'

function TitleModal({ onClose, onSave, existing = null }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    contact_name: existing?.contact_name || '',
    phone: existing?.phone || '',
    email: existing?.email || '',
    address: existing?.address || '',
    city: existing?.city || '',
    state: existing?.state || '',
    preferred_states: existing?.preferred_states?.join(', ') || '',
    notes: existing?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.name) { toast.error('Company name required'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        contact_name: form.contact_name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        city: form.city,
        state: form.state,
        notes: form.notes,
        preferred_states: form.preferred_states.split(',').map(s => s.trim()).filter(Boolean),
      }
      if (existing) {
        await titleCompanies.update(existing.id, payload)
      } else {
        await titleCompanies.create(payload)
      }
      toast.success(existing ? 'Updated' : 'Title company added')
      onSave()
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
      <div className="bg-card border border-border-subtle rounded-xl w-full max-w-[520px] p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[18px] font-medium text-white">
            {existing ? 'Edit Title Company' : 'Add Title Company'}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <Input label="Company Name *" value={form.name} onChange={set('name')} placeholder="First American Title" />

          <div className="grid grid-cols-2 gap-4">
            <Input label="Contact Name" value={form.contact_name} onChange={set('contact_name')} placeholder="Jane Smith" />
            <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000" />
          </div>

          <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="closings@titleco.com" />
          <Input label="Street Address" value={form.address} onChange={set('address')} placeholder="123 Main St" />

          <div className="grid grid-cols-2 gap-4">
            <Input label="City" value={form.city} onChange={set('city')} placeholder="Detroit" />
            <Input label="State" value={form.state} onChange={set('state')} placeholder="MI" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="label-caps">States They Handle (comma separated)</label>
            <input
              value={form.preferred_states}
              onChange={set('preferred_states')}
              placeholder="MI, OH, TN"
              className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-4 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="label-caps">Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={3}
              placeholder="Preferred contact method, turnaround time, etc."
              className="bg-surface border border-border-subtle rounded-[6px] px-3 py-2.5 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" loading={saving} onClick={handleSave}>
            {existing ? 'Save Changes' : 'Add Company'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function TitleCompaniesPage() {
  const [list,      setList]    = useState([])
  const [loading,   setLoading] = useState(true)
  const [showModal, setModal]   = useState(false)
  const [editing,   setEditing] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await titleCompanies.getAll()
      const raw = r.data?.companies ?? r.data?.data ?? r.data
      setList(Array.isArray(raw) ? raw : [])
    } catch { setList([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const remove = async (id) => {
    if (!window.confirm('Remove this title company?')) return
    try {
      await titleCompanies.remove(id)
      toast.success('Removed')
      load()
    } catch { toast.error('Failed to remove') }
  }

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-white">Title Companies</h1>
          <p className="text-[13px] text-text-muted mt-1">{list.length} company{list.length !== 1 ? 'ies' : 'y'} in your network</p>
        </div>
        <Button onClick={() => { setEditing(null); setModal(true) }}>
          <Plus size={14} /> Add Company
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-text-muted">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-lg py-24 text-center">
          <Building2 size={36} className="text-text-muted mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-text-primary mb-1">No title companies yet</p>
          <p className="text-[13px] text-text-muted mb-6">Add your closing partners to assign them to deals</p>
          <Button onClick={() => setModal(true)}><Plus size={14} /> Add Company</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {list.map(co => (
            <div key={co.id} className="bg-card border border-border-subtle hover:border-border-default rounded-lg p-5 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-elevated border border-border-subtle flex items-center justify-center flex-shrink-0">
                    <Building2 size={16} className="text-text-secondary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-white">{co.name}</h3>
                    {co.contact_name && <p className="text-[11px] text-text-muted">{co.contact_name}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setEditing(co); setModal(true) }}
                    className="text-text-muted hover:text-text-primary p-1 rounded transition-colors"
                  >
                    <Plus size={13} className="rotate-45" />
                  </button>
                  <button
                    onClick={() => remove(co.id)}
                    className="text-text-muted hover:text-danger p-1 rounded transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                {co.phone && (
                  <div className="flex items-center gap-2 text-[12px] text-text-muted">
                    <Phone size={11} className="flex-shrink-0" />
                    {co.phone}
                  </div>
                )}
                {co.email && (
                  <div className="flex items-center gap-2 text-[12px] text-text-muted">
                    <Mail size={11} className="flex-shrink-0" />
                    {co.email}
                  </div>
                )}
                {(co.city || co.state) && (
                  <div className="flex items-center gap-2 text-[12px] text-text-muted">
                    <MapPin size={11} className="flex-shrink-0" />
                    {[co.city, co.state].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>

              {co.preferred_states?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {co.preferred_states.map(s => (
                    <span key={s} className="text-[10px] bg-elevated border border-border-subtle text-text-secondary px-1.5 py-0.5 rounded-[3px]">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {co.notes && (
                <p className="text-[11px] text-text-muted mt-3 border-t border-border-subtle pt-3 leading-relaxed">
                  {co.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <TitleModal
          existing={editing}
          onClose={() => { setModal(false); setEditing(null) }}
          onSave={() => { setModal(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}
