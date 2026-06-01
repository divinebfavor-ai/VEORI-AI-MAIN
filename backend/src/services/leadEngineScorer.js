/**
 * Lead Engine Sourcing Score
 *
 * Scores each lead 0–100 based on how many distress signals are present
 * simultaneously. More signals = higher motivation = higher score.
 *
 * Signal weights:
 *   Tax delinquent 3+ years        → +35
 *   Tax delinquent 2 years          → +25
 *   Bankruptcy filing               → +30
 *   Probate / estate                → +28
 *   Lis pendens / pre-foreclosure   → +32
 *   Divorce with property           → +22
 *   Code violation                  → +18
 *   Absentee owner                  → +15
 *   Vacant property                 → +12
 *   Out-of-state owner              → +10
 *   High tax owed (>$5k)            → +8
 *   Rural / land parcel             → +5
 */

const SIGNAL_WEIGHTS = {
  tax_delinquent_3plus: 35,
  tax_delinquent_2yr:   25,
  bankruptcy:           30,
  probate:              28,
  lis_pendens:          32,
  divorce:              22,
  code_violation:       18,
  absentee_owner:       15,
  vacant:               12,
  out_of_state_owner:   10,
  high_tax_owed:         8,
  rural_land:            5,
};

/**
 * Calculate sourcing score from a raw record
 * @param {Object} record - raw record from any source
 * @returns {{ score: number, signals: string[], lead_type: string }}
 */
function calculateSourcingScore(record) {
  const signals = [];

  // Tax delinquency signals
  const yearsDelinquent = parseFloat(record.years_delinquent || 0);
  if (yearsDelinquent >= 3) signals.push('tax_delinquent_3plus');
  else if (yearsDelinquent >= 2) signals.push('tax_delinquent_2yr');

  // Courthouse signals
  if (record.source_key === 'bankruptcy' || record.is_bankruptcy)   signals.push('bankruptcy');
  if (record.source_key === 'probate'    || record.is_probate)      signals.push('probate');
  if (record.source_key === 'lis_pendens'|| record.is_lis_pendens)  signals.push('lis_pendens');
  if (record.source_key === 'divorce'    || record.is_divorce)      signals.push('divorce');
  if (record.source_key === 'code_violation' || record.is_code_violation) signals.push('code_violation');

  // Property signals
  if (record.is_absentee || record.owner_state !== record.property_state) signals.push('absentee_owner');
  if (record.is_vacant   || record.property_type === 'vacant')             signals.push('vacant');
  if (record.owner_state && record.owner_state !== record.property_state)  signals.push('out_of_state_owner');
  if (parseFloat(record.tax_owed || 0) > 5000)                             signals.push('high_tax_owed');
  if (['land', 'rural', 'farm', 'agricultural'].includes((record.property_type || '').toLowerCase())) {
    signals.push('rural_land');
  }

  // Deduplicate
  const uniqueSignals = [...new Set(signals)];

  // Calculate raw score
  let raw = uniqueSignals.reduce((sum, s) => sum + (SIGNAL_WEIGHTS[s] || 0), 0);

  // Bonus for multiple signals (compound distress)
  if (uniqueSignals.length >= 3) raw += 10;
  if (uniqueSignals.length >= 4) raw += 10;

  // Cap at 100
  const score = Math.min(100, raw);

  // Determine primary lead type (highest-weight signal wins)
  const primarySignal = uniqueSignals.sort((a, b) => (SIGNAL_WEIGHTS[b] || 0) - (SIGNAL_WEIGHTS[a] || 0))[0];
  const SIGNAL_TO_TYPE = {
    tax_delinquent_3plus: 'tax_delinquent',
    tax_delinquent_2yr:   'tax_delinquent',
    bankruptcy:           'bankruptcy',
    probate:              'probate',
    lis_pendens:          'lis_pendens',
    divorce:              'divorce',
    code_violation:       'code_violation',
    absentee_owner:       'absentee',
    vacant:               'vacant_land',
    rural_land:           'rural_land',
  };

  return {
    score,
    signals:   uniqueSignals,
    lead_type: SIGNAL_TO_TYPE[primarySignal] || record.source_key || 'unknown',
  };
}

module.exports = { calculateSourcingScore, SIGNAL_WEIGHTS };
