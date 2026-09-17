-- Lead funnel counts for the Lead Scoring and Lead Generation agents: probabilities
-- come from the workspace's own history (with confidence intervals computed in the
-- API), never from an invented model. Service role only.

create or replace function public.lead_funnel_counts(p_user_id uuid, p_primary_tag text default null, p_source text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with l as (
    select id from leads
     where user_id = p_user_id
       and (p_primary_tag is null or primary_tag = p_primary_tag)
       and (p_source is null or source = p_source)
  ), d as (
    select lead_id, status from deals where user_id = p_user_id and lead_id in (select id from l)
  )
  select jsonb_build_object(
    'leads', (select count(*) from l),
    'responded', (select count(distinct x.lead_id) from (
        select lead_id from sms_messages where user_id = p_user_id and direction = 'inbound' and lead_id in (select id from l)
        union
        select lead_id from calls where user_id = p_user_id and lead_id in (select id from l)
           and outcome is not null and outcome not in ('no_answer', 'voicemail', 'not_home', 'busy', 'failed')
      ) x),
    'appointment', (select count(distinct y.lead_id) from (
        select lead_id from appointments where user_id = p_user_id and lead_id in (select id from l)
        union
        select lead_id from calls where user_id = p_user_id and outcome = 'appointment' and lead_id in (select id from l)
      ) y),
    'offer', (select count(distinct lead_id) from d where status in ('offer_sent', 'negotiating', 'under_contract', 'sent_to_title', 'closing_prep', 'closed')),
    'contract', (select count(distinct lead_id) from d where status in ('under_contract', 'sent_to_title', 'closing_prep', 'closed')),
    'closed', (select count(distinct lead_id) from d where status = 'closed')
  );
$$;

create or replace function public.lead_source_performance(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.leads desc), '[]'::jsonb) from (
    select coalesce(l.source, 'unknown') as source,
           count(*) as leads,
           count(distinct d.lead_id) filter (where d.status in ('under_contract', 'sent_to_title', 'closing_prep', 'closed')) as contracts,
           count(distinct d.lead_id) filter (where d.status = 'closed') as closed,
           coalesce(sum(d.assignment_fee) filter (where d.status = 'closed'), 0)::float8 as closed_fees
      from leads l
      left join deals d on d.lead_id = l.id and d.user_id = p_user_id
     where l.user_id = p_user_id
     group by 1
  ) t;
$$;

revoke all on function public.lead_funnel_counts(uuid, text, text) from public, anon, authenticated;
revoke all on function public.lead_source_performance(uuid) from public, anon, authenticated;
grant execute on function public.lead_funnel_counts(uuid, text, text) to service_role;
grant execute on function public.lead_source_performance(uuid) to service_role;
