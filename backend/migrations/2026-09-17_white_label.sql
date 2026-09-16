-- White label. One brand per workspace owner. Logos live in the public
-- brand-assets bucket (a logo is meant to be seen). A custom domain is only
-- trusted (CORS, login branding) after its DNS TXT record proves ownership.
CREATE TABLE IF NOT EXISTS public.brand_settings (
  user_id              uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  brand_name           text CHECK (brand_name IS NULL OR char_length(brand_name) BETWEEN 1 AND 80),
  logo_path            text,
  primary_color        text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  support_email        text,
  support_phone        text,
  hide_powered_by      boolean NOT NULL DEFAULT false,
  custom_domain        text CHECK (custom_domain IS NULL OR custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  domain_verify_token  text,
  domain_verified_at   timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brand_settings_domain_key ON public.brand_settings (custom_domain) WHERE custom_domain IS NOT NULL;
ALTER TABLE public.brand_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brand_settings_owner_read ON public.brand_settings;
CREATE POLICY brand_settings_owner_read ON public.brand_settings FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;
