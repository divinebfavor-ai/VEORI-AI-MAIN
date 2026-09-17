-- GET /api/operator/preferences selects users.notification_preferences, which was
-- never created: the endpoint returned 500 for every account on every page load.
alter table public.users add column if not exists notification_preferences jsonb not null default '{}'::jsonb;
