-- The cross-operator pool holds no user id. A one-way HMAC lets the system
-- require several distinct operators behind any reported figure without being
-- able to identify any of them.
-- Applied to production 2026-09-18 (supabase migration 20260918033144).

alter table public.creative_performance_learnings
  add column if not exists contributor_hash text;

create index if not exists cpl_contributor_idx
  on public.creative_performance_learnings (contributor_hash);

create index if not exists cpl_angle_platform_idx
  on public.creative_performance_learnings (campaign_angle, platform);
