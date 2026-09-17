-- Portfolio: what the operator OWNS after a deal closes - properties, units,
-- leases and the money in and out. Acquisition already lives in leads/deals;
-- this is the hold side, so the whole business fits on the platform.
-- (Applied to production as migration "portfolio_v1"; full DDL there.)
create table if not exists public.portfolio_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  address text not null, city text, state text, zip text, property_type text,
  units_count integer not null default 1 check (units_count between 1 and 500),
  strategy text not null default 'rental' check (strategy in ('rental','flip','brrrr','short_term','land','commercial','other')),
  status text not null default 'owned' check (status in ('owned','under_rehab','listed','sold')),
  purchase_date date, purchase_price numeric, rehab_cost numeric, closing_costs numeric,
  current_value numeric, value_as_of date, value_source text,
  loan_balance numeric, loan_rate_pct numeric, loan_payment numeric, loan_escrow_monthly numeric,
  annual_taxes numeric, annual_insurance numeric, monthly_hoa numeric,
  sold_date date, sold_price numeric, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists portfolio_properties_user_idx on public.portfolio_properties (user_id, status, created_at desc);
create index if not exists portfolio_properties_deal_idx on public.portfolio_properties (deal_id);

create table if not exists public.portfolio_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  label text not null, beds numeric, baths numeric, sqft integer, market_rent numeric,
  created_at timestamptz not null default now()
);
create index if not exists portfolio_units_property_idx on public.portfolio_units (property_id);

create table if not exists public.portfolio_leases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  unit_id uuid references public.portfolio_units(id) on delete set null,
  tenant_name text, tenant_phone text, tenant_email text,
  start_date date, end_date date, monthly_rent numeric, deposit numeric,
  status text not null default 'active' check (status in ('active','pending','ended')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists portfolio_leases_property_idx on public.portfolio_leases (property_id, status);
create index if not exists portfolio_leases_user_end_idx on public.portfolio_leases (user_id, status, end_date);

create table if not exists public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid not null references public.portfolio_properties(id) on delete cascade,
  unit_id uuid references public.portfolio_units(id) on delete set null,
  lease_id uuid references public.portfolio_leases(id) on delete set null,
  occurred_on date not null,
  direction text not null check (direction in ('income','expense')),
  category text not null, amount numeric not null check (amount >= 0), memo text,
  created_at timestamptz not null default now()
);
create index if not exists portfolio_tx_property_date_idx on public.portfolio_transactions (property_id, occurred_on desc);
create index if not exists portfolio_tx_user_date_idx on public.portfolio_transactions (user_id, occurred_on desc);

alter table public.portfolio_properties   enable row level security;
alter table public.portfolio_units        enable row level security;
alter table public.portfolio_leases       enable row level security;
alter table public.portfolio_transactions enable row level security;
