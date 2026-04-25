-- Execution spine: title workflow normalization + deal activity timeline

ALTER TABLE title_companies
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS preferred_states TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_communication_method TEXT,
  ADD COLUMN IF NOT EXISTS relationship_status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS deal_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  title_company_id UUID REFERENCES title_companies(id) ON DELETE SET NULL,
  actor_type TEXT DEFAULT 'system',
  activity_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_activity_user_id ON deal_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_activity_deal_id ON deal_activity(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_activity_created_at ON deal_activity(created_at DESC);

CREATE TABLE IF NOT EXISTS title_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  title_company_id UUID REFERENCES title_companies(id) ON DELETE SET NULL,
  title_contact_name TEXT,
  title_contact_phone TEXT,
  title_contact_email TEXT,
  sent_to_title_at TIMESTAMPTZ,
  status TEXT DEFAULT 'documents_sent',
  closing_date DATE,
  last_follow_up_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  fee_received NUMERIC,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_title_logs_user_id ON title_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_title_logs_deal_id ON title_logs(deal_id);

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  contract_type TEXT NOT NULL,
  content TEXT NOT NULL,
  signing_status TEXT DEFAULT 'draft',
  signing_url TEXT,
  closing_date DATE,
  sent_at TIMESTAMPTZ,
  fully_signed_at TIMESTAMPTZ,
  signed_summary JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_signers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  access_token TEXT UNIQUE NOT NULL,
  printed_name TEXT,
  signature_text TEXT,
  status TEXT DEFAULT 'pending',
  accessed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_user_id ON contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_deal_id ON contracts(deal_id);
CREATE INDEX IF NOT EXISTS idx_contract_signers_contract_id ON contract_signers(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signers_access_token ON contract_signers(access_token);

CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID,
  contact_type TEXT DEFAULT 'seller',
  follow_up_type TEXT DEFAULT 'text',
  next_follow_up_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled',
  outcome TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_user_id ON follow_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_deal_id ON follow_ups(deal_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_next_follow_up_at ON follow_ups(next_follow_up_at);

CREATE TABLE IF NOT EXISTS property_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'seller',
  storage_path TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  content_type TEXT,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_photos_user_id ON property_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_property_photos_deal_id ON property_photos(deal_id);
