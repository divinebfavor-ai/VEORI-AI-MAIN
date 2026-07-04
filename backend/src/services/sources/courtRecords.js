/**
 * Courthouse Records Source Connector
 *
 * Pulls from:
 *  1. CourtAPI.com (commercial API - covers probate, lis pendens, divorce, code violations)
 *  2. State court open data portals
 *  3. County recorder public databases
 *
 * Source keys: 'probate' | 'lis_pendens' | 'divorce' | 'code_violation'
 */
const axios = require('axios');

const COURT_API_KEY = process.env.COURT_API_KEY;
const COURT_API_BASE = 'https://api.courtapi.com/v2';

// State court open data endpoints
const STATE_COURT_DATA = {
  FL: {
    lis_pendens: 'https://www.myfloridacounty.com/or/api/lispendens?state=FL&limit=200',
    probate:     'https://www.myfloridacounty.com/or/api/probate?state=FL&limit=200',
  },
  TX: {
    lis_pendens: 'https://courtsportal.dallascounty.org/DALLASPROD/api/lispendens?limit=200',
  },
  // More states loaded via CourtAPI
};

/**
 * Pull from CourtAPI (commercial, all 50 states)
 */
async function pullFromCourtAPI(sourceKey, state, county) {
  if (!COURT_API_KEY) return [];

  const caseTypeMap = {
    probate:        'PR',
    lis_pendens:    'FC',   // foreclosure / pre-foreclosure
    divorce:        'DR',
    code_violation: 'CV',
  };

  const caseType = caseTypeMap[sourceKey];
  if (!caseType) return [];

  try {
    const { data } = await axios.get(`${COURT_API_BASE}/cases/search`, {
      headers: { 'X-API-Key': COURT_API_KEY },
      params: {
        state,
        county,
        case_type:  caseType,
        has_property: true,
        date_filed_from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        limit: 200,
      },
      timeout: 30000,
    });

    const cases = data?.cases || [];
    return cases.map(c => {
      const party = (c.parties || []).find(p => p.type === 'defendant' || p.type === 'debtor') || c.parties?.[0] || {};
      const property = (c.properties || [])[0] || {};

      return {
        source_key:       sourceKey,
        case_number:      c.case_number,
        filing_date:      c.date_filed,
        first_name:       (party.name || '').split(' ')[0] || '',
        last_name:        (party.name || '').split(' ').slice(1).join(' ') || '',
        property_address: property.address || '',
        property_city:    property.city || '',
        property_state:   state,
        property_zip:     property.zip || '',
        county:           county || c.county || '',
        estimated_value:  parseFloat(property.value || 0),
        is_probate:       sourceKey === 'probate',
        is_lis_pendens:   sourceKey === 'lis_pendens',
        is_divorce:       sourceKey === 'divorce',
        is_code_violation: sourceKey === 'code_violation',
      };
    });
  } catch (err) {
    console.error(`[CourtRecords CourtAPI ${sourceKey} ${state}]`, err.message);
    return [];
  }
}

/**
 * Pull from state open data portals
 */
async function pullFromStatePortal(sourceKey, state) {
  const endpoints = STATE_COURT_DATA[state];
  if (!endpoints?.[sourceKey]) return [];

  try {
    const { data } = await axios.get(endpoints[sourceKey], { timeout: 30000 });
    const records = Array.isArray(data) ? data : (data.records || data.results || []);

    return records.slice(0, 200).map(r => ({
      source_key:       sourceKey,
      case_number:      r.case_number || r.instrument_number || '',
      filing_date:      r.filed_date || r.recording_date || null,
      first_name:       (r.grantor_name || r.defendant_name || r.name || '').split(' ')[0] || '',
      last_name:        (r.grantor_name || r.defendant_name || r.name || '').split(' ').slice(1).join(' ') || '',
      property_address: r.property_address || r.situs_address || '',
      property_city:    r.property_city || r.city || '',
      property_state:   state,
      property_zip:     r.property_zip || r.zip || '',
      county:           r.county || '',
      is_lis_pendens:   sourceKey === 'lis_pendens',
      is_probate:       sourceKey === 'probate',
      is_divorce:       sourceKey === 'divorce',
    }));
  } catch (err) {
    console.error(`[CourtRecords StatePortal ${sourceKey} ${state}]`, err.message);
    return [];
  }
}

/**
 * Main pull function for any courthouse source
 */
async function pullCourtRecords(sourceKey, state, county) {
  console.log(`[CourtRecords] Pulling ${sourceKey} | ${state}${county ? '/' + county : ''}`);

  if (COURT_API_KEY) {
    const records = await pullFromCourtAPI(sourceKey, state, county);
    if (records.length) return records;
  }

  return await pullFromStatePortal(sourceKey, state);
}

module.exports = { pullCourtRecords };
