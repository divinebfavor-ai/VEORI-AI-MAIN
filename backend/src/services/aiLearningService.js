/**
 * AI Learning System — internal Veori company asset.
 * Never expose raw learning data, model weights, or training logs to end users.
 * Only surface aggregated insights to operators.
 */

const supabase = require('../config/supabase');
const { extractConversationInsights } = require('./dualAIService');

// ─── Record conversation insight after a conversation ends ───────────────────
async function recordConversationInsight({ dealId, contactId, contactType, phase, conversationText, outcome }) {
  try {
    const insights = await extractConversationInsights({ conversationText, outcome });

    await supabase.from('conversation_insights').insert({
      deal_id: dealId || null,
      contact_id: contactId || null,
      contact_type: contactType || 'seller',
      phase: phase || 'qualification',
      objections_raised: insights.objections_raised || [],
      successful_language: insights.successful_language || [],
      sentiment_start: insights.sentiment_start || 0,
      sentiment_end: insights.sentiment_end || 0,
      outcome: outcome || insights.outcome || 'unknown',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AILearning] Conversation insight error:', err.message);
  }
}

// ─── Record deal outcome when deal closes or falls through ───────────────────
async function recordDealOutcome({ dealId, outcome, reason, motivationScore, state, propertyType, assignmentFee }) {
  try {
    const { data: deal } = await supabase.from('deals')
      .select('created_at, stage_changed_at')
      .eq('deal_id', dealId)
      .single();

    const { count: touchCount } = await supabase.from('ai_command_log')
      .select('*', { count: 'exact', head: true })
      .eq('deal_id', dealId);

    const now = new Date();
    const createdAt = deal?.created_at ? new Date(deal.created_at) : now;
    const daysToOutcome = Math.floor((now.getTime() - createdAt.getTime()) / 86400000);
    const month = now.getMonth() + 1;
    const seasons = ['winter','winter','spring','spring','spring','summer','summer','summer','fall','fall','fall','winter'];
    const season = seasons[now.getMonth()];

    await supabase.from('deal_outcome_learning').insert({
      deal_id: dealId,
      outcome,
      reason: reason || null,
      days_to_outcome: daysToOutcome,
      touches_count: touchCount || 0,
      final_motivation_score: motivationScore || null,
      state: state || null,
      property_type: propertyType || null,
      month,
      season,
      assignment_fee: assignmentFee || null,
      created_at: now.toISOString(),
    });

    // Update market intelligence
    if (state) {
      await updateMarketIntelligence({ state, outcome, assignmentFee });
    }
  } catch (err) {
    console.error('[AILearning] Deal outcome error:', err.message);
  }
}

// ─── Update buyer preference after accept/decline ─────────────────────────────
async function recordBuyerResponse({ buyerId, dealParams, accepted }) {
  try {
    const { data: existing } = await supabase.from('buyer_preferences')
      .select('*').eq('buyer_id', buyerId).single();

    if (existing) {
      const field = accepted ? 'accepted_deal_params' : 'rejected_deal_params';
      const current = existing[field] || [];
      const updated = Array.isArray(current) ? [...current, dealParams] : [dealParams];

      await supabase.from('buyer_preferences').update({
        [field]: updated.slice(-50), // keep last 50 responses
        match_accuracy_score: calculateMatchAccuracy(existing),
        updated_at: new Date().toISOString(),
      }).eq('preference_id', existing.preference_id);
    } else {
      await supabase.from('buyer_preferences').insert({
        buyer_id: buyerId,
        accepted_deal_params: accepted ? [dealParams] : [],
        rejected_deal_params: accepted ? [] : [dealParams],
        match_accuracy_score: 0,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[AILearning] Buyer preference error:', err.message);
  }
}

// ─── Update market intelligence for a state ───────────────────────────────────
async function updateMarketIntelligence({ state, outcome, assignmentFee }) {
  try {
    const { data: existing } = await supabase.from('market_intelligence')
      .select('*').eq('state', state).is('county', null).is('metro', null).single();

    const closed = outcome === 'closed' ? 1 : 0;
    const attempted = 1;

    if (existing) {
      const newAttempted = (existing.deals_attempted || 0) + attempted;
      const newClosed = (existing.deals_closed || 0) + closed;
      const newRate = newAttempted > 0 ? (newClosed / newAttempted) * 100 : 0;
      const newFeeAvg = closed && assignmentFee
        ? ((existing.avg_assignment_fee || 0) + assignmentFee) / 2
        : existing.avg_assignment_fee;

      await supabase.from('market_intelligence').update({
        deals_attempted: newAttempted,
        deals_closed: newClosed,
        close_rate: newRate,
        avg_assignment_fee: newFeeAvg || existing.avg_assignment_fee,
        updated_at: new Date().toISOString(),
      }).eq('record_id', existing.record_id);
    } else {
      await supabase.from('market_intelligence').insert({
        state,
        county: null,
        metro: null,
        deals_attempted: attempted,
        deals_closed: closed,
        close_rate: closed * 100,
        avg_assignment_fee: closed && assignmentFee ? assignmentFee : 0,
        trend_direction: 'flat',
        trend_percentage: 0,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[AILearning] Market intelligence update error:', err.message);
  }
}

// ─── Operator-facing insight (not raw data) ───────────────────────────────────
async function getOperatorInsight({ state, propertyType }) {
  try {
    const { data: outcomes } = await supabase.from('deal_outcome_learning')
      .select('days_to_outcome, touches_count, outcome')
      .eq('state', state)
      .eq('property_type', propertyType || 'single_family')
      .eq('outcome', 'closed')
      .limit(50);

    if (!outcomes || outcomes.length === 0) return null;

    const avgDays = Math.round(outcomes.reduce((s, r) => s + (r.days_to_outcome || 0), 0) / outcomes.length);
    const count = outcomes.length;

    return `Deals like this one close in an average of ${avgDays} days based on ${count} similar deals in your pipeline history.`;
  } catch {
    return null;
  }
}

function calculateMatchAccuracy(existing) {
  const accepted = Array.isArray(existing.accepted_deal_params) ? existing.accepted_deal_params.length : 0;
  const rejected = Array.isArray(existing.rejected_deal_params) ? existing.rejected_deal_params.length : 0;
  const total = accepted + rejected;
  if (total < 10) return existing.match_accuracy_score || 0;
  return Math.min(95, 50 + (accepted / total) * 50);
}

module.exports = {
  recordConversationInsight,
  recordDealOutcome,
  recordBuyerResponse,
  updateMarketIntelligence,
  getOperatorInsight,
};
