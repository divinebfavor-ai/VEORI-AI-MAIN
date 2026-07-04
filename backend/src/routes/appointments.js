/**
 * Appointments Routes
 *
 * GET    /api/appointments                    - list appointments
 * POST   /api/appointments                    - create appointment manually
 * PUT    /api/appointments/:id                - update appointment (reschedule / cancel)
 * DELETE /api/appointments/:id                - delete appointment
 * GET    /api/appointments/availability       - get operator availability slots
 * POST   /api/appointments/availability       - save availability slot
 * DELETE /api/appointments/availability/:id   - remove availability slot
 */

const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/appointments - upcoming appointments for this operator
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('appointments')
      .select('*, leads(first_name, last_name, phone, property_address, motivation_score, property_city, property_state)', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('scheduled_at', { ascending: true })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch (err) { next(err); }
});

// POST /api/appointments - manually create appointment
router.post('/', async (req, res, next) => {
  try {
    const { lead_id, scheduled_at, notes, motivation_score } = req.body;

    if (!lead_id) {
      return res.status(400).json({ success: false, error: 'lead_id is required' });
    }
    if (!scheduled_at) {
      return res.status(400).json({ success: false, error: 'scheduled_at is required' });
    }

    // Verify lead belongs to this operator
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, property_address')
      .eq('id', lead_id)
      .eq('user_id', req.user.id)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    // Prevent double booking - check no other appointment exists at the same slot
    const slotStart = new Date(scheduled_at);
    const slotEnd   = new Date(slotStart.getTime() + 30 * 60 * 1000); // 30-min buffer

    const { data: conflict } = await supabase
      .from('appointments')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', slotStart.toISOString())
      .lte('scheduled_at', slotEnd.toISOString())
      .maybeSingle();

    if (conflict) {
      return res.status(409).json({ success: false, error: 'Another appointment is already booked in that time slot' });
    }

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        user_id:          req.user.id,
        lead_id:          lead.id,
        lead_name:        `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown',
        lead_phone:       lead.phone || null,
        property_address: lead.property_address || null,
        motivation_score: motivation_score || null,
        scheduled_at,
        status:           'scheduled',
        notes:            notes || null,
        created_at:       new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Update lead status to appointment_set
    await supabase
      .from('leads')
      .update({ status: 'appointment_set' })
      .eq('id', lead_id)
      .eq('user_id', req.user.id);

    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/appointments/:id - update (reschedule / cancel / complete)
router.put('/:id', async (req, res, next) => {
  try {
    const allowedFields = ['scheduled_at', 'status', 'notes', 'call_notes', 'outcome', 'reminder_sent'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (req.body.status === 'cancelled') {
      updates.cancelled_at = new Date().toISOString();
    }

    updates.updated_at = new Date().toISOString();

    if (Object.keys(updates).length === 1) { // only updated_at
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('appointments')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Appointment not found' });

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/appointments/availability
router.get('/availability', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('availability_slots')
      .select('*')
      .eq('operator_id', req.user.id)
      .eq('is_active', true)
      .order('day_of_week', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) { next(err); }
});

// POST /api/appointments/availability - upsert a day's availability
router.post('/availability', async (req, res, next) => {
  try {
    const { day_of_week, start_time, end_time, buffer_minutes, max_per_day } = req.body;

    if (day_of_week === undefined || day_of_week === null) {
      return res.status(400).json({ success: false, error: 'day_of_week is required (0=Sun … 6=Sat)' });
    }
    if (!start_time || !end_time) {
      return res.status(400).json({ success: false, error: 'start_time and end_time are required' });
    }
    if (day_of_week < 0 || day_of_week > 6) {
      return res.status(400).json({ success: false, error: 'day_of_week must be 0–6' });
    }

    // Upsert - replace existing slot for this day
    const { data: existing } = await supabase
      .from('availability_slots')
      .select('id')
      .eq('operator_id', req.user.id)
      .eq('day_of_week', day_of_week)
      .maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('availability_slots')
        .update({ start_time, end_time, buffer_minutes: buffer_minutes || 15, max_per_day: max_per_day || 10, is_active: true })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('availability_slots')
        .insert({ operator_id: req.user.id, day_of_week, start_time, end_time, buffer_minutes: buffer_minutes || 15, max_per_day: max_per_day || 10 })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
});

// DELETE /api/appointments/availability/:id
router.delete('/availability/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('availability_slots')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('operator_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
