-- Phase 5: continuous deal monitoring alerts and Autopilot run history.
create table if not exists public.deal_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  agent_id text not null,
  alert_key text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  message text not null,
  recommended_action text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null
);
-- One open alert per deal per condition, so parallel monitor sweeps can't duplicate it.
create unique index if not exists deal_alerts_open_key on public.deal_alerts (deal_id, alert_key) where status = 'open';
create index if not exists deal_alerts_user_status_idx on public.deal_alerts (user_id, status, created_at desc);

create table if not exists public.autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  triggered_by text not null check (triggered_by in ('operator', 'sweep')),
  actor_user_id uuid references public.users(id) on delete set null,
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists autopilot_runs_deal_idx on public.autopilot_runs (user_id, deal_id, started_at desc);

alter table public.deals add column if not exists last_monitored_at timestamptz;
alter table public.deals add column if not exists last_autopilot_at timestamptz;

alter table public.deal_alerts enable row level security;
alter table public.autopilot_runs enable row level security;
