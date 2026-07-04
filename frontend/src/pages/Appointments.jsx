/**
 * Appointments Page
 * View scheduled appointments, manage availability windows, and create bookings.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, Phone, Plus, RefreshCw, CheckCircle2, XCircle, ChevronRight, Settings2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'
import { leads as leadsApi } from '../services/api'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATUS_META = {
  scheduled:  { color: '#4C9EFF', bg: 'rgba(76,158,255,0.1)',  label: 'Scheduled'  },
  completed:  { color: '#00C37A', bg: 'rgba(0,195,122,0.1)',   label: 'Completed'  },
  cancelled:  { color: '#FF4444', bg: 'rgba(255,68,68,0.1)',   label: 'Cancelled'  },
  rescheduled:{ color: '#FF9500', bg: 'rgba(255,149,0,0.1)',   label: 'Rescheduled'},
}

function scoreColor(s) {
  if (!s) return 'var(--t4)'
  if (s >= 70) return '#00C37A'
  if (s >= 40) return '#FF9500'
  return '#FF4444'
}

function fmtDateTime(str) {
  if (!str) return '-'
  const d = new Date(str)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtRelative(str) {
  if (!str) return ''
  const diff = Math.round((new Date(str) - Date.now()) / 60000) // minutes
  if (diff < 0) return `${Math.abs(diff)} min ago`
  if (diff < 60) return `in ${diff} min`
  const hrs = Math.round(diff / 60)
  if (hrs < 24) return `in ${hrs}h`
  const days = Math.round(hrs / 24)
  return `in ${days}d`
}

export default function Appointments() {
  const [appointments, setAppointments] = useState([])
  const [availability, setAvailability] = useState([])
  const [loading, setLoading]           = useState(true)
  const [tab, setTab]                   = useState('upcoming')  // 'upcoming' | 'availability'
  const [bookOpen, setBookOpen]         = useState(false)
  const [bookLeadId, setBookLeadId]     = useState('')
  const [bookDate, setBookDate]         = useState('')
  const [bookTime, setBookTime]         = useState('10:00')
  const [bookNotes, setBookNotes]       = useState('')
  const [booking, setBooking]           = useState(false)
  const [allLeads, setAllLeads]         = useState([])

  // Availability form state
  const [editDay, setEditDay]       = useState(null)  // 0-6
  const [editStart, setEditStart]   = useState('09:00')
  const [editEnd, setEditEnd]       = useState('17:00')
  const [editBuffer, setEditBuffer] = useState(15)
  const [editMax, setEditMax]       = useState(10)
  const [savingSlot, setSavingSlot] = useState(false)

  const load = useCallback(async () => {
    try {
      const [apptRes, availRes] = await Promise.all([
        api.get('/api/appointments', { params: { limit: 100 } }),
        api.get('/api/appointments/availability'),
      ])
      setAppointments(apptRes.data?.data || [])
      setAvailability(availRes.data?.data || [])
    } catch {
      toast.error('Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadLeads = useCallback(async () => {
    try {
      const res = await leadsApi.getLeads({ limit: 200 })
      const raw = res.data?.data || res.data || []
      setAllLeads(Array.isArray(raw) ? raw : [])
    } catch {}
  }, [])

  const handleBook = async () => {
    if (!bookLeadId || !bookDate || !bookTime) {
      toast.error('Select a lead, date, and time')
      return
    }
    setBooking(true)
    try {
      const scheduled_at = new Date(`${bookDate}T${bookTime}:00`).toISOString()
      await api.post('/api/appointments', { lead_id: bookLeadId, scheduled_at, notes: bookNotes || undefined })
      toast.success('Appointment booked')
      setBookOpen(false)
      setBookLeadId('')
      setBookDate('')
      setBookTime('10:00')
      setBookNotes('')
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Booking failed')
    } finally {
      setBooking(false)
    }
  }

  const handleCancel = async (id) => {
    try {
      await api.put(`/api/appointments/${id}`, { status: 'cancelled' })
      toast.success('Appointment cancelled')
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a))
    } catch {
      toast.error('Failed to cancel')
    }
  }

  const handleComplete = async (id) => {
    try {
      await api.put(`/api/appointments/${id}`, { status: 'completed' })
      toast.success('Marked complete')
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'completed' } : a))
    } catch {
      toast.error('Failed to update')
    }
  }

  const handleSaveSlot = async () => {
    if (editDay === null || !editStart || !editEnd) {
      toast.error('Select a day, start time, and end time')
      return
    }
    if (editStart >= editEnd) {
      toast.error('End time must be after start time')
      return
    }
    setSavingSlot(true)
    try {
      await api.post('/api/appointments/availability', {
        day_of_week:    editDay,
        start_time:     editStart,
        end_time:       editEnd,
        buffer_minutes: editBuffer,
        max_per_day:    editMax,
      })
      toast.success(`${DAYS[editDay]} availability saved`)
      setEditDay(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save')
    } finally {
      setSavingSlot(false)
    }
  }

  const handleRemoveSlot = async (id) => {
    try {
      await api.delete(`/api/appointments/availability/${id}`)
      setAvailability(prev => prev.filter(s => s.id !== id))
      toast.success('Slot removed')
    } catch {
      toast.error('Failed to remove slot')
    }
  }

  const upcoming = appointments.filter(a => a.status === 'scheduled')
  const past     = appointments.filter(a => a.status !== 'scheduled')

  // Availability: map by day_of_week
  const availByDay = {}
  for (const slot of availability) availByDay[slot.day_of_week] = slot

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 20px 14px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Appointments
            </h1>
            <div style={{ display: 'flex', gap: 14 }}>
              <span style={{ fontSize: 12, color: '#4C9EFF', fontWeight: 600 }}>
                {upcoming.length} upcoming
              </span>
              <span style={{ fontSize: 12, color: '#00C37A', fontWeight: 600 }}>
                {past.filter(a => a.status === 'completed').length} completed
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--t4)', cursor: 'pointer', padding: 6 }}>
              <RefreshCw size={14} strokeWidth={1.8} />
            </button>
            <button
              onClick={() => { setBookOpen(true); loadLeads() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(0,195,122,0.1)',
                border: '1px solid rgba(0,195,122,0.3)',
                borderRadius: 8, padding: '7px 14px',
                fontSize: 12, fontWeight: 600, color: '#00C37A',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Plus size={13} strokeWidth={2} /> Book Appointment
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[['upcoming', 'Upcoming'], ['past', 'Past'], ['availability', 'My Availability']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                height: 28, padding: '0 12px', borderRadius: 6,
                border: `1px solid ${tab === k ? 'rgba(0,195,122,0.4)' : 'var(--border)'}`,
                background: tab === k ? 'rgba(0,195,122,0.08)' : 'var(--border)',
                fontSize: 11, fontWeight: tab === k ? 600 : 400,
                color: tab === k ? '#00C37A' : 'var(--t3)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 20px' }}>

        {/* Upcoming + Past tabs */}
        {(tab === 'upcoming' || tab === 'past') && (
          loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ height: 80, borderRadius: 10, background: 'var(--surface-bg-2)', marginBottom: 8, animation: `skeleton-pulse 1.4s ease infinite ${i * 0.07}s` }} />
            ))
          ) : (
            (() => {
              const list = tab === 'upcoming' ? upcoming : past
              if (list.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(76,158,255,0.06)', border: '1px solid rgba(76,158,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                      <Calendar size={22} strokeWidth={1.3} color="#4C9EFF" />
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>
                      {tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--t4)' }}>
                      {tab === 'upcoming' ? 'Appointments are created automatically when AI scores a lead 75+ or you can book manually.' : ''}
                    </p>
                  </div>
                )
              }
              return list.map(appt => {
                const statusMeta = STATUS_META[appt.status] || STATUS_META.scheduled
                const leadData   = appt.leads
                const leadName   = appt.lead_name || (leadData ? `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim() : 'Unknown')
                const leadPhone  = appt.lead_phone || leadData?.phone
                const address    = appt.property_address || leadData?.property_address
                const score      = appt.motivation_score || leadData?.motivation_score

                return (
                  <div
                    key={appt.id}
                    style={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 10, marginBottom: 8,
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{leadName}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: statusMeta.bg, color: statusMeta.color }}>
                            {statusMeta.label}
                          </span>
                          {score > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(score), marginLeft: 'auto' }}>
                              {score} score
                            </span>
                          )}
                        </div>
                        {address && (
                          <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{address}</p>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 12, color: '#4C9EFF', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Calendar size={11} />
                            {fmtDateTime(appt.scheduled_at)}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--t4)' }}>
                            {fmtRelative(appt.scheduled_at)}
                          </span>
                        </div>
                        {leadPhone && (
                          <p style={{ fontSize: 11, color: 'var(--t4)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Phone size={9} /> {leadPhone}
                          </p>
                        )}
                        {appt.call_notes && (
                          <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 5, fontStyle: 'italic', lineHeight: 1.4, borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>
                            {appt.call_notes}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      {appt.status === 'scheduled' && (
                        <div style={{ display: 'flex', gap: 6, marginLeft: 12, flexShrink: 0 }}>
                          <button
                            onClick={() => handleComplete(appt.id)}
                            title="Mark complete"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              background: 'rgba(0,195,122,0.1)',
                              border: '1px solid rgba(0,195,122,0.3)',
                              borderRadius: 6, padding: '5px 10px',
                              fontSize: 11, color: '#00C37A',
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <CheckCircle2 size={11} /> Done
                          </button>
                          <button
                            onClick={() => handleCancel(appt.id)}
                            title="Cancel appointment"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              background: 'rgba(255,68,68,0.06)',
                              border: '1px solid rgba(255,68,68,0.2)',
                              borderRadius: 6, padding: '5px 10px',
                              fontSize: 11, color: '#FF4444',
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <XCircle size={11} /> Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            })()
          )
        )}

        {/* Availability tab */}
        {tab === 'availability' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16, lineHeight: 1.5 }}>
              Set the days and hours you are available for property appointments. The AI will use this to book callbacks automatically when a lead scores 75 or above.
            </p>

            {/* Day grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {DAYS.map((day, idx) => {
                const slot = availByDay[idx]
                return (
                  <div
                    key={idx}
                    style={{
                      background: 'var(--card-bg)',
                      border: `1px solid ${slot ? 'rgba(0,195,122,0.25)' : 'var(--border)'}`,
                      borderRadius: 10, padding: '10px 14px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: slot ? 'var(--t1)' : 'var(--t4)', width: 80 }}>
                        {day}
                      </span>
                      {slot ? (
                        <span style={{ fontSize: 11, color: '#00C37A' }}>
                          {slot.start_time} – {slot.end_time} · {slot.buffer_minutes}min buffer · max {slot.max_per_day}/day
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--t4)' }}>Not available</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => {
                          setEditDay(idx)
                          setEditStart(slot?.start_time || '09:00')
                          setEditEnd(slot?.end_time || '17:00')
                          setEditBuffer(slot?.buffer_minutes || 15)
                          setEditMax(slot?.max_per_day || 10)
                        }}
                        style={{
                          fontSize: 10, color: 'var(--t3)',
                          background: 'var(--surface-bg-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6, padding: '4px 8px',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        {slot ? 'Edit' : 'Set'}
                      </button>
                      {slot && (
                        <button
                          onClick={() => handleRemoveSlot(slot.id)}
                          style={{
                            fontSize: 10, color: '#FF4444',
                            background: 'rgba(255,68,68,0.06)',
                            border: '1px solid rgba(255,68,68,0.2)',
                            borderRadius: 6, padding: '4px 8px',
                            cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Inline edit form */}
            {editDay !== null && (
              <div style={{
                background: 'var(--card-bg)',
                border: '1px solid rgba(0,195,122,0.3)',
                borderRadius: 10, padding: '16px',
              }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#00C37A', marginBottom: 14 }}>
                  <Settings2 size={12} style={{ display: 'inline', marginRight: 6 }} />
                  Edit {DAYS[editDay]} availability
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                  {[
                    ['Start', editStart, setEditStart, 'time'],
                    ['End', editEnd, setEditEnd, 'time'],
                    ['Buffer (min)', editBuffer, setEditBuffer, 'number'],
                    ['Max per day', editMax, setEditMax, 'number'],
                  ].map(([label, val, setter, type]) => (
                    <div key={label}>
                      <label style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t4)', display: 'block', marginBottom: 5 }}>
                        {label}
                      </label>
                      <input
                        type={type}
                        value={val}
                        onChange={e => setter(type === 'number' ? Number(e.target.value) : e.target.value)}
                        min={type === 'number' ? 1 : undefined}
                        style={{
                          width: '100%', height: 34,
                          background: 'var(--surface-bg-2)',
                          border: '1px solid var(--border)', borderRadius: 6,
                          padding: '0 8px', fontSize: 12, color: 'var(--t1)',
                          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setEditDay(null)}
                    style={{ flex: 1, height: 36, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, color: 'var(--t3)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSlot}
                    disabled={savingSlot}
                    style={{ flex: 1, height: 36, background: 'rgba(0,195,122,0.15)', border: '1px solid rgba(0,195,122,0.4)', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#00C37A', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {savingSlot ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Book Appointment Modal ────────────────────────────────────────────── */}
      {bookOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ width: 440, background: 'var(--card-bg)', backdropFilter: 'blur(32px) saturate(160%)', WebkitBackdropFilter: 'blur(32px) saturate(160%)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(76,158,255,0.40), transparent)', margin: '-28px -28px 24px' }} />

            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-0.02em', marginBottom: 20 }}>
              Book Appointment
            </h2>

            {[
              ['Lead', (
                <select key="lead" value={bookLeadId} onChange={e => setBookLeadId(e.target.value)} style={{ width: '100%', height: 40, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px', fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none', appearance: 'none' }}>
                  <option value="">Select a lead…</option>
                  {allLeads.slice(0, 100).map(l => (
                    <option key={l.id} value={l.id} style={{ background: 'var(--card-bg)' }}>
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || l.phone} - {l.property_address || 'No address'}
                    </option>
                  ))}
                </select>
              )],
              ['Date', (
                <input key="date" type="date" value={bookDate} onChange={e => setBookDate(e.target.value)} min={new Date().toISOString().split('T')[0]} style={{ width: '100%', height: 40, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px', fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              )],
              ['Time', (
                <input key="time" type="time" value={bookTime} onChange={e => setBookTime(e.target.value)} style={{ width: '100%', height: 40, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px', fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              )],
              ['Notes (optional)', (
                <textarea key="notes" value={bookNotes} onChange={e => setBookNotes(e.target.value)} rows={2} placeholder="Any context about this appointment..." style={{ width: '100%', background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--t1)', fontFamily: 'inherit', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
              )],
            ].map(([label, input]) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--t3)', display: 'block', marginBottom: 6 }}>
                  {label}
                </label>
                {input}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                onClick={() => { setBookOpen(false); setBookLeadId(''); setBookDate(''); setBookNotes('') }}
                style={{ flex: 1, height: 40, background: 'var(--surface-bg-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={handleBook}
                disabled={booking || !bookLeadId || !bookDate}
                style={{ flex: 1, height: 40, background: bookLeadId && bookDate ? 'rgba(76,158,255,0.15)' : 'var(--surface-bg-3)', border: `1px solid ${bookLeadId && bookDate ? 'rgba(76,158,255,0.4)' : 'var(--border)'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: bookLeadId && bookDate ? '#4C9EFF' : 'var(--t4)', cursor: bookLeadId && bookDate ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
              >
                {booking ? 'Booking…' : 'Book Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
