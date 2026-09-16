-- Public REST API keys and outbound webhooks.
-- Keys are stored only as SHA-256 hashes; the raw key is shown once at creation.
-- All three tables are server-side only: RLS on, owners may read their own rows
-- (never a key hash or webhook secret is exposed through the backend API).

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON public.api_keys (user_id, created_at DESC);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_keys_owner_read ON public.api_keys;
CREATE POLICY api_keys_owner_read ON public.api_keys FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  url                  text NOT NULL CHECK (url ~ '^https://'),
  description          text,
  events               text[] NOT NULL DEFAULT '{}',
  secret               text NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  consecutive_failures integer NOT NULL DEFAULT 0,
  disabled_reason      text,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_user_idx ON public.webhook_endpoints (user_id) WHERE is_active;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event           text NOT NULL,
  event_id        uuid NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  response_status integer,
  response_body   text,
  error           text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON public.webhook_deliveries (next_attempt_at) WHERE status IN ('pending', 'delivering');
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON public.webhook_deliveries (endpoint_id, created_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
