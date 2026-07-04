// ─────────────────────────────────────────────────────────────────────────────
// tcpaWindow - the ONE shared, DST-correct TCPA quiet-hours gate for SMS.
//
// WHY: TCPA's 8 AM–9 PM "quiet hours" rule applies to TEXTS exactly like calls.
// At blast scale a single off-hours batch is hundreds of $500-per-message
// violations. Before this module the SMS paths each had their OWN time check:
//   • smsBlastProcessor (the engine for the heavy blast) had NONE.
//   • smsFirstWorkflow / campaignManager used FIXED UTC offsets (`?? -5`) which
//     are wrong half the year - a -5 offset for New York is actually -4 in summer
//     (EDT), so a 10 PM local send could read as 9 PM and slip through.
//
// This module computes the lead's TRUE local hour using the IANA timezone via
// Intl.DateTimeFormat (the same DST-safe approach already proven in calls.js),
// so daylight saving is handled automatically by the runtime - no offset table
// to drift. It also computes how long to DEFER an off-hours message so it fires
// at the next 8 AM in the lead's local time (BullMQ `delay`), so nobody is
// dropped and nothing sends illegally.
//
// Federal rule implemented: block before 8 AM and at/after 9 PM local time.
// Default timezone when a lead's state is unknown/missing = America/New_York
// (Eastern) - the most conservative common case (Eastern hits 9 PM first).
// This is intentionally a HARD GATE for SMS (unlike the federal-DNC check which
// fails open): time-of-day is deterministic and cheap, so there is no reason to
// ever fail open on it.
// ─────────────────────────────────────────────────────────────────────────────

// US state → IANA timezone. Explicit for all 50 + DC so nothing silently
// defaults; unknown/blank falls back to Eastern below.
const STATE_TZ = {
  AL: 'America/Chicago',       AK: 'America/Anchorage',
  AZ: 'America/Phoenix',       AR: 'America/Chicago',
  CA: 'America/Los_Angeles',   CO: 'America/Denver',
  CT: 'America/New_York',      DE: 'America/New_York',
  DC: 'America/New_York',      FL: 'America/New_York',
  GA: 'America/New_York',      HI: 'Pacific/Honolulu',
  ID: 'America/Denver',        IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago',       KY: 'America/New_York',
  LA: 'America/Chicago',       ME: 'America/New_York',
  MD: 'America/New_York',      MA: 'America/New_York',
  MI: 'America/Detroit',       MN: 'America/Chicago',
  MS: 'America/Chicago',       MO: 'America/Chicago',
  MT: 'America/Denver',        NE: 'America/Chicago',
  NV: 'America/Los_Angeles',   NH: 'America/New_York',
  NJ: 'America/New_York',      NM: 'America/Denver',
  NY: 'America/New_York',      NC: 'America/New_York',
  ND: 'America/Chicago',       OH: 'America/New_York',
  OK: 'America/Chicago',       OR: 'America/Los_Angeles',
  PA: 'America/New_York',      RI: 'America/New_York',
  SC: 'America/New_York',      SD: 'America/Chicago',
  TN: 'America/Chicago',       TX: 'America/Chicago',
  UT: 'America/Denver',        VT: 'America/New_York',
  VA: 'America/New_York',      WA: 'America/Los_Angeles',
  WV: 'America/New_York',      WI: 'America/Chicago',
  WY: 'America/Denver',
};

const DEFAULT_TZ = 'America/New_York';
const START_HOUR = 8;   // 8 AM - first allowed hour (inclusive)
const END_HOUR   = 21;  // 9 PM - first blocked hour (exclusive upper bound)

/** Resolve a state code (or anything falsy) to an IANA tz, defaulting to Eastern. */
function tzForState(stateCode) {
  return STATE_TZ[String(stateCode || '').toUpperCase()] || DEFAULT_TZ;
}

/**
 * Read the wall-clock parts (hour, minute, second) in a given IANA timezone for
 * a given instant. Uses Intl so DST is applied by the runtime - no offset math.
 */
function localParts(tz, when = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(when).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some runtimes emit 24 for midnight
  return { hour, minute: Number(parts.minute), second: Number(parts.second) };
}

/**
 * Is it currently inside the 8 AM–9 PM TCPA window in the lead's local time?
 * @param {string} stateCode  two-letter US state (lead.property_state)
 * @param {Date}   [when]     instant to test (default: now)
 * @returns {boolean}
 */
function isWithinTcpaWindow(stateCode, when = new Date()) {
  const { hour } = localParts(tzForState(stateCode), when);
  return hour >= START_HOUR && hour < END_HOUR;
}

/**
 * The lead's current local wall-clock HOUR (0–23) in its state's timezone.
 * Lets callers compare against an operator-configured window (e.g. campaign
 * calling_hours_start/end) in the lead's local time rather than the server's.
 * @param {string} stateCode
 * @param {Date}   [when]
 * @returns {number} 0–23
 */
function tcpaLocalHour(stateCode, when = new Date()) {
  return localParts(tzForState(stateCode), when).hour;
}

/**
 * Milliseconds from `when` until the NEXT moment the lead's local clock reads
 * 8:00 AM. Returns 0 if we're already inside the window (caller should send now).
 *
 * Implementation note: we don't need calendar math in the target tz - we know the
 * current local hour/min/sec there, so the seconds-until-8AM is a pure modular
 * computation against the local time-of-day, independent of date. (If a DST
 * jump happens overnight the BullMQ delay can be off by an hour at the boundary;
 * the worker RE-CHECKS isWithinTcpaWindow on wake, so a boundary miss simply
 * defers once more rather than sending early - fail-safe, never fail-open.)
 *
 * @param {string} stateCode
 * @param {Date}   [when]
 * @returns {number} delay in ms (>= 0)
 */
function msUntilNextWindow(stateCode, when = new Date()) {
  const tz = tzForState(stateCode);
  const { hour, minute, second } = localParts(tz, when);
  if (hour >= START_HOUR && hour < END_HOUR) return 0;

  // Seconds since local midnight right now.
  const nowSec   = hour * 3600 + minute * 60 + second;
  const startSec = START_HOUR * 3600;
  // If before 8 AM today → wait until 8 AM today; if at/after 9 PM → wait until
  // 8 AM tomorrow (add a full day so the delta is always positive).
  let deltaSec = startSec - nowSec;
  if (deltaSec <= 0) deltaSec += 24 * 3600;
  return deltaSec * 1000;
}

module.exports = {
  isWithinTcpaWindow,
  msUntilNextWindow,
  tcpaLocalHour,
  tzForState,
  STATE_TZ,
};
