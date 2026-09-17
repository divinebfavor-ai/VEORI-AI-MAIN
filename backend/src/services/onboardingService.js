// ─── First-run setup checklist ────────────────────────────────────────────────
// Every step's "done" comes from real data (profile fields, rows that exist), so
// the checklist can't drift from what the workspace has actually set up.
// (The AI caller's name isn't a step: every account starts as "Alex", which works.)
// Required steps add up to about ten minutes; texting registration is listed but
// optional because carrier approval takes days, not minutes.

const supabase = require('../config/supabase');

async function getStatus(userId) {
  const { data: user, error } = await supabase.from('users')
    .select('company_name, a2p_registration_step, onboarding_completed')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!user) return null;

  const { data: flags, error: flagsErr } = await supabase.rpc('onboarding_flags', { p_user_id: userId });
  if (flagsErr) throw flagsErr;
  const f = flags || {};

  const textingReady = user.a2p_registration_step === 'active' || f.has_text_number === true;
  const steps = [
    { key: 'company', title: 'Add your company name', minutes: 1, done: !!user.company_name?.trim(), link: '/settings?tab=profile', why: 'Shown to sellers, on contracts and in texts.' },
    { key: 'leads', title: 'Import your leads', minutes: 3, done: f.has_leads === true, link: '/leads?import=1', why: 'Upload a CSV. Numbers are checked against do-not-call automatically.' },
    { key: 'phone', title: 'Get a calling number', minutes: 2, done: f.has_number === true, link: '/settings?tab=phones', why: 'A local number your AI calls from.' },
    { key: 'buyers', title: 'Add a cash buyer', minutes: 1, done: f.has_buyers === true, link: '/buyers', why: 'Deals you lock up get texted to matching buyers.' },
    { key: 'first_call', title: 'Place your first AI call', minutes: 1, done: f.has_calls === true, link: '/leads', why: 'Open a lead and press Call to hear it work.' },
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
