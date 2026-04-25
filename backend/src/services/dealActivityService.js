const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

async function logActivity({
  userId,
  dealId,
  leadId = null,
  titleCompanyId = null,
  actorType = 'system',
  activityType,
  message,
  metadata = {},
}) {
  if (!userId || !dealId || !activityType || !message) return null;

  const payload = {
    id: uuidv4(),
    user_id: userId,
    deal_id: dealId,
    lead_id: leadId,
    title_company_id: titleCompanyId,
    actor_type: actorType,
    activity_type: activityType,
    message,
    metadata,
  };

  const { data, error } = await supabase
    .from('deal_activity')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = { logActivity };
