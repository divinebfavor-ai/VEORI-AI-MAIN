/**
 * PACER Bankruptcy Source Connector
 *
 * Pulls Chapter 7, 11, 13 bankruptcy filings where real property is listed
 * as an asset from the federal PACER (Public Access to Court Electronic Records) system.
 *
 * PACER API: https://pacer.login.uscourts.gov/csologin/login.jsf
 * API Docs:  https://pcl.uscourts.gov/pcl/pages/search/find.jsf
 *
 * Fallback: Court Listener (free, Open Law Project) — covers federal bankruptcies
 * https://www.courtlistener.com/api/rest/v3/
 *
 * Source key: 'bankruptcy'
 */
const axios = require('axios');

const PACER_USER     = process.env.PACER_USERNAME;
const PACER_PASS     = process.env.PACER_PASSWORD;
const PACER_BASE     = 'https://pcl.uscourts.gov/pcl/api/v1';

// Court Listener (free fallback) — The Open Law Project
const CL_BASE = 'https://www.courtlistener.com/api/rest/v3';
const CL_TOKEN = process.env.COURT_LISTENER_TOKEN;

// State → federal district court codes
const STATE_TO_DISTRICT = {
  AL: ['almb','alnd','alsd'], AK: ['akb'], AZ: ['azb'], AR: ['areb','arwb'],
  CA: ['cacb','caeb','canb','casb'], CO: ['cob'], CT: ['ctb'], DE: ['deb'],
  FL: ['flmb','flnb','flsb'], GA: ['ganb','gamb','gasb'], HI: ['hib'],
  ID: ['idb'], IL: ['ilcb','ilnb','ilsb'], IN: ['innb','insb'],
  IA: ['ianb','iasb'], KS: ['ksb'], KY: ['kyeb','kywb'], LA: ['laeb','lamb','lawb'],
  ME: ['meb'], MD: ['mdb'], MA: ['mab'], MI: ['mieb','miwb'], MN: ['mnb'],
  MS: ['msnb','mssb'], MO: ['moeb','mowb'], MT: ['mtb'], NE: ['neb'],
  NV: ['nvb'], NH: ['nhb'], NJ: ['njb'], NM: ['nmb'], NY: ['nyeb','nynb','nysb','nywb'],
  NC: ['nceb','ncmb','ncwb'], ND: ['ndb'], OH: ['ohnb','ohsb'], OK: ['okeb','oknb','okwb'],
  OR: ['orb'], PA: ['paeb','pamb','pawb'], RI: ['rib'], SC: ['scb'],
  SD: ['sdb'], TN: ['tneb','tnmb','tnwb'], TX: ['txeb','txnb','txsb','txwb'],
  UT: ['utb'], VT: ['vtb'], VA: ['vaeb','vawb'], WA: ['waeb','wawb'],
  WV: ['wvnb','wvsb'], WI: ['wieb','wiwb'], WY: ['wyb'],
};

/**
 * Pull from Court Listener (free, no PACER account needed)
 */
async function pullFromCourtListener(state) {
  const districts = STATE_TO_DISTRICT[state] || [];
  if (!districts.length) return [];

  const results = [];
  for (const court of districts.slice(0, 2)) { // limit to 2 districts per run
    try {
      const headers = CL_TOKEN ? { Authorization: `Token ${CL_TOKEN}` } : {};
      const { data } = await axios.get(`${CL_BASE}/dockets/`, {
        headers,
        params: {
          court,
          nature_of_suit: '14',   // real property
          date_filed__gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          order_by:  '-date_filed',
          page_size: 100,
        },
        timeout: 30000,
      });

      const dockets = data?.results || [];
      for (const d of dockets) {
        results.push({
          source_key:       'bankruptcy',
          case_number:      d.docket_number || '',
          filing_date:      d.date_filed || null,
          first_name:       (d.case_name || '').split(' ')[0] || '',
          last_name:        (d.case_name || '').split(/\s+vs?\.\s+/i)[0]?.split(' ').slice(1).join(' ') || '',
          property_state:   state,
          county:           '',
          notes:            `Bankruptcy — ${d.cause || 'Chapter 7/13'} — ${d.court_id || court}`,
          is_bankruptcy:    true,
          case_url:         d.absolute_url ? `https://www.courtlistener.com${d.absolute_url}` : '',
        });
      }
    } catch (err) {
      console.error(`[PACER CourtListener ${court}]`, err.message);
    }
  }
  return results;
}

/**
 * Pull from official PACER API (requires paid account)
 */
async function pullFromPACER(state) {
  if (!PACER_USER || !PACER_PASS) return [];

  try {
    // Authenticate
    const authRes = await axios.post(`${PACER_BASE}/login`, {
      loginId: PACER_USER,
      password: PACER_PASS,
    }, { timeout: 15000 });

    const token = authRes.data?.nextGenCSO;
    if (!token) return [];

    const districts = STATE_TO_DISTRICT[state] || [];
    const results = [];

    for (const court of districts.slice(0, 2)) {
      try {
        const { data } = await axios.get(`${PACER_BASE}/cases/find`, {
          headers: { 'X-NEXT-GEN-CSO': token },
          params: {
            courtId:       court,
            caseType:      'bk',
            dateFiledFrom: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            hasAssets:     'true',
            pageSize:      100,
          },
          timeout: 30000,
        });

        const cases = data?.content || [];
        cases.forEach(c => {
          results.push({
            source_key:    'bankruptcy',
            case_number:   c.caseNumber,
            filing_date:   c.dateFiled,
            first_name:    (c.caseTitle || '').split(' ')[0] || '',
            last_name:     (c.caseTitle || '').split(' ').slice(1).join(' ') || '',
            property_state: state,
            county:        '',
            is_bankruptcy: true,
            notes:         `${c.chapter || 'BK'} — ${c.caseType || 'bankruptcy'}`,
          });
        });
      } catch (e) {
        console.error(`[PACER court ${court}]`, e.message);
      }
    }
    return results;
  } catch (err) {
    console.error('[PACER auth]', err.message);
    return [];
  }
}

/**
 * Main pull — PACER if configured, Court Listener as free fallback
 */
async function pullBankruptcy(state) {
  console.log(`[Bankruptcy] Pulling ${state}`);
  if (PACER_USER && PACER_PASS) {
    const records = await pullFromPACER(state);
    if (records.length) return records;
  }
  return pullFromCourtListener(state);
}

module.exports = { pullBankruptcy };
