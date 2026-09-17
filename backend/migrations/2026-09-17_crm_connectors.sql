-- CRM connectors: push new leads into the workspace's HubSpot or Follow Up Boss.
-- Credentials are stored AES-256-GCM encrypted (services/fieldCrypto, PII_ENCRYPTION_KEY),
-- never in plaintext. Jobs retry with backoff so a CRM outage loses nothing.

create table if not exists public.crm_connections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  provider             text not null check (provider in ('hubspot', 'followupboss')),
  credential_encrypted text not null,
  credential_hint      text,
  sync_new_leads       boolean not null default true,
  status               text not null default 'active' check (status in ('active', 'error', 'paused')),
  last_error           text,
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.crm_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  connection_id    uuid not null references public.crm_connections(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete cascade,
  event            text not null,
  status           text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (connection_id, lead_id, event)
);
create index if not exists crm_sync_jobs_due_idx on public.crm_sync_jobs (next_attempt_at) where status = 'pending';
create index if not exists crm_sync_jobs_processing_idx on public.crm_sync_jobs (next_attempt_at) where status = 'processing';

create table if not exists public.crm_links (
  connection_id uuid not null references public.crm_connections(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  external_id   text not null,
  synced_at     timestamptz not null default now(),
  primary key (connection_id, lead_id)
);

alter table public.crm_connections enable row level security;
alter table public.crm_sync_jobs   enable row level security;
alter table public.crm_links       enable row level security;
-- No policies: only the backend (service role) reads or writes these tables.
