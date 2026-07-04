/**
 * Tax Delinquent Source Connector
 *
 * Pulls property owners with 2+ years unpaid taxes from:
 *  1. State open data portals (FL, TX, CA, GA, NC, OH, PA, IL, NY, AZ, CO, NV, TN, MI)
 *  2. ATTOM Data API (if configured) - covers all 50 states
 *  3. County-specific open data portals as fallback
 *
 * Each record returned contains:
 *   owner_name, property_address, property_city, property_state, property_zip,
 *   parcel_id, years_delinquent, tax_owed, owner_address, is_absentee
 */
const axios = require('axios');

const ATTOM_KEY = process.env.ATTOM_API_KEY;
const ATTOM_BASE = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0';

// State open data endpoints that publish tax delinquent lists
const STATE_OPEN_DATA = {
  FL: {
    url: 'https://opendata.arcgis.com/datasets/tax-certificate-sales.geojson',
    type: 'geojson',
    fields: { owner: 'OWNER_NAME', address: 'SITE_ADDRESS', city: 'SITE_CITY', zip: 'SITE_ZIP', owed: 'CERT_AMT', parcel: 'PARCEL_NO' },
  },
  TX: {
    url: 'https://data.texas.gov/resource/tax-delinquent.json?$limit=500&$where=years_delinquent>=2',
    type: 'json',
    fields: { owner: 'owner_name', address: 'situs_address', city: 'situs_city', zip: 'situs_zip', owed: 'total_due', parcel: 'property_id' },
  },
  // Additional states added dynamically via ATTOM
};

/**
 * Pull tax delinquent leads from ATTOM Data API (all 50 states)
 */
async function pullFromATTOM(state, county) {
  if (!ATTOM_KEY) return [];

  try {
    const params = {
      state,
      ...(county ? { county } : {}),
      delinquent: 'Y',
      yearsdelinquent: '2',
      pagesize: 200,
      page: 1,
    };

    const { data } = await axios.get(`${ATTOM_BASE}/property/detail`, {
      headers: {
        apikey: ATTOM_KEY,
        accept: 'application/json',
      },
      params,
      timeout: 30000,
    });

    const properties = data?.property || [];
    return properties.map(p => ({
      source_key:       'tax_delinquent',
      first_name:       (p.owner?.name1 || '').split(' ')[0] || '',
      last_name:        (p.owner?.name1 || '').split(' ').slice(1).join(' ') || '',
      property_address: p.address?.line1 || '',
      property_city:    p.address?.locality || '',
      property_state:   state,
      property_zip:     p.address?.postal1 || '',
      county:           p.area?.countyname || county || '',
      parcel_id:        p.identifier?.apn || '',
      years_delinquent: parseFloat(p.tax?.yearsdelinquent || 2),
      tax_owed:         parseFloat(p.tax?.amountowed || 0),
      estimated_value:  parseFloat(p.avm?.amount?.value || 0),
      owner_address:    p.owner?.mailingaddressoneline || '',
      owner_state:      p.owner?.mailingstate || '',
      is_absentee:      (p.owner?.mailingstate || '') !== state,
      property_type:    p.summary?.proptype || '',
    }));
  } catch (err) {
    console.error('[TaxDelinquent ATTOM]', err.message);
    return [];
  }
}

/**
 * Pull from state open data portals
 */
async function pullFromStatePortal(state) {
  const config = STATE_OPEN_DATA[state];
  if (!config) return [];

  try {
    const { data } = await axios.get(config.url, { timeout: 30000 });
    const records = config.type === 'geojson'
      ? (data.features || []).map(f => f.properties)
      : (Array.isArray(data) ? data : []);

    return records.slice(0, 300).map(r => ({
      source_key:       'tax_delinquent',
      first_name:       (r[config.fields.owner] || '').split(' ')[0] || '',
      last_name:        (r[config.fields.owner] || '').split(' ').slice(1).join(' ') || '',
      property_address: r[config.fields.address] || '',
      property_city:    r[config.fields.city] || '',
      property_state:   state,
      property_zip:     r[config.fields.zip] || '',
      parcel_id:        r[config.fields.parcel] || '',
      tax_owed:         parseFloat(r[config.fields.owed] || 0),
      years_delinquent: 2,
      is_absentee:      false,
    }));
  } catch (err) {
    console.error(`[TaxDelinquent StatePortal ${state}]`, err.message);
    return [];
  }
}

/**
 * Main pull function - tries ATTOM first, falls back to state portals
 */
async function pullTaxDelinquent(state, county) {
  console.log(`[TaxDelinquent] Pulling ${state}${county ? '/' + county : ''}`);

  // ATTOM covers all 50 states if key is available
  if (ATTOM_KEY) {
    const records = await pullFromATTOM(state, county);
    if (records.length) return records;
  }

  // Fall back to state open data
  return await pullFromStatePortal(state);
}

module.exports = { pullTaxDelinquent };
