-- Least privilege for the public schema.
-- The web app never talks to Supabase directly: every read and write goes through
-- the backend with the service role. The anon and authenticated roles (reachable
-- by anyone holding the project's publishable key) therefore need no access.
-- RLS already denies them rows; this also removes the grants, and in particular
-- stops anon from calling SECURITY DEFINER functions such as
-- increment_user_counter, which bypass RLS.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Objects created later by migrations (run as postgres) get the same treatment.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema public grant all on tables    to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
