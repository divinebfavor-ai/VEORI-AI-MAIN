-- Indexes for the query shapes that dominate database time, verified against
-- pg_stat_statements on production. The lead-engine dedupe (user_id + address
-- ILIKE '%...%') alone was ~17% of total execution time with only 2.3k leads.
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- ILIKE with a leading wildcard cannot use a btree: trigram index, combined with
-- user_id so only one workspace's rows are scanned.
create index if not exists leads_user_address_trgm
  on public.leads using gin (user_id, property_address gin_trgm_ops);

create index if not exists leads_user_created_idx          on public.leads (user_id, created_at desc);
create index if not exists calls_user_status_created_idx   on public.calls (user_id, status, created_at desc);
create index if not exists deals_user_status_idx           on public.deals (user_id, status);
create index if not exists sms_messages_user_sent_idx      on public.sms_messages (user_id, sent_at desc);
create index if not exists follow_ups_user_status_due_idx  on public.follow_ups (user_id, status, next_follow_up_at);
create index if not exists landing_page_visits_created_idx on public.landing_page_visits (created_at desc);

-- Trigger function pinned to a fixed search_path (Supabase security lint).
create or replace function public.audit_events_immutable()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin raise exception 'audit_events is append-only'; end; $$;
