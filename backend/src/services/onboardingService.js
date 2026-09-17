// ─── First-run setup checklist ────────────────────────────────────────────────
// Every step's "done" comes from real data (profile fields, rows that exist), so
// the checklist can't drift from what the workspace has actually set up.
// (The AI caller's name isn't a step: every account starts as "Alex", which works.)
// Required steps add up to about ten minutes; texting registration is listed but
// optional because carrier approval takes days, not minutes.

const supabase = require('../config/supabase');

async function countRows(table, userId, apply = (q) => q) {
  const { count, error } = await apply(
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId),
  );
  if (error) throw error;
  return count || 0;
}

async function getStatus(userId) {
  const { data: user, error } = await supabase.from('users')
    .select('company_name, a2p_registration_step, onboarding_completed')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!user) return null;

  const [leads, numbers, textNumbers, buyers, calls] = await Promise.all([
    countRows('leads', userId),
    countRows('phone_numbers', userId, q => q.eq('is_active', true).is('released_at', null)),
    countRows('phone_numbers', userId, q => q.eq('is_active', true).is('released_at', null).eq('is_toll_free', true).eq('sms_verification_status', 'verified')),
    countRows('buyers', userId),
    countRows('calls', userId),
  ]);

  const textingReady = user.a2p_registration_step === 'active' || textNumbers > 0;
  const steps = [
    { key: 'company', title: 'Add your company name', minutes: 1, done: !!user.company_name?.trim(), link: '/settings?tab=profile', why: 'Shown to sellers, on contracts and in texts.' },
    { key: 'leads', title: 'Import your leads', minutes: 3, done: leads > 0, link: '/leads?import=1', why: 'Upload a CSV. Numbers are checked against do-not-call automatically.' },
    { key: 'phone', title: 'Get a calling number', minutes: 2, done: numbers > 0, link: '/settings?tab=phones', why: 'A local number your AI calls from.' },
    { key: 'buyers', title: 'Add a cash buyer', minutes: 1, done: buyers > 0, link: '/buyers', why: 'Deals you lock up get texted to matching buyers.' },
    { key: 'first_call', title: 'Place your first AI call', minutes: 1, done: calls > 0, link: '/leads', why: 'Open a lead and press Call to hear it work.' },
    { key: 'texting', title: 'Register to text', minutes: 5, optional: true, done: textingReady, link: '/getting-started', why: 'Carriers require business registration before texting. Approval takes a few days, so start early.' },
  ];

  const required = steps.filter(s => !s.optional);
  const doneCount = required.filter(s => s.done).length;
  const minutesLeft = required.filter(s => !s.done).reduce((n, s) => n + s.minutes, 0);
  return {
    steps,
    completed: doneCount,
    total: required.length,
    minutes_left: minutesLeft,
    all_done: doneCount === required.length,
    dismissed: user.onboarding_completed === true,
  };
}

async function dismiss(userId) {
  const { error } = await supabase.from('users').update({ onboarding_completed: true }).eq('id', userId);
  if (error) throw error;
}

module.exports = { getStatus, dismiss };
