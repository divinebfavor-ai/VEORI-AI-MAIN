-- Veori Super-Agent intelligence layer - Phase 1 foundation.
-- Shared real-estate graph, agent registry, immutable audit trail, approvals,
-- agent outputs, best next actions and per-workspace autopilot settings.
-- Every tenant table carries user_id; the backend (service role) scopes every query.
-- RLS is enabled with no policies: anon/authenticated have no access (see
-- 2026-09-17_least_privilege_public_schema.sql).

-- ── Shared real-estate graph ────────────────────────────────────────────────
create table if not exists public.properties (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  address       text,
  city          text,
  state         text,
  zip           text,
  county        text,
  parcel_id     text,
  property_type text,
  condition     text,
  zoning        text,
  units         integer,
  sqft          integer,
  lot_sqft      integer,
  bedrooms      numeric,
  bathrooms     numeric,
  year_built    integer,
  occupancy     text,
  market_id     text,
  facts         jsonb not null default '{}'::jsonb,   -- field -> claim {value,status,source,as_of,confidence}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists properties_user_lead_key on public.properties (user_id, lead_id);
create index if not exists properties_user_idx on public.properties (user_id);

create table if not exists public.persons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  deal_id     uuid references public.deals(id) on delete cascade,
  lead_id     uuid references public.leads(id) on delete set null,
  buyer_id    uuid references public.buyers(id) on delete set null,
  role        text not null check (role in ('seller', 'buyer', 'lender', 'broker', 'title', 'attorney', 'contractor', 'other')),
  full_name   text,
  phone       text,
  email       text,
  company     text,
  facts       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists persons_user_deal_idx on public.persons (user_id, deal_id);

create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  deal_id         uuid not null unique references public.deals(id) on delete cascade,
  stage           text,
  structure_type  text,
  status          text not null default 'open',
  terms           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists transactions_user_idx on public.transactions (user_id);

create table if not exists public.loans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  property_id       uuid not null references public.properties(id) on delete cascade,
  lender            text,
  loan_type         text,
  balance           numeric,
  rate_pct          numeric,
  monthly_payment   numeric,
  maturity_date     date,
  arrears           numeric,
  position          integer,
  provenance        jsonb not null default '{}'::jsonb,  -- {status, source, as_of, confidence}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists loans_user_property_idx on public.loans (user_id, property_id);

create table if not exists public.liens (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete cascade,
  lien_type      text not null,
  amount         numeric,
  holder         text,
  priority       integer,
  recorded_date  date,
  provenance     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists liens_user_property_idx on public.liens (user_id, property_id);

create table if not exists public.comparables (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  deal_id           uuid references public.deals(id) on delete cascade,
  property_id       uuid references public.properties(id) on delete cascade,
  address           text not null,
  price             numeric,
  price_type        text not null default 'unknown' check (price_type in ('sold', 'listed', 'avm_comparable', 'unknown')),
  event_date        date,
  sqft              integer,
  bedrooms          numeric,
  bathrooms         numeric,
  year_built        integer,
  distance_miles    numeric,
  correlation       numeric,
  adjustments       jsonb not null default '[]'::jsonb,
  adjusted_price    numeric,
  source            text not null,
  source_record_id  text,
  retrieved_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists comparables_user_deal_idx on public.comparables (user_id, deal_id);
create unique index if not exists comparables_dedupe_key on public.comparables (user_id, property_id, source, address);

create table if not exists public.market_data (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  geography     text not null,          -- zip | metro | state | national
  geo_key       text not null,          -- e.g. 78701, US
  metric        text not null,          -- median_sale_price, median_rent, mortgage_rate_30y, ...
  value         numeric,
  period        text,
  source        text not null,
  source_url    text,
  retrieved_at  timestamptz not null default now(),
  unique (user_id, geography, geo_key, metric, period, source)
);

create table if not exists public.knowledge_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users(id) on delete cascade, -- null = platform-wide
  topic            text not null,
  jurisdiction     text,
  content          jsonb not null,
  source           text not null,
  source_url       text,
  effective_date   date,
  last_verified_at timestamptz,
  review_by        date,
  confidence       integer check (confidence between 0 and 100),
  created_at       timestamptz not null default now()
);
create index if not exists knowledge_items_topic_idx on public.knowledge_items (topic, jurisdiction);

-- ── Deal understanding ───────────────────────────────────────────────────────
alter table public.deals add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.deals add column if not exists understanding jsonb;
alter table public.deals add column if not exists understanding_updated_at timestamptz;

-- ── Agent registry ──────────────────────────────────────────────────────────
create table if not exists public.agent_registry (
  id                     text primary key,
  name                   text not null,
  domain                 text not null,
  version                text not null,
  capabilities           text[] not null default '{}',
  required_inputs        text[] not null default '{}',
  outputs                text[] not null default '{}',
  tools                  text[] not null default '{}',
  knowledge_sources      text[] not null default '{}',
  permissions            text not null check (permissions in ('READ', 'RECOMMEND', 'DRAFT', 'EXECUTE', 'HIGH_RISK')),
  risk_level             text not null check (risk_level in ('low', 'medium', 'high')),
  handoff_agents         text[] not null default '{}',
  jurisdiction_aware     boolean not null default false,
  last_knowledge_update  text not null,
  status                 text not null default 'active',
  registered_at          timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── Orchestration runs + outputs ────────────────────────────────────────────
create table if not exists public.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  deal_id        uuid references public.deals(id) on delete cascade,
  actor_user_id  uuid references public.users(id) on delete set null,
  command        text,
  intent         text,
  plan           jsonb not null default '{}'::jsonb,
  synthesis      jsonb,
  status         text not null default 'running' check (status in ('running', 'completed', 'failed', 'partial')),
  error          text,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index if not exists agent_runs_user_deal_idx on public.agent_runs (user_id, deal_id, started_at desc);

create table if not exists public.agent_outputs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  deal_id               uuid references public.deals(id) on delete cascade,
  run_id                uuid references public.agent_runs(id) on delete cascade,
  agent_id              text not null,
  agent_version         text not null,
  output_type           text not null,
  data                  jsonb not null,
  confidence            integer not null check (confidence between 0 and 100),
  confidence_reasoning  text not null,
  sources               jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);
create index if not exists agent_outputs_user_deal_idx on public.agent_outputs (user_id, deal_id, created_at desc);
create index if not exists agent_outputs_run_idx on public.agent_outputs (run_id);

-- ── Immutable audit trail ───────────────────────────────────────────────────
create table if not exists public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  deal_id         uuid,
  run_id          uuid,
  agent_id        text,
  actor_user_id   uuid,
  action_type     text not null,
  inputs          jsonb not null default '{}'::jsonb,
  outputs         jsonb not null default '{}'::jsonb,
  confidence      integer check (confidence between 0 and 100),
  sources         jsonb not null default '[]'::jsonb,
  human_approved  boolean,
  approval_id     uuid,
  created_at      timestamptz not null default now()
);
create index if not exists audit_events_user_deal_idx on public.audit_events (user_id, deal_id, created_at desc);

-- Append-only: updates and deletes are refused. The one exception is the FK
-- cascade when the owning account itself is deleted (the users row is already
-- gone by the time the cascade reaches this table).
create or replace function public.audit_events_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'audit_events is append-only';
end;
$$;
drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function public.audit_events_immutable();

-- ── Human approval gates ────────────────────────────────────────────────────
create table if not exists public.agent_approvals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  deal_id         uuid references public.deals(id) on delete cascade,
  run_id          uuid references public.agent_runs(id) on delete set null,
  agent_id        text not null,
  action_type     text not null,
  payload         jsonb not null,
  reason          text not null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  requested_at    timestamptz not null default now(),
  expires_at      timestamptz,
  decided_at      timestamptz,
  decided_by      uuid references public.users(id) on delete set null,
  decision_note   text,
  executed_at     timestamptz,
  execution_result jsonb
);
create index if not exists agent_approvals_user_status_idx on public.agent_approvals (user_id, status, requested_at desc);

-- ── Best next action ────────────────────────────────────────────────────────
create table if not exists public.best_next_actions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  deal_id         uuid not null references public.deals(id) on delete cascade,
  run_id          uuid references public.agent_runs(id) on delete set null,
  action          text not null,
  why             text not null,
  urgency         text not null check (urgency in ('critical', 'high', 'medium', 'low')),
  impact          text not null,
  dependencies    jsonb not null default '[]'::jsonb,
  assigned_to     text not null,            -- 'operator' | agent id
  source_agent    text,
  status          text not null default 'current' check (status in ('current', 'superseded', 'done', 'dismissed')),
  calculated_at   timestamptz not null default now()
);
create index if not exists best_next_actions_deal_idx on public.best_next_actions (user_id, deal_id, status, calculated_at desc);

-- ── Copilot / Autopilot settings ────────────────────────────────────────────
create table if not exists public.agent_settings (
  user_id          uuid primary key references public.users(id) on delete cascade,
  mode             text not null default 'copilot' check (mode in ('copilot', 'autopilot')),
  auto_send_sms    boolean not null default false,
  auto_place_calls boolean not null default false,
  auto_draft       boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.users(id) on delete set null
);

alter table public.properties        enable row level security;
alter table public.persons           enable row level security;
alter table public.transactions      enable row level security;
alter table public.loans             enable row level security;
alter table public.liens             enable row level security;
alter table public.comparables       enable row level security;
alter table public.market_data       enable row level security;
alter table public.knowledge_items   enable row level security;
alter table public.agent_registry    enable row level security;
alter table public.agent_runs        enable row level security;
alter table public.agent_outputs     enable row level security;
alter table public.audit_events      enable row level security;
alter table public.agent_approvals   enable row level security;
alter table public.best_next_actions enable row level security;
alter table public.agent_settings    enable row level security;
