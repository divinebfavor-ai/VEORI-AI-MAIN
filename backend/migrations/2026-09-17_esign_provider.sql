-- E-signature provider tracking. Contracts are signed on Veori's own signing page
-- unless DROPBOX_SIGN_API_KEY is set, in which case they go out through Dropbox Sign
-- and its callback marks signatures. These columns tie our rows to theirs.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS provider            text NOT NULL DEFAULT 'builtin',
  ADD COLUMN IF NOT EXISTS provider_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS contracts_provider_request_key ON public.contracts (provider_request_id) WHERE provider_request_id IS NOT NULL;
ALTER TABLE public.contract_signers
  ADD COLUMN IF NOT EXISTS provider_signature_id text;
CREATE INDEX IF NOT EXISTS contract_signers_provider_sig_idx ON public.contract_signers (provider_signature_id) WHERE provider_signature_id IS NOT NULL;
