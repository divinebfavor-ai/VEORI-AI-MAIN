// ─── Deal Scorecard ─────────────────────────────────────────────────────────
// Eleven independent dimensions. Deliberately no composite score: a deal with
// great profit and an unknown title is not "a 7".

const { STATUS, STRENGTH } = require('../provenance');
const { getPath } = require('../dealGraph');

const money = (n) => (n == null ? null : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
const cl = (rep, p) => getPath(rep, p) || { value: null, status: STATUS.UNKNOWN };

function dim(key, label, rating, value, evidence, note) {
  return { key, label, rating, value, evidence, note: note || null };
}

function build({ understanding: rep, outputs = {} }) {
  const out = (id) => outputs[id]?.data || outputs[id] || null;
  const dims = [];

  const value = cl(rep, 'financial.as_is_value');
  const arv = cl(rep, 'financial.arv');
  dims.push(dim('value', 'Value', value.status === STATUS.UNKNOWN && arv.status === STATUS.UNKNOWN ? 'unknown' : [STATUS.VERIFIED, STATUS.CALCULATED].includes(arv.status) ? 'supported' : 'unsupported',
    { as_is: money(value.value), arv: money(arv.value) }, [`As-is: ${value.status}${value.source ? ` (${value.source})` : ''}`, `ARV: ${arv.status}${arv.source ? ` (${arv.source})` : ''}`],
    'Supported means backed by sold comparables or calculation from verified inputs.'));

  const equity = cl(rep, 'financial.equity');
  const eqPct = equity.value != null && value.value > 0 ? Math.round((equity.value / value.value) * 100) : null;
  dims.push(dim('equity', 'Equity', eqPct == null ? 'unknown' : eqPct >= 50 ? 'high' : eqPct >= 20 ? 'moderate' : 'thin',
    { amount: money(equity.value), pct_of_value: eqPct }, [`${equity.status}: ${equity.basis || 'as-is value − loan balance'}`]));

  const w = out('wholesale');
  const profit = w?.data?.mao != null ? { mao: money(w.data.mao), verdict: w.data.verdict } : null;
  dims.push(dim('profit_potential', 'Profit potential', !profit ? 'unknown' : w.data.verdict === 'above_mao' ? 'negative at current price' : w.data.verdict === 'works_at_price' ? 'positive at current price' : 'depends on price',
    profit, w ? [w.summary] : ['Wholesale analysis not run']));

  const st = out('subject_to');
  const cashReq = st?.data && st.status === 'complete' ? st.findings?.find(f => /Cash needed/.test(f.label))?.claim?.value : null;
  const contract = cl(rep, 'transaction.contract_price');
  dims.push(dim('cash_required', 'Cash required', contract.value != null || cashReq != null ? 'estimated' : 'unknown',
    { cash_purchase: money(contract.value), subject_to_cash_at_close: money(cashReq) }, [`Contract price: ${contract.status}`], 'Excludes rehab and closing costs unless shown in a structure.'));

  const risk = out('risk');
  const counts = risk?.data?.counts || {};
  dims.push(dim('risk', 'Risk', !risk ? 'not assessed' : counts.critical ? 'critical' : counts.high ? 'high' : counts.medium ? 'medium' : 'low',
    counts, risk ? [risk.summary] : ['Risk agent not run']));

  const fin = out('financing');
  const priced = fin?.data?.ranked_by_cost?.length || 0;
  dims.push(dim('financing', 'Financing', !fin ? 'not assessed' : priced ? 'priced options' : 'unpriced', { priced_options: priced }, fin ? [fin.summary] : ['Financing agent not run']));

  const bm = out('buyer_matching');
  const dom = cl(rep, 'property.market.median_days_on_market');
  dims.push(dim('exit_liquidity', 'Exit liquidity', !bm ? (dom.value != null ? (dom.value <= 45 ? 'fast market' : 'slow market') : 'unknown') : bm.data.total_matches >= 5 ? 'strong buyer demand on your list' : bm.data.total_matches >= 1 ? 'some buyers' : 'no matching buyers',
    { matched_buyers: bm?.data?.total_matches ?? null, median_days_on_market: dom.value }, [bm?.summary, dom.status !== STATUS.UNKNOWN ? `Days on market: ${dom.status} (${dom.source})` : 'Days on market unknown'].filter(Boolean)));

  const tc = out('transaction_coordinator');
  const closing = cl(rep, 'transaction.closing_date');
  const days = tc?.data?.days_to_close ?? (closing.value ? Math.ceil((new Date(closing.value).getTime() - Date.now()) / 86400000) : null);
  dims.push(dim('time', 'Time', days == null ? 'no closing date' : days < 0 ? 'past due' : days <= 7 ? 'closing this week' : 'on schedule', { days_to_close: days ?? null },
    tc ? [tc.summary] : [closing.value ? `Closing date ${String(closing.value).slice(0, 10)} (${closing.status})` : 'No closing date recorded', 'Transaction coordinator not run']));

  const claims = [];
  const walk = (n) => { if (!n || typeof n !== 'object') return; if ('status' in n && 'value' in n) { claims.push(n.status); return; } Object.values(n).forEach(walk); };
  ['property', 'people', 'transaction', 'financial'].forEach(k => walk(rep[k]));
  const known = claims.filter(s => s !== STATUS.UNKNOWN).length;
  const strong = claims.filter(s => STRENGTH[s] >= STRENGTH.USER_PROVIDED).length;
  const knownPct = claims.length ? Math.round((known / claims.length) * 100) : 0;
  dims.push(dim('data_confidence', 'Data confidence', knownPct >= 70 && strong / Math.max(1, known) >= 0.5 ? 'good' : knownPct >= 40 ? 'partial' : 'weak',
    { facts_known_pct: knownPct, verified_or_operator_pct: known ? Math.round((strong / known) * 100) : 0, unknown_count: rep.unknowns?.length ?? null },
    [`${known} of ${claims.length} facts known; ${strong} verified or provided by you`]));

  const ti = out('title_intelligence');
  dims.push(dim('title_status', 'Title status', !ti ? 'not assessed' : ti.data.title_file_open ? 'title opened, not cleared' : ti.data.flag_count ? 'red flags, no title search' : 'no title search',
    { red_flags: ti?.data?.flag_count ?? null, title_file_open: ti?.data?.title_file_open ?? null }, ti ? [ti.summary] : ['Title agent not run'], 'Title is never shown as clear without a title commitment.'));

  const mkt = rep.property?.market || {};
  const anyMarket = Object.values(mkt).some(c => c && c.status !== STATUS.UNKNOWN);
  dims.push(dim('market_conditions', 'Market conditions', anyMarket ? 'data available' : 'unknown',
    { median_list_price: money(mkt.median_list_price?.value), median_days_on_market: mkt.median_days_on_market?.value ?? null, median_rent: money(mkt.median_rent?.value) },
    anyMarket ? [`Source: ${Object.values(mkt).find(c => c?.source)?.source}`] : ['No market data connected']));

  return { dimensions: dims, composite: null, note: 'Each dimension is independent; there is intentionally no overall score.' };
}

module.exports = { build };
