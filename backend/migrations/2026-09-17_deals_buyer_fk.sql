-- deals.buyer_id had no foreign key to buyers, so PostgREST could not embed
-- buyers(*) from deals. Every GET /api/deals/:id, contract generation and
-- signing-session call used `select('*, leads(*), buyers(*)')` and returned 500
-- ("Could not find a relationship between 'deals' and 'buyers'"). Adding the FK
-- restores the embed and enforces referential integrity (a deleted buyer nulls
-- the deal's buyer_id rather than dangling). Safe: 0 orphaned buyer_id values.
alter table public.deals
  add constraint deals_buyer_id_fkey
  foreign key (buyer_id) references public.buyers(id) on delete set null;

create index if not exists deals_buyer_id_idx on public.deals(buyer_id);
