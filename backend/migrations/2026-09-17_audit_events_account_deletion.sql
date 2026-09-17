-- audit_events is append-only (a trigger blocks update and delete), but its
-- user_id foreign key cascaded on account deletion: deleting a user tried to
-- delete its audit rows, the trigger refused, and the whole delete failed - so
-- no account could be deleted at all, including an erasure request.
-- The audit log keeps user_id as a plain column: the record of what happened
-- outlives the account, which is the point of an append-only trail.
alter table public.audit_events drop constraint if exists audit_events_user_id_fkey;
create index if not exists audit_events_user_created_idx on public.audit_events (user_id, created_at desc);
