-- VEORI AI — Complete Database Schema

-- Users (operators)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  plan TEXT DEFAULT 'hustle',
  calls_used INTEGER DEFAULT 0,
  calls_limit INTEGER DEFAULT 500,
  ai_messages_used INTEGER DEFAULT 0,
  ai_messages_limit INTEGER DEFAULT 200,
  -- AI persona
  ai_caller_name TEXT DEFAULT 'Alex',
  ai_voice_id TEXT,
  ai_personality_tone TEXT DEFAULT 'Professional',
  ai_intro_script TEXT,
  ai_voicemail_script TEXT,
  -- Legal
  legal_name TEXT,
  entity_name TEXT,
  entity_type TEXT,
  ein TEXT,
  re_license_number TEXT,
  re_license_state TEXT,
  -- Business contact
  business_phone TEXT,
  business_email TEXT,
  website TEXT,
  -- Contract defaults
  buyer_name_on_contract TEXT,
  earnest_money_default INTEGER DEFAULT 100,
  closing_period_default INTEGER DEFAULT 14,
  inspection_period_default INTEGER DEFAULT 10,
  include_assignment_fee_disclosure BOOLEAN DEFAULT true,
  custom_contract_addendum TEXT,
  -- Target markets
  target_states TEXT[],
  target_cities TEXT,
  property_types_preferred TEXT[],
  min_property_value INTEGER,
  max_property_value INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bank accounts (wire transfer details)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_type TEXT DEFAULT 'Checking',
  routing_number_encrypted TEXT,
  account_number_encrypted TEXT,
  routing_last4 TEXT,
  account_last4 TEXT,
  bank_address TEXT,
  swift_code TEXT,
  additional_instructions TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phone numbers
CREATE TABLE IF NOT EXISTS phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  vapi_phone_id TEXT,
  state TEXT,
  daily_calls_made INTEGER DEFAULT 0,
  total_calls_made INTEGER DEFAULT 0,
  spam_score INTEGER DEFAULT 100,
  health_status TEXT DEFAULT 'healthy',
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  -- Contact
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_2 TEXT,
  phone_3 TEXT,
  email TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  -- Property
  property_address TEXT NOT NULL,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  property_county TEXT,
  property_type TEXT DEFAULT 'single_family',
  beds INTEGER,
  baths DECIMAL(3,1),
  sqft INTEGER,
  lot_size TEXT,
  year_built INTEGER,
  garage BOOLEAN,
  pool BOOLEAN,
  stories TEXT,
  basement TEXT,
  foundation_type TEXT,
  -- Financial
  estimated_value INTEGER,
  estimated_arv INTEGER,
  estimated_equity INTEGER,
  estimated_equity_percent INTEGER,
  mortgage_balance INTEGER,
  monthly_payment INTEGER,
  is_behind_on_payments BOOLEAN,
  months_behind INTEGER,
  tax_delinquent BOOLEAN,
  tax_amount_owed INTEGER,
  has_liens BOOLEAN,
  lien_amount INTEGER,
  -- Source & motivation
  source TEXT DEFAULT 'Manual',
  sub_source TEXT,
  motivation_indicators TEXT[],
  lead_temperature TEXT DEFAULT 'Cold',
  -- AI analysis
  status TEXT DEFAULT 'new',
  motivation_score INTEGER,
  seller_personality TEXT,
  call_count INTEGER DEFAULT 0,
  last_call_date TIMESTAMPTZ,
  last_call_outcome TEXT,
  best_time_to_call TEXT,
  do_not_call BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  -- Offer tracking
  offer_price INTEGER,
  seller_counter INTEGER,
  agreed_price INTEGER,
  contract_sent_date TIMESTAMPTZ,
  contract_signed_date TIMESTAMPTZ,
  contract_expiry_date TIMESTAMPTZ,
  closing_date DATE,
  -- Relationship
  trust_level INTEGER DEFAULT 0,
  relationship_stage TEXT DEFAULT 'cold',
  -- Operator notes
  notes TEXT,
  tags TEXT[],
  priority TEXT DEFAULT 'medium',
  assigned_to UUID REFERENCES users(id),
  follow_up_date TIMESTAMPTZ,
  -- Skip trace
  skip_traced_at TIMESTAMPTZ,
  skip_trace_cost_cents INTEGER DEFAULT 0,
  -- Direct mail
  last_mail_sent_at TIMESTAMPTZ,
  mail_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DNC (Do Not Call) list
CREATE TABLE IF NOT EXISTS dnc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  reason TEXT,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone)
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  concurrent_lines INTEGER DEFAULT 3,
  daily_limit_per_number INTEGER DEFAULT 50,
  calling_hours_start TEXT DEFAULT '09:00',
  calling_hours_end TEXT DEFAULT '20:00',
  timezone TEXT DEFAULT 'America/New_York',
  total_leads INTEGER DEFAULT 0,
  leads_called INTEGER DEFAULT 0,
  leads_answered INTEGER DEFAULT 0,
  offers_made INTEGER DEFAULT 0,
  contracts_sent INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign leads (junction table)
CREATE TABLE IF NOT EXISTS campaign_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  call_attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  UNIQUE(campaign_id, lead_id)
);

-- Calls
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  campaign_id UUID REFERENCES campaigns(id),
  phone_number_id UUID REFERENCES phone_numbers(id),
  vapi_call_id TEXT UNIQUE,
  direction TEXT DEFAULT 'outbound',
  status TEXT DEFAULT 'initiated',
  outcome TEXT,
  phone_number TEXT,
  lead_name TEXT,
  property_address TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  transcript TEXT,
  summary TEXT,
  recording_url TEXT,
  motivation_score INTEGER,
  seller_personality TEXT,
  key_signals TEXT[],
  objections TEXT[],
  offer_made INTEGER,
  offer_response TEXT,
  next_steps TEXT,
  -- TCPA compliance
  local_time_of_call TEXT,
  was_within_calling_hours BOOLEAN,
  dnc_checked BOOLEAN DEFAULT false,
  dnc_check_result TEXT,
  attempt_number INTEGER DEFAULT 1,
  days_since_last_attempt INTEGER,
  consent_status TEXT DEFAULT 'unknown',
  -- Operator takeover
  was_taken_over BOOLEAN DEFAULT false,
  operator_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deals
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  buyer_id UUID,
  title_company_id UUID,
  status TEXT DEFAULT 'new',
  -- Property
  property_address TEXT NOT NULL,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  property_type TEXT,
  beds INTEGER,
  baths DECIMAL(3,1),
  sqft INTEGER,
  -- Financials
  arv INTEGER,
  repair_estimate INTEGER,
  mao INTEGER,
  offer_price INTEGER,
  seller_agreed_price INTEGER,
  earnest_money INTEGER DEFAULT 100,
  buyer_price INTEGER,
  assignment_fee INTEGER,
  -- Repair breakdown (JSON)
  repair_breakdown JSONB,
  -- Scenarios
  scenario_conservative JSONB,
  scenario_moderate JSONB,
  scenario_aggressive JSONB,
  -- Contracts
  psa_url TEXT,
  psa_signed_url TEXT,
  psa_sent_at TIMESTAMPTZ,
  psa_signed_at TIMESTAMPTZ,
  psa_docusign_envelope_id TEXT,
  assignment_url TEXT,
  assignment_signed_url TEXT,
  assignment_sent_at TIMESTAMPTZ,
  assignment_signed_at TIMESTAMPTZ,
  -- Timeline
  contract_expiry_date DATE,
  inspection_end_date DATE,
  closing_date DATE,
  closed_at TIMESTAMPTZ,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Buyers
CREATE TABLE IF NOT EXISTS buyers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  company TEXT,
  buy_box_states TEXT[],
  buy_box_cities TEXT[],
  property_types TEXT[],
  min_beds INTEGER,
  max_price INTEGER,
  min_price INTEGER,
  max_repairs INTEGER,
  financing_type TEXT DEFAULT 'cash',
  is_vip BOOLEAN DEFAULT false,
  deals_closed INTEGER DEFAULT 0,
  relationship_stage TEXT DEFAULT 'cold',
  notes TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Title companies
CREATE TABLE IF NOT EXISTS title_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  fax TEXT,
  address TEXT,
  states TEXT[],
  notes TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follow-up sequences
CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  sequence_type TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  next_action_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email log
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  deal_id UUID REFERENCES deals(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  email_type TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent',
  error TEXT
);

-- TCPA audit log
CREATE TABLE IF NOT EXISTS tcpa_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  call_id UUID REFERENCES calls(id),
  phone_number TEXT NOT NULL,
  called_at_utc TIMESTAMPTZ NOT NULL,
  local_time TEXT,
  timezone TEXT,
  within_calling_hours BOOLEAN,
  dnc_checked_at TIMESTAMPTZ,
  dnc_result TEXT,
  attempt_number INTEGER,
  days_since_last_attempt INTEGER,
  consent_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- State compliance
CREATE TABLE IF NOT EXISTS state_compliance (
  state_code CHAR(2) PRIMARY KEY,
  state_name TEXT NOT NULL,
  risk_level TEXT DEFAULT 'low',
  license_required BOOLEAN DEFAULT false,
  disclosure_required BOOLEAN DEFAULT true,
  disclosure_language TEXT,
  assignment_legal BOOLEAN DEFAULT true,
  cancellation_period_days INTEGER DEFAULT 0,
  registration_required BOOLEAN DEFAULT false,
  marketing_restrictions TEXT,
  notes TEXT,
  last_updated DATE DEFAULT CURRENT_DATE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_vapi_id ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_deals_user_id ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_sequences_next_action ON sequences(next_action_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tcpa_log_user_id ON tcpa_log(user_id);
