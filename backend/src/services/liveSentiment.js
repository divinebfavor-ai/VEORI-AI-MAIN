// ─── Live call sentiment ─────────────────────────────────────────────────────
// Scores each thing the seller says, as they say it, so the operator watching Live
// Monitor sees the call warming up or going sideways in real time.
//
// Deliberately rule-based: it runs inside the live turn, so it must add no latency
// and no per-turn AI cost. It is a live read, not the verdict - the full AI analysis
// of the transcript after the call still sets the motivation score.
//
// Labels match sentiment_events: Motivated, Neutral, Hesitant, Cold, Hostile.

const supabase = require('../config/supabase');

const RULES = [
  // [label, weight, patterns]
  ['Hostile', -45, [/\bscam(mer)?\b/, /\bf+u+c+k/, /\bsue\b/, /\b(my )?(lawyer|attorney)\b/, /\bharass/, /\bhow did you get (my|this) number\b/, /\bleave me alone\b/, /\bstop calling\b/, /\bgo to hell\b/, /\breport you\b/]],
  ['Cold', -25, [/\bnot interested\b/, /\bno thanks?\b/, /\bnot (selling|for sale)\b/, /\b(do not|don'?t) want to sell\b/, /\bnever (sell|selling)\b/, /\bhappy (here|where)\b/, /\bwrong number\b/, /\bno\b[.!]?$/]],
  ['Hesitant', -8, [/\bnot sure\b/, /\bmaybe\b/, /\bthink about it\b/, /\btalk (to|with) my (wife|husband|spouse|partner|family|kids)\b/, /\bdepends\b/, /\bnot right now\b/, /\bcall (me )?(back )?later\b/, /\bi don'?t know\b/, /\bwhat'?s the catch\b/, /\blow ?ball\b/]],
  ['Motivated', 25, [/\b(need|have|want) to sell\b/, /\bbehind on\b/, /\bforeclos/, /\bhow much\b/, /\bwhat (would|can) you (offer|pay|give)\b/, /\bcash offer\b/, /\bhow (fast|quick|soon)\b/, /\bdivorce\b/, /\binherit/, /\btired of\b/, /\b(relocat|moving)\b/, /\bas[- ]is\b/, /\bmake (me )?an offer\b/, /\bi'?m interested\b/, /\bsounds good\b/, /\blet'?s (do it|talk)\b/, /\btax(es)? (owed|behind|lien)\b/, /\brepairs?\b/, /\bvacant\b/]],
];


/**
 * Score one seller utterance.
 * @returns {{ label: string, score: number, signals: string[] }}  score 0-100, 50 = neutral
 */
function scoreUtterance(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return { label: 'Neutral', score: 50, signals: [] };
  let delta = 0;
  const hits = {};
  const signals = [];
  for (const [label, weight, patterns] of RULES) {
    for (const re of patterns) {
      const m = t.match(re);
      if (m) {
        delta += weight;
        hits[label] = (hits[label] || 0) + 1;
        signals.push(m[0]);
      }
    }
  }
  const score = Math.max(0, Math.min(100, 50 + delta));
  // Hostile always wins; Cold wins unless motivated phrases outnumber it.
  let label = 'Neutral';
  if (hits.Hostile) label = 'Hostile';
  else if (hits.Cold && (hits.Cold || 0) >= (hits.Motivated || 0)) label = 'Cold';
  else if (hits.Motivated) label = 'Motivated';
  else if (hits.Hesitant) label = 'Hesitant';
  return { label, score, signals: [...new Set(signals)].slice(0, 6) };
}

function labelForScore(score) {
  if (score >= 65) return 'Motivated';
  if (score >= 45) return 'Neutral';
  if (score >= 32) return 'Hesitant';
  if (score >= 15) return 'Cold';
  return 'Hostile';
}

/**
 * Blend a new utterance into the call's running read. The running score is an
 * exponential moving average (recent turns count more); a Hostile utterance sets
 * the label immediately so the operator sees it without waiting for the average.
 */
function nextReading(previous, text, turn) {
  const u = scoreUtterance(text);
  const prevScore = typeof previous?.score === 'number' ? previous.score : 50;
  const score = Math.round(previous ? prevScore * 0.5 + u.score * 0.5 : u.score);
  const label = u.label === 'Hostile' ? 'Hostile' : labelForScore(score);
  const trend = !previous ? 'steady' : score - prevScore >= 5 ? 'warming' : prevScore - score >= 5 ? 'cooling' : 'steady';
  return { label, score, trend, turn, signals: u.signals, utterance_label: u.label, at: new Date().toISOString() };
}

/** Record a seller turn on a live call. Never throws; never blocks the call. */
async function recordSellerTurn({ callId, userId, leadId, text, turn }) {
  if (!supabase || !callId || !String(text || '').trim()) return null;
  try {
    const { data: row } = await supabase.from('calls').select('live_sentiment').eq('id', callId).maybeSingle();
    const reading = nextReading(row?.live_sentiment || null, text, turn);
    const { error } = await supabase.from('calls').update({ live_sentiment: reading }).eq('id', callId);
    if (error) console.warn('[LiveSentiment] update failed:', error.message);
    if (userId && leadId) {
      const { error: evErr } = await supabase.from('sentiment_events').insert({
        lead_id: leadId, user_id: userId, call_id: callId, source: 'call_turn',
        sentiment: reading.utterance_label, score: scoreUtterance(text).score,
        notes: reading.signals.length ? `signals: ${reading.signals.join(', ')}` : null,
      });
      if (evErr) console.warn('[LiveSentiment] event insert failed:', evErr.message);
    }
    return reading;
  } catch (e) {
    console.warn('[LiveSentiment] failed:', e.message);
    return null;
  }
}

module.exports = { scoreUtterance, nextReading, labelForScore, recordSellerTurn };
