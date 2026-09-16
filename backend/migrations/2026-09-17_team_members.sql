-- Team management. A team is an owner's workspace; members sign in with their own
-- account and work on the owner's data with a role:
--   admin  - everything except billing
--   member - day-to-day work; no billing, API keys, team management or number purchases
--   viewer - read-only
-- Invites carry a single-use token (stored as a SHA-256 hash) that expires.
CREATE TABLE IF NOT EXISTS public.team_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_user_id    uuid REFERENCES public.users(id) ON DELETE CASCADE,
  email             text NOT NULL,
  role              text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  status            text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'removed')),
  invite_token_hash text,
  invite_expires_at timestamptz,
  invited_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  removed_at        timestamptz,
  CHECK (owner_id IS DISTINCT FROM member_user_id)
);
-- One open invite or membership per email per team; a person is in at most one team.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_owner_email_key ON public.team_members (owner_id, lower(email)) WHERE status <> 'removed';
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_team_key ON public.team_members (member_user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS team_members_invite_token_key ON public.team_members (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_members_owner_idx ON public.team_members (owner_id, status);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_members_read_own ON public.team_members;
CREATE POLICY team_members_read_own ON public.team_members FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR member_user_id = auth.uid());
