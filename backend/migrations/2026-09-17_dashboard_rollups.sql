-- One round trip instead of fifteen: the dashboard's counts and sums, and the
-- onboarding checklist's existence checks. Called by the backend (service role only).
-- p_today / p_month_start / p_now are passed in by the API so the boundaries match
-- exactly what the previous per-table queries used (UTC).
-- sms_messages has no created_at: inbound texts are dated by sent_at (set on receipt).
-- The old per-table "replies today" query filtered on created_at, errored, and showed 0.

create or replace function public.dashboard_stats(p_user_id uuid, p_today timestamptz, p_month_start timestamptz, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total_leads',          (select count(*) from leads where user_id = p_user_id),
    'hot_leads',            (select count(*) from leads where user_id = p_user_id and motivation_score >= 70),
    'calls_today',          (select count(*) from calls where user_id = p_user_id and created_at >= p_today),
    'appointments_today',   (select count(*) from calls where user_id = p_user_id and outcome = 'appointment' and created_at >= p_today),
    'minutes_today',        (select round(coalesce(sum(duration_seconds), 0) / 60.0) from calls where user_id = p_user_id and created_at >= p_today),
    'deals_under_contract', (select count(*) from deals where user_id = p_user_id and status = 'under_contract'),
    'revenue_this_month',   (select coalesce(sum(assignment_fee), 0)::float8 from deals where user_id = p_user_id and status = 'closed' and created_at >= p_month_start),
    'title_workflows',      (select count(*) from title_logs where user_id = p_user_id),
    'title_risks',          (select count(*) from title_logs where user_id = p_user_id and status in ('documents_sent', 'stalled', 'funding_pending')),
    'pending_signatures',   (select count(*) from contracts where user_id = p_user_id and signing_status in ('sent', 'partially_signed')),
    'due_follow_ups',       (select count(*) from follow_ups where user_id = p_user_id and status = 'scheduled' and next_follow_up_at <= p_now),
    'sms_sent_today',       (select count(*) from sms_messages where user_id = p_user_id and direction = 'outbound' and sent_at >= p_today),
    'sms_replies_today',    (select count(*) from sms_messages where user_id = p_user_id and direction = 'inbound' and sent_at >= p_today),
    'buyers_blasted_today', (select coalesce(sum(buyers_called), 0) from buyer_campaigns where user_id = p_user_id and created_at >= p_today),
    'pipeline_funnel',      coalesce((select jsonb_object_agg(s, c) from (
                               select coalesce(status, 'new') s, count(*) c from leads where user_id = p_user_id group by 1) f), '{}'::jsonb)
  );
$$;

create or replace function public.onboarding_flags(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'has_leads',   exists (select 1 from leads where user_id = p_user_id),
    'has_number',  exists (select 1 from phone_numbers where user_id = p_user_id and is_active and released_at is null),
    'has_text_number', exists (select 1 from phone_numbers where user_id = p_user_id and is_active and released_at is null and is_toll_free and sms_verification_status = 'verified'),
    'has_buyers',  exists (select 1 from buyers where user_id = p_user_id),
    'has_calls',   exists (select 1 from calls where user_id = p_user_id)
  );
$$;

revoke all on function public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.onboarding_flags(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.onboarding_flags(uuid) to service_role;
