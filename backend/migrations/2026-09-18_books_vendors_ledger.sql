-- Books: one ledger for the whole business, plus the vendors paid from it.
-- A ledger entry belongs to a property, to a deal, or to neither (business
-- overhead such as marketing or software), so nothing an operator spends lives
-- outside the books. The vendor row records WHETHER a W-9 is held - never a tax id.
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  trade text, phone text, email text, address text,
  w9_on_file boolean not null default false,
  issues_1099 boolean not null default true,
  entity_type text check (entity_type in ('individual','sole_prop','llc','s_corp','c_corp','partnership','other')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendors_user_idx on public.vendors (user_id, is_active, name);
alter table public.vendors enable row level security;

alter table public.portfolio_transactions alter column property_id drop not null;
alter table public.portfolio_transactions add column if not exists deal_id uuid references public.deals(id) on delete set null;
alter table public.portfolio_transactions add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
alter table public.portfolio_transactions add column if not exists paid_method text;
create index if not exists portfolio_tx_deal_idx   on public.portfolio_transactions (deal_id, occurred_on desc);
create index if not exists portfolio_tx_vendor_idx on public.portfolio_transactions (vendor_id, occurred_on desc);
comment on table public.portfolio_transactions is 'Business ledger: money in and out, optionally against a property, a deal, and a vendor.';
