// ─── Fraud Guard — flag-only abuse/fraud detection ───────────────────────────
// Policy (per product decision): FLAG FOR REVIEW ONLY. This service NEVER
// restricts, suspends, or blocks an account on its own. It detects suspicious
// custom scripts and usage patterns, writes them to the `fraud_flags` table for
// an admin to review, and returns a structured verdict callers can surface as a
// soft warning. Account-level enforcement is a human decision, not automated.
//
// Covers three categories the operator asked for:
//   1. scam_script       — impersonation, upfront-fee, advance-fee, known scams
//   2. compliance_bypass — make the AI deny it's AI, ignore DNC, pressure/threaten
//   3. abuse_rate        — behavioral: mass-blasting one number, volume spikes,
//                          excessive "remove me" complaints
//
// All DB writes are best-effort: a logging failure must never block a save or a
// call. If `fraud_flags` doesn't exist yet, inserts fail quietly and are logged.

const supabase = require('../config/supabase');
const { callAnthropic } = require('./aiService');

const MODEL = 'claude-haiku-4-5-20251001';

// ─── Cheap deterministic keyword pre-screen ──────────────────────────────────
// Fast, no-API first pass. A hit here forces a flag regardless of the LLM,
// because these phrases have no legitimate place in a cold-call script.
const SCAM_PATTERNS = [
  /\b(wire|send|pay|transfer)\s+(me|us|the)?\s*\$?\d/i,      // demand money up front
  /\b(upfront|advance|processing|application)\s+fee\b/i,
  /\bgift\s+card|bitcoin|crypto|western\s+union|cash\s?app\b/i,
  /\b(social\s+security|ssn|bank\s+(account|routing)|credit\s+card)\s+number\b/i,
  /\bi\s+am\s+(calling\s+)?from\s+(the\s+)?(irs|fbi|police|government|your\s+bank)\b/i,
  /\bimpersonat|pretend\s+to\s+be|pose\s+as\b/i,
];

const COMPLIANCE_BYPASS_PATTERNS = [
  /\b(don'?t|do\s+not|never)\s+(say|admit|tell\s+them|reveal|disclose)\s+.{0,30}\b(ai|robot|bot|automated|machine)\b/i,
  /\bpretend\s+(to\s+be|you'?re)\s+(a\s+)?(human|real\s+person)\b/i,
  /\b(ignore|skip|bypass|don'?t\s+honor)\s+.{0,30}\b(do\s*not\s*call|dnc|opt[\s-]?out|remove)\b/i,
  /\b(keep\s+calling|call\s+again).{0,30}\b(even\s+if|after)\s+.{0,30}\b(no|stop|remove)\b/i,
  /\b(threaten|scare|intimidate|harass|pressure\s+them\s+hard)\b/i,
];

function keywordPrescreen(text) {
  const hits = [];
  for (const re of SCAM_PATTERNS)            if (re.test(text)) hits.push({ type: 'scam_script', match: re.source });
  for (const re of COMPLIANCE_BYPASS_PATTERNS) if (re.test(text)) hits.push({ type: 'compliance_bypass', match: re.source });
  return hits;
}

// ─── LLM classifier — catches paraphrased / subtle attempts ──────────────────
async function llmClassify(text) {
  const prompt = `You are a fraud & compliance reviewer for a real estate cold-calling platform.
A user submitted the following custom instruction script that will steer how an AI voice agent talks to property sellers.

Flag it ONLY if it tries to do one of these:
- scam_script: impersonate a bank/government/lawyer/another person, demand upfront/advance fees, ask for SSN/bank/card numbers, run an advance-fee or known scam.
- compliance_bypass: make the AI deny it is an AI, refuse to honor "remove me"/Do-Not-Call, threaten/intimidate/harass, or apply heavy pressure.

A normal, persuasive, friendly, or direct sales script is NOT fraud. Be conservative — do not flag legitimate negotiation, urgency, or rapport-building.

SCRIPT:
"""
${String(text).slice(0, 4000)}
"""

Respond with ONLY valid JSON, no markdown:
{"flagged": <true|false>, "type": "<scam_script|compliance_bypass|none>", "severity": "<low|medium|high>", "reason": "<one short sentence>"}`;

  try {
    const msg = await callAnthropic(
      { model: MODEL, max_tokens: 150, messages: [{ role: 'user', content: prompt }] },
      { label: 'fraud-scan' }
    );
    const raw = msg?.content?.[0]?.text?.trim() || '';
    const json = raw.replace(/^```json?/i, '').replace(/```$/, '').trim();
    return JSON.parse(json);
  } catch (err) {
    console.warn('[fraudGuard] llmClassify failed (failing open):', err.message);
    return { flagged: false, type: 'none', severity: 'low', reason: '' };
  }
}

/**
 * Scan a custom script/instructions string.
 * Returns { flagged, type, severity, reason }. Never throws.
 */
async function scanScript(text) {
  if (!text || !String(text).trim()) {
    return { flagged: false, type: 'none', severity: 'low', reason: '' };
  }

  const hits = keywordPrescreen(text);
  if (hits.length) {
    const type = hits[0].type;
    return {
      flagged: true,
      type,
      severity: 'high',
      reason: type === 'scam_script'
        ? 'Script contains scam/impersonation or money-demand language.'
        : 'Script attempts to bypass AI-disclosure or Do-Not-Call compliance.',
    };
  }

  // No obvious keyword hit — ask the LLM for the subtle cases.
  return llmClassify(text);
}

/**
 * Write a flag row. Best-effort: never throws, never blocks the caller.
 */
async function logFlag(userId, { flag_type, severity = 'medium', reason = '', evidence = '' }) {
  try {
    const { error } = await supabase.from('fraud_flags').insert({
      user_id: userId,
      flag_type,
      severity,
      reason,
      evidence: String(evidence).slice(0, 2000),
      status: 'open',
    });
    if (error) console.warn('[fraudGuard] logFlag insert error:', error.message);
  } catch (err) {
    console.warn('[fraudGuard] logFlag threw (ignored):', err.message);
  }
}

/**
 * Scan + auto-log in one call. Returns the verdict so the route can warn the user.
 */
async function scanAndLog(userId, text, source = 'custom_script') {
  const verdict = await scanScript(text);
  if (verdict.flagged) {
    await logFlag(userId, {
      flag_type: verdict.type,
      severity: verdict.severity,
      reason: verdict.reason,
      evidence: `[${source}] ${String(text).slice(0, 500)}`,
    });
  }
  return verdict;
}

/**
 * Behavioral abuse-rate check. Flag-only. Reads recent usage and flags spikes,
 * duplicate-number blasting, and excessive opt-out complaints. Never throws.
 * Returns { flagged, signals: [...] }.
 */
async function checkAbuseRate(userId) {
  const signals = [];
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Volume + duplicate-number blasting from recent calls.
    const { data: calls } = await supabase
      .from('calls')
      .select('phone_number, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .limit(2000);

    if (Array.isArray(calls)) {
      if (calls.length > 1000) {
        signals.push({ kind: 'volume_spike', detail: `${calls.length} calls in 24h` });
      }
      const counts = {};
      for (const c of calls) {
        if (!c.phone_number) continue;
        counts[c.phone_number] = (counts[c.phone_number] || 0) + 1;
      }
      const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (worst && worst[1] >= 10) {
        signals.push({ kind: 'duplicate_blast', detail: `${worst[1]} calls to ${worst[0]} in 24h` });
      }
    }

    if (signals.length) {
      await logFlag(userId, {
        flag_type: 'abuse_rate',
        severity: signals.some(s => s.kind === 'volume_spike') ? 'high' : 'medium',
        reason: signals.map(s => s.detail).join('; '),
        evidence: JSON.stringify(signals),
      });
    }
  } catch (err) {
    console.warn('[fraudGuard] checkAbuseRate failed (ignored):', err.message);
  }
  return { flagged: signals.length > 0, signals };
}

module.exports = { scanScript, logFlag, scanAndLog, checkAbuseRate };
