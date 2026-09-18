-- Veori Ads: the intelligence that runs BEFORE any creative is made.
-- Nothing here stores invented market data: every brief records which sources
-- answered and which did not, and its confidence follows from that.
-- Applied to production 2026-09-18 (supabase migration 20260918002837).

create table if not exists public.operator_ad_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_years numeric,
  markets text[],
  property_types text[],
  price_min numeric,
  price_max numeric,
  exit_strategies text[],
  monthly_ad_budget numeric,
  target_leads_per_month integer,
  good_lead_definition text,
  bad_lead_definition text,
  biggest_frustration text,
  has_call_team boolean,
  channels_tried text[],
  markets_that_worked text[],
  -- Voice profile extracted from the operator's own material; never invented.
  voice jsonb not null default '{}'::jsonb,
  voice_source text,
  voice_extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.market_preflight_brief (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  market text not null,
  target_zips text[] not null default '{}',
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  data_confidence integer not null default 0 check (data_confidence between 0 and 100),
  opportunity_score integer check (opportunity_score between 0 and 100),
  creative_intelligence_score integer check (creative_intelligence_score between 0 and 100),
  primary_angle text,
  primary_driver text,
  brief jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  data_gaps jsonb not null default '[]'::jsonb,
  superseded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists preflight_user_market_idx on public.market_preflight_brief (user_id, market, generated_at desc);
create index if not exists preflight_live_idx on public.market_preflight_brief (user_id, market) where superseded = false;

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brief_id uuid references public.market_preflight_brief(id) on delete set null,
  market text not null,
  name text,
  platform text not null check (platform in ('meta','google','tiktok','youtube')),
  campaign_angle text,
  psychological_driver text,
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  daily_budget numeric,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_campaigns_user_idx on public.ad_campaigns (user_id, status, created_at desc);
create index if not exists ad_campaigns_market_idx on public.ad_campaigns (market, status);

create table if not exists public.creative_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  preflight_brief_id uuid references public.market_preflight_brief(id) on delete set null,
  market text not null,
  angle text not null,
  psychological_driver text not null,
  image_format text,
  hook text,
  hook_style text,
  emotional_tone text,
  brief jsonb not null,
  compliance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists creative_briefs_user_idx on public.creative_briefs (user_id, created_at desc);

create table if not exists public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.ad_campaigns(id) on delete set null,
  creative_brief_id uuid references public.creative_briefs(id) on delete set null,
  market text,
  asset_type text not null check (asset_type in ('image','video_script','ad_copy','landing_copy','organic_post')),
  angle text,
  psychological_driver text,
  image_format text,
  hook text,
  hook_style text,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','active','paused','fatigued','archived')),
  first_served_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ad_creatives_user_idx on public.ad_creatives (user_id, status, created_at desc);
create index if not exists ad_creatives_dedupe_idx on public.ad_creatives (user_id, angle, hook_style, image_format, created_at desc);

-- Cross-operator learning: anonymised, never operator-identifiable to another operator.
create table if not exists public.creative_performance_learnings (
  id uuid primary key default gen_random_uuid(),
  market_type text,
  distress_type text,
  campaign_angle text,
  psychological_driver text,
  image_format text,
  hook_style text,
  platform text,
  audience_age_range text,
  impressions integer not null default 0,
  clicks integer not null default 0,
  ctr numeric,
  leads integer not null default 0,
  cpl_cents integer,
  qualified_leads integer not null default 0,
  cpql_cents integer,
  contracts integer not null default 0,
  cost_per_contract_cents integer,
  market_competitive_density text,
  season text,
  year integer,
  created_at timestamptz not null default now()
);
create index if not exists cpl_learnings_lookup_idx on public.creative_performance_learnings (distress_type, psychological_driver, image_format, created_at desc);

create table if not exists public.operator_learning_model (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  best_converting_distress_type text,
  best_converting_audience_age_range text,
  best_converting_platform text,
  best_converting_angle text,
  best_converting_zip_codes jsonb not null default '[]'::jsonb,
  avg_cpl_by_channel jsonb not null default '{}'::jsonb,
  avg_cost_per_contract_by_channel jsonb not null default '{}'::jsonb,
  response_speed_avg_minutes integer,
  leads_to_contract_rate numeric,
  data_points integer not null default 0,
  last_updated timestamptz not null default now(),
  unique (user_id)
);

alter table public.operator_ad_profile            enable row level security;
alter table public.market_preflight_brief         enable row level security;
alter table public.ad_campaigns                   enable row level security;
alter table public.creative_briefs                enable row level security;
alter table public.ad_creatives                   enable row level security;
alter table public.creative_performance_learnings enable row level security;
alter table public.operator_learning_model        enable row level security;
