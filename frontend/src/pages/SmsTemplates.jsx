import React, { useState, useEffect } from 'react'
import { Plus, X, Trash2, Sparkles, MessageSquare, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { smsTemplates } from '../services/api'

// Lead-type tags mirror leadTaggingService — [value, friendly label]. A template
// can be tagged for one lead type, or left general (usable for any lead).
const LEAD_TYPES = [
  ['',                'General (any lead)'],
  ['pre_foreclosure', 'Pre-Foreclosure'],
  ['tax_delinquent',  'Tax Delinquent'],
  ['inherited',       'Inherited'],
  ['probate',         'Probate'],
  ['vacant',          'Vacant'],
  ['absentee_owner',  'Absentee Owner'],
  ['fsbo',            'FSBO'],
  ['free_and_clear',  'Free & Clear'],
  ['cash_buyer',      'Cash Buyer'],
]

const typeLabel = (v) => (LEAD_TYPES.find(([val]) => val === (v || ''))?.[1]) || v

// Available {tokens} an operator can drop into the body — must match
// customSmsService.TOKENS server-side so what they preview is what sends.
const TOKENS = ['first_name', 'street', 'city', 'county', 'state', 'address', 'operator']

// ─── Create / Edit Template Modal ─────────────────────────────────────────────
function TemplateModal({ initial, onClose, onSaved }) {
  const editing = !!initial?.id
  const [form, setForm]   = useState({
    name:      initial?.name || '',
    body:      initial?.body || '',
    lead_type: initial?.lead_type || '',
  })
  const [angle, setAngle]       = useState('')   // operator's angle for AI generation
  const [generating, setGen]    = useState(false)
  const [saving, setSaving]     = useState(false)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const insertToken = (tok) =>
    setForm(f => ({ ...f, body: `${f.body}${f.body && !f.body.endsWith(' ') ? ' ' : ''}{${tok}}` }))

  // AI generation: server drafts a compliant wholesale-RE SMS and self-moderates
  // it. We only fill the body for the operator to review — nothing is saved/sent.
  const generate = async () => {
    setGen(true)
    try {
      const r = await smsTemplates.generate({ lead_type: form.lead_type || 'default', angle })
      const d = r.data?.data || {}
      if (!d.body) { toast.error(d.reason || 'AI returned no draft. Try again.'); return }
      if (d.allowed === false) { toast.error(d.reason || 'Draft was not compliant. Try a different angle.'); return }
      setForm(f => ({ ...f, body: d.body }))
      toast.success('Draft generated — review & save')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'AI generation failed')
    } finally { setGen(false) }
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Template name required'); return }
    if (!form.body.trim()) { toast.error('Template body required'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), body: form.body.trim(), lead_type: form.lead_type || null }
      if (editing) await smsTemplates.update(initial.id, { ...payload, is_active: true })
      else         await smsTemplates.create(payload)
      toast.success(editing ? 'Template updated' : 'Template saved')
      onSaved()
    } catch (err) {
      // 422 = guardrail rejection (not wholesale RE / looks like fraud or spam).
      const rejected = err?.response?.data?.moderation === 'rejected'
      toast.error(err?.response?.data?.error || (rejected ? 'Blocked by content guardrail' : 'Failed to save template'))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end justify-center z-50 p-6">
      <div className="w-full max-w-[560px] bg-card border border-border-subtle rounded-xl p-8 animate-slide-in-up max-h-[90vh] overflow-y-auto scrollbar-hide">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[22px] font-medium text-text-primary">{editing ? 'Edit template' : 'New SMS template'}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="label-caps">Template Name</label>
          <input value={form.name} onChange={set('name')} placeholder="Probate soft intro"
            className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-4 text-[15px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5 mt-5">
          <label className="label-caps">Lead Type</label>
          <select value={form.lead_type} onChange={set('lead_type')}
            className="h-[44px] bg-surface border border-border-subtle rounded-[6px] px-4 text-[15px] text-text-primary focus:outline-none focus:border-primary"
          >
            {LEAD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <p className="text-[11px] text-text-muted mt-1">Tag this template for a lead type, or keep it general.</p>
        </div>

        {/* AI generation row */}
        <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-primary" />
            <span className="text-[13px] font-semibold text-text-primary">Generate with AI</span>
          </div>
          <p className="text-[11px] text-text-muted mb-3">Let Veori draft a compliant outreach text for this lead type. You review before saving.</p>
          <div className="flex gap-2">
            <input value={angle} onChange={e => setAngle(e.target.value)} placeholder="Optional angle — e.g. emphasize speed, cash, as-is"
              className="flex-1 h-[40px] bg-surface border border-border-subtle rounded-[6px] px-3 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary"
            />
            <Button size="md" loading={generating} onClick={generate}><Sparkles size={13} /> Generate</Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 mt-5">
          <label className="label-caps">Message Body</label>
          <textarea value={form.body} onChange={set('body')} rows={5} placeholder="Hi {first_name}, I'm interested in buying {street}. Cash, as-is, close on your timeline. Open to an offer? - {operator}"
            className="bg-surface border border-border-subtle rounded-[6px] px-4 py-3 text-[14px] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary resize-none leading-relaxed"
          />
          <div className="flex flex-wrap gap-1.5 mt-1">
            {TOKENS.map(tok => (
              <button key={tok} type="button" onClick={() => insertToken(tok)}
                className="px-2 py-1 rounded-full text-[11px] border border-border-subtle text-text-muted hover:border-primary hover:text-primary transition-colors"
              >
                {`{${tok}}`}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-1">
            {form.body.length} chars{form.body.length > 320 ? ' — long messages may split into multiple SMS' : ''}
          </p>
        </div>

        <div className="flex gap-3 mt-8">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" loading={saving} onClick={save}>{editing ? 'Save changes' : 'Save template'}</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Template Card ────────────────────────────────────────────────────────────
function TemplateCard({ t, onEdit, onDelete }) {
  return (
    <div className="bg-card border border-border-subtle rounded-lg p-6 hover:border-border-default transition-colors flex flex-col">
      <div className="flex items-start justify-between mb-3 gap-3">
        <h3 className="text-[16px] font-medium text-text-primary truncate flex-1">{t.name}</h3>
        <Badge variant={t.lead_type ? 'green' : 'gray'}>{typeLabel(t.lead_type)}</Badge>
      </div>
      <p className="text-[13px] text-text-muted leading-relaxed flex-1 whitespace-pre-wrap line-clamp-4">{t.body}</p>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-subtle">
        <span className="label-caps">{t.ai_generated ? 'AI drafted' : 'Hand-written'}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => onEdit(t)}><Pencil size={12} /> Edit</Button>
          <Button variant="danger" size="sm" onClick={() => onDelete(t)}><Trash2 size={12} /></Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SmsTemplates() {
  const [list, setList]       = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null)   // null | {} (new) | template (edit)

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try { const r = await smsTemplates.getAll(); const raw = r.data?.data ?? r.data; setList(Array.isArray(raw) ? raw : []) }
    catch { setList([]) }
    finally { if (showSpinner) setLoading(false) }
  }

  useEffect(() => { load(true) }, [])

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return
    try { await smsTemplates.delete(t.id); toast.success('Template deleted'); load() }
    catch { toast.error('Failed to delete template') }
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-medium text-text-primary">SMS Templates</h1>
          <p className="text-[13px] text-text-muted mt-1">{list.length} template{list.length !== 1 ? 's' : ''} · pick one when launching an SMS-First campaign</p>
        </div>
        <Button onClick={() => setModal({})}><Plus size={14} /> New Template</Button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-text-muted text-[14px]">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-card border border-border-subtle rounded-lg py-24 text-center">
          <MessageSquare size={36} className="text-text-muted mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[16px] font-medium text-text-primary mb-2">No templates yet</p>
          <p className="text-[13px] text-text-muted mb-6">Write your own outreach copy or let AI draft it for you</p>
          <Button onClick={() => setModal({})}><Plus size={14} /> New Template</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {list.map(t => <TemplateCard key={t.id} t={t} onEdit={setModal} onDelete={handleDelete} />)}
        </div>
      )}

      {modal && (
        <TemplateModal
          initial={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
