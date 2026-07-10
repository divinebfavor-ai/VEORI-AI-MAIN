// ─────────────────────────────────────────────────────────────────────────────
// complianceGate - the ONE hard-stop that can halt an autonomous agent.
//
// PRODUCT POSTURE: the agents are autonomous. When an operator starts a campaign
// that IS the authorization to act toward the close - agents do NOT pause for
// per-action human confirmation. This gate is the single exception, and it does
// not exist to ask a human's permission: it exists to stop actions that are
// ILLEGAL, because an illegal outreach destroys the campaign it was serving
// (TCPA is $500-$1,500 per message/call; Fair Housing and state wholesaling
// violations are existential). Everything legal, the agent does freely.
//
// This gate does NOT invent new compliance logic. It composes the primitives the
// platform already ships and already trusts:
//   • tcpaWindow.isWithinTcpaWindow  - DST-correct 8AM-9PM quiet-hours (HARD).
//   • dnc_records table              - internal opt-out / STOP list (HARD).
//   • ftcDncService.isOnFederalDnc   - federal DNC registry (fails OPEN until a
//                                      key is configured; treated per its own
//                                      contract - see FTC handling below).
//   • stateCompliance.getStateCompliance - per-state wholesaling risk, license
//                                      bans, required disclosures.
//   • agentSpine rule 7 (Fair Housing/ECOA) - protected-class guard on targeting.
//
// RETURN CONTRACT (never throws on a normal check):
//   {
//     allowed: boolean,          // false => the action must NOT proceed
//     hardStops:  [ {code, rule, detail} ],   // reasons it is blocked
//     warnings:   [ {code, rule, detail} ],   // proceed, but logged/surfaced
//     requiredDisclosures: [ string ],        // e.g. state assignment disclosure
//     checked: { tcpa, internalDnc, federalDnc, state, fairHousing } // what ran
//   }
//
// FAIL-CLOSED: any UNEXPECTED error inside a HARD check (e.g. the DNC table read
// throwing) blocks the action rather than letting a possibly-illegal send through.
// The one deliberate fail-OPEN is the federal DNC lookup, which is fail-open BY
// ITS OWN DESIGN until the operator configures FTC_DNC_API_KEY (see ftcDncService);
// we preserve that contract but record it as a warning so it is never silent.
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');
const { isWithinTcpaWindow } = require('../services/tcpaWindow');
const { isOnFederalDnc } = require('../services/ftcDncService');
const { getStateCompliance } = require('../data/stateCompliance');

// Which channels are subject to TCPA quiet-hours + DNC. 'email' is not a
// telephony channel, so it skips those two checks (still Fair-Housing bound).
const TELEPHONY_CHANNELS = new Set(['call', 'sms', 'rvm', 'voicemail', 'mms']);

// Protected classes (Fair Housing Act + ECOA). Targeting/segmenting on any of
// these - or an obvious proxy - is an absolute hard-stop under spine rule 7.
const PROTECTED_CLASS_TERMS = [
  'race', 'color', 'religion', 'religious', 'national origin', 'nationality',
  'ethnic', 'ethnicity', 'sex', 'gender', 'familial status', 'family status',
  'children', 'disability', 'disabled', 'handicap', 'ancestry', 'creed',
  'pregnan', 'marital status', 'age ', 'elderly', 'muslim', 'christian',
  'jewish', 'hispanic', 'latino', 'black', 'white', 'asian', 'immigrant',
];

function stop(code, rule, detail) { return { code, rule, detail }; }

/**
 * Scan a free-text targeting/segmentation description for protected-class
 * criteria. Used for actions that define an AUDIENCE (blast segments, buyer
 * ranking rules, screening filters). Returns matched terms (empty = clean).
 */
function scanProtectedClass(text) {
  const hay = String(text || '').toLowerCase();
  return PROTECTED_CLASS_TERMS.filter(t => hay.includes(t));
}

/**
 * Internal opt-out / STOP list lookup. HARD: if someone told us to stop, we stop,
 * forever. Any error here fails CLOSED (treated as on-list) - we never risk
 * messaging an opt-out because a table read hiccuped.
 */
async function onInternalDnc(phone) {
  if (!phone) return { onList: false, errored: false };
  try {
    const { data, error } = await supabase
      .from('dnc_records').select('id').eq('phone', phone).maybeSingle();
    if (error) {
      if (error.code === 'PGRST205' || (error.message || '').includes('does not exist')) {
        return { onList: false, errored: false }; // table not present yet
      }
      return { onList: true, errored: true }; // unknown error => fail closed
    }
    return { onList: !!data, errored: false };
  } catch {
    return { onList: true, errored: true }; // fail closed
  }
}

/**
 * The gate. Evaluate whether an agent action is legally permitted to proceed.
 *
 * @param {object} action
 * @param {string} action.type        e.g. 'send_sms','place_call','send_email',
 *                                    'record_memorandum','define_audience','assign_contract'
 * @param {string} [action.channel]   'call'|'sms'|'rvm'|'email'|... (defaults from type)
 * @param {object} [action.lead]      lead/canonical.lead - needs phone, property_state
 * @param {string} [action.phone]     override phone (else action.lead.phone)
 * @param {string} [action.stateCode] override state (else action.lead.property_state)
 * @param {string} [action.targetingText] free-text audience/segment/screening rule
 * @param {object} [opts]
 * @param {boolean} [opts.skipFederalDnc=false] skip the network FTC lookup (e.g. bulk pre-scrub)
 * @returns {Promise<object>} the RETURN CONTRACT above
 */
async function complianceGate(action = {}, opts = {}) {
  const hardStops = [];
  const warnings = [];
  const requiredDisclosures = [];
  const checked = { tcpa: false, internalDnc: false, federalDnc: false, state: false, fairHousing: false };

  const channel = action.channel || channelFromType(action.type);
  const lead = action.lead || {};
  const phone = action.phone || lead.phone || null;
  const stateCode = action.stateCode || lead.property_state || lead.state || null;
  const isTelephony = TELEPHONY_CHANNELS.has(channel);

  // ── Fair Housing / ECOA (rule 7) - applies to ANY action that defines who is
  // targeted or how they are ranked/screened. Absolute hard-stop.
  const targetingText = action.targetingText;
  if (targetingText != null) {
    checked.fairHousing = true;
    const hits = scanProtectedClass(targetingText);
    if (hits.length) {
      hardStops.push(stop(
        'FAIR_HOUSING',
        'Fair Housing Act / ECOA (spine rule 7)',
        `Targeting/screening references protected-class terms: ${hits.join(', ')}. Remove protected-class criteria and use legitimate business criteria only.`
      ));
    }
  }

  // ── Telephony-only checks: TCPA quiet hours + DNC ──────────────────────────
  if (isTelephony) {
    // TCPA quiet hours (HARD, deterministic, never fail-open).
    checked.tcpa = true;
    try {
      if (!isWithinTcpaWindow(stateCode)) {
        hardStops.push(stop(
          'TCPA_QUIET_HOURS',
          'TCPA 8AM-9PM local (spine rule 6)',
          `Outside the recipient-local calling window${stateCode ? ` for ${stateCode}` : ''}. Defer until the next 8AM local.`
        ));
      }
    } catch (e) {
      // A time check should never throw; if it does, fail closed.
      hardStops.push(stop('TCPA_CHECK_ERROR', 'TCPA (fail-closed)', `Quiet-hours check errored: ${e.message}`));
    }

    // Internal opt-out list (HARD, fail-closed on error).
    checked.internalDnc = true;
    const internal = await onInternalDnc(phone);
    if (internal.onList) {
      hardStops.push(stop(
        'INTERNAL_DNC',
        'Honor STOP forever (spine rule 6)',
        internal.errored
          ? 'Internal DNC lookup failed - blocking to be safe (fail-closed).'
          : 'Number is on the internal do-not-contact list.'
      ));
    }

    // Federal DNC (fail-OPEN by its own contract until configured).
    if (!opts.skipFederalDnc) {
      checked.federalDnc = true;
      try {
        const fed = await isOnFederalDnc(phone);
        if (fed.checked && fed.onList) {
          hardStops.push(stop(
            'FEDERAL_DNC',
            'FTC National DNC (spine rule 6)',
            'Number is on the federal Do Not Call registry.'
          ));
        } else if (!fed.checked) {
          warnings.push(stop('FEDERAL_DNC_UNVERIFIED', 'FTC DNC', fed.reason || 'Federal DNC not verified.'));
        }
      } catch (e) {
        warnings.push(stop('FEDERAL_DNC_UNVERIFIED', 'FTC DNC', `Lookup error: ${e.message}`));
      }
    }
  }

  // ── State wholesaling layer (informs disclosures + high-risk structures) ────
  if (stateCode) {
    checked.state = true;
    const sc = getStateCompliance(stateCode);
    if (sc.disclosure_required && sc.disclosure_language) {
      requiredDisclosures.push(sc.disclosure_language);
    }
    // Actions that market/assign/record against the property in a state that
    // bans unlicensed assignment are a hard-stop on THAT structure (a compliant
    // alternative - double close - exists, so this blocks the structure, not the deal).
    const structureActions = new Set(['assign_contract', 'market_property', 'record_memorandum', 'advertise_property']);
    if (structureActions.has(action.type) && sc.assignment_legal === false) {
      hardStops.push(stop(
        'STATE_ASSIGNMENT_BANNED',
        `${sc.state_name || stateCode} wholesaling law (spine rule 6)`,
        `Unlicensed assignment/marketing is restricted in ${sc.state_name || stateCode}. Use a compliant structure (e.g. double close) instead.`
      ));
    }
    if (sc.risk_level === 'high') {
      warnings.push(stop('STATE_HIGH_RISK', `${sc.state_name || stateCode} wholesaling law`, sc.notes || 'High-risk wholesaling jurisdiction - verify current statute.'));
    }
  }

  return {
    allowed: hardStops.length === 0,
    hardStops,
    warnings,
    requiredDisclosures,
    checked,
  };
}

/** Map an action type to a channel when channel is not given explicitly. */
function channelFromType(type) {
  switch (type) {
    case 'send_sms': return 'sms';
    case 'send_mms': return 'mms';
    case 'place_call': case 'live_call': return 'call';
    case 'send_rvm': case 'ringless_voicemail': return 'rvm';
    case 'leave_voicemail': return 'voicemail';
    case 'send_email': return 'email';
    default: return type || 'unknown';
  }
}

module.exports = {
  complianceGate,
  scanProtectedClass,   // exported for the Compliance Agent + tests
  channelFromType,
  PROTECTED_CLASS_TERMS,
  TELEPHONY_CHANNELS,
};
