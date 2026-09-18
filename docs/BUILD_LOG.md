# VEORI AI — Complete Build Log

> A full record of everything built and changed on the VEORI AI platform.
> Covers **2026-06-23 → 2026-07-06** (last two weeks) plus session work that
> lives outside git (DNS, email, deploy, and security operations).
>
> Last updated: **2026-09-17**. Nothing here is meant to be forgotten.

---

## 1. What VEORI AI Is

VEORI AI is an autonomous real-estate **wholesaling acquisitions platform**.
It dials thousands of property sellers a month with an AI voice agent,
qualifies them in real conversations, scores their motivation, sends contracts
for e-signature, and coordinates title — around the clock, without the operator
on the phone. The tagline in the product: *"Speed wins the deal. Yours answers
in 60 seconds."*

Pricing shown on the landing page: from **$1,499/month**, no setup fees, cancel
anytime — positioned as replacing a **$2,000+/month tool stack**.

---

## 2. Architecture & Infrastructure

| Layer | Technology | Hosting |
|---|---|---|
| **Frontend** | React + Vite (JSX, Zustand stores, React Router, TanStack Query) | **Vercel** (project `veori-ai-main`, org `veori-ai`) |
| **Backend** | Node.js + Express (~142 files) | **Railway** (runs in UTC) |
| **Database** | Supabase (Postgres + Storage + RLS) | Supabase cloud |
| **Queue** | BullMQ over Redis (with Redis-independent fallbacks) | Railway |
| **Voice** | Twilio Media Streams ↔ Deepgram STT ↔ Claude ↔ ElevenLabs TTS | in-house streaming |
| **Telephony/SMS** | Twilio (voice, toll-free SMS, number provisioning) | Twilio |
| **Email** | Resend (transactional/cold email, SPF/DKIM/DMARC) | Resend + Namecheap DNS |
| **Payments** | Flutterwave billing | — |
| **Repo** | GitHub `divinebfavor-ai/VEORI-AI-MAIN` (branch `main`) | GitHub |

### Domains & DNS (registrar: Namecheap, `veori.net`)
- **Apex `@`** → A record `216.198.79.1` (Vercel). *(Fixes older `76.76.21.21` that some home ISPs refused.)*
- **`www`** → CNAME `cname.vercel-dns.com.` — this is where the **live app** is served (`www.veori.net` / `veori.net`).
- **`app.veori.net`** → **does not exist** (no DNS record). The marketing copy references it, but the real app is on `www`/apex. Worth fixing or creating the record if that URL is meant to be used.
- **Email sending (Resend), must never be broken:**
  - TXT `resend._domainkey` → DKIM public key
  - TXT `send` → `v=spf1 include:amazonses.com ~all`
  - MX `send` → `feedback-smtp.us-east-1.amazonses.com` (priority 10)
- **DMARC:** TXT `_dmarc` → `v=DMARC1; p=none; rua=mailto:divinebfavor@gmail.com`
- **Inbound forwarding (Namecheap free email forwarding):**
  - MX `@` → `eforward1.registrar-servers.com` (10), `eforward2.registrar-servers.com` (15)
  - Forwarders: `divine@`, `support@`, `outreach@`, and catch-all → all forward to `divinebfavor@gmail.com`

### Deploy flow
- Push to `main` → **Vercel** auto-builds the frontend **and Railway** redeploys the backend.
- Frontend build: `vite build` (from `frontend/`). Backend: Node on Railway.
- After a frontend change goes live, **hard-refresh** (Cmd+Shift+R) to clear cached JS.

---

## 3. This Session's Work (2026-07-06)

### 3.1 Notification system — four sequential fixes
The in-app notification bell (`frontend/src/components/Layout/CommandRail.jsx`)
was broken end-to-end. Fixed in four traced steps:

1. **`c7f0f65` — items made clickable.** Notification rows were plain `<div>`s
   with no click handler. Wired each row to navigate to its `link` (or
   `/deals/:id` when `deal_id` set), mark read (optimistic + API), close the
   dropdown, and keep the bell badge in sync. Added pointer cursor, hover
   highlight, Enter/Space keyboard support.
2. **`b32fdfa` — clicks always navigate.** `destFor` returned `null` when a
   notification had no `link` and no `deal_id`, so those clicks were dead
   (several backend types — `market_hotspot`, `outreach_credits`, link-less
   title warnings — are created without a link). Added a **type→route map**
   with a `/dashboard` catch-all so a click is never a no-op.
3. **`87bb113` — panel was invisible (the real "it won't open" bug).** The
   dropdown used `position:absolute; left:100%` inside `.glass-sidebar`, which
   has `overflow:hidden` — so the panel rendered *past the sidebar's right edge*
   and was **clipped away entirely**. Re-rendered it via a **React portal into
   `document.body`** with `position:fixed`, anchored to the bell's rect (opens
   up-and-right, re-placed on resize/scroll). Click-outside handler now ignores
   the bell so toggling closed works.
4. **`5a12b05` — operators can clear notifications.** There was no way to remove
   a notification and **no backend delete route existed** (only mark-read).
   Added:
   - Backend `DELETE /api/notifications/:id` and `DELETE /api/notifications/clear-all`
     (operator-scoped; `clear-all` declared before `:id` so it isn't captured as an id).
   - API service: `notifications.remove(id)` and `notifications.clearAll()`.
   - UI: per-row **✕** button (stops row navigation) + **"Clear all"** in the
     header; both update the bell count optimistically.

**Notification types and where each now routes:**
`hot_lead`→`/hot-leads`, `daily_briefing`→`/dashboard`, `market_hotspot`→`/heatmap`,
`outreach_credits`→`/marketplace`, `title_warning`→`/title-companies` (or the deal),
`appointment`→`/appointments`, `missed_call`→`/missed-calls`, `follow_up`→`/follow-ups`,
`new_lead`→`/leads`, `contract`/`offer`→`/pipeline`, anything else→`/dashboard`.

### 3.2 Light-mode text fix (`95589da`)
On light-OS devices the app showed black-on-dark invisible text. Scoped the
light-theme catch-all and input overrides to `[data-app-layout]` so Landing/
Login/Register keep their dark design, and declared `color-scheme` per theme so
browsers render native controls correctly.

### 3.3 Email & DNS setup (Namecheap — not in git)
- Created official addresses on `veori.net` (`divine@`, `support@`, `outreach@`
  + catch-all) all forwarding to `divinebfavor@gmail.com`.
- Executed the Namecheap **"switch-trick"**: temporarily set Mail Settings to
  Email Forwarding to add the forwarders, then switched back to **Custom MX** and
  re-added all MX records so the Resend `send` MX survived (Email Forwarding mode
  strips subdomain MX; Custom MX blocks the forwarder UI — they're mutually
  exclusive, hence the dance).
- Added **DMARC**; verified apex A already fixed to `216.198.79.1`.
- Verified every record live on the authoritative nameserver via `dig`.
- **Test result:** cold-sent to the three aliases; they bounced with
  `554 Relay access denied` — Namecheap forwarder propagation (up to 60 min) had
  not completed at test time. **Open item:** re-test; if still bouncing, move
  forwarding to **ImprovMX** (works alongside Custom MX, leaves Resend untouched).
- **Operator's manual follow-ups (credentials — cannot be done for the user):**
  Gmail "Send mail as" via `smtp.resend.com:587`, username `resend`, password =
  Resend API key; connect Gmail to Apollo (Settings → Mailboxes → link via Google
  OAuth) and add `outreach@veori.net` as the sending alias. Recommendation: use a
  **sibling domain** for scaled cold outreach so bounces/complaints never hurt
  `veori.net` deliverability (which carries transactional email).

### 3.4 Security — GitHub token
The git remote had a **personal access token embedded in the URL**. Stripped it
out (`git remote set-url origin https://github.com/divinebfavor-ai/VEORI-AI-MAIN.git`);
confirmed a credential helper (`gh auth git-credential`) handles auth so pushes
still work. **Open item:** the exposed token should be **revoked/regenerated** at
github.com/settings/tokens — it remains valid on GitHub until then.

---

## 4. Two-Week Feature Changelog (newest → oldest)

Grouped by theme. Every commit in the window (84 total) is accounted for.

### 4.1 UI / Theme
- `5a12b05` clear notifications (per-row ✕ + Clear all)
- `87bb113` notification panel un-clipped via portal
- `b32fdfa` notification clicks always navigate (type fallback)
- `c7f0f65` notification dropdown items clickable
- `95589da` stop black text on light-mode devices (scope light theme to app shell)
- `46d5bab` Settings: import missing Smartphone icon — Security tab no longer crashes

### 4.2 Voice / Live Call Realism & Engine
- `38723a4` background office ambience on live calls + live-sound previews + female voice v2 tuning
- `de9666a` human realism on live calls + stop `not_home` mislabel
- `150ab95` **Master Operator doctrine + closed-loop learning + cross-call memory** (see §5)
- `91962a1` fix: silent calls, missing outcomes, stale pipeline, no ringback (4 bugs) (see §5)
- `c7d3d57` absolute Vapi kill-switch — no Railway env can route a call to Vapi
- `e4a79f9` hard kill-switch so a stale `VOICE_ENGINE=vapi` can't bill the Vapi wallet
- `862ad2e` **cut Vapi from call path** — in-house streaming recording/transcript/listen/takeover
- `a03c6d0` Vapi-free local Twilio purchase + dialable-only rotation
- `e5d8313` document Matt-#1 voice rank swap as migration
- `e924337` longer, realistic cold-call preview sample
- `d1a8922` per-voice tuning — calmer Vexa, conversational Steven
- `af435cd` human pacing + wider emotional range for live TTS
- `1264a49` render wholesale playbook offer lines + add stop-think-talk directive
- `112d49b` smart ear + stop-think-talk — hang up on dead calls, converse don't recite
- `19ebad1` per-line emotion — brain cues + dynamic TTS delivery
- `7727ef1` rank voices by human-ness + warmer TTS tuning
- `5ff52ef` preview uploads to real `voice-previews` bucket (not missing `call-tts`)
- `531b86d` on-demand voice preview using the live-call TTS profile
- `979bf52` name-preserving voice sync (backfill previews only)
- `a27671c` seed 7 cloned voices — add Angel
- `9dace29` natural human TTS tuning + seed operator's cloned voices
- `997f0e2` point Settings voice picker at ElevenLabs (what you preview = what the call speaks)
- `4bf7539` **real-time streaming pipeline** (Twilio↔Deepgram↔Claude↔ElevenLabs), flag-gated `VOICE_ENGINE=stream`
- `c2cf687` energy-matching mirror layer + natural pace default for AI caller
- `1127837` veteran read + negotiation chess on the live call brain

### 4.3 Calls / Campaign / Dialer
- `bfbc69d` evaluate calling hours in **lead local time**, not server UTC
- `57ae160` rehydrate active campaigns on boot + sanitize corrupt `REDIS_URL`
- `3d69a25` surface Twilio error code on dial failure (e.g. 21215/21606/21210)
- `846dcc1` Redis-independent safety-net sweep for due AI callbacks
- `368ecf7` honor seller's requested callback/appointment time + repair scheduled-call executor
- `2947e08` Start Campaign auto-buys geo-matched numbers before dialing
- `d67c1cf` surface Redis (BullMQ) status on `/health`

### 4.4 Phone Numbers / Provisioning
- `a8d7483` surface real auto-buy failure instead of false "at capacity"
- `44b9eba` manual auto-scale trigger for geo-matched calling capacity
- `8a66879` auto-scale geo-matched local calling numbers on lead import

### 4.5 SMS / Toll-Free
- `bdcc816` send Twilio `OptInImageUrls` so toll-free verification stops failing
- `348156a` Settings Business Identity form for auto toll-free verification
- `12dd40b` tight+warm A/B openers with wrong-number tail
- `6866c24` auto-submit toll-free verification on buy + pending poller
- `9be23b4` in-app toll-free SMS verification submit + Twilio PN SID capture
- `1bd172b` per-number daily cap + verified-toll-free capacity readout + blast pre-flight estimator
- `411ec9b` restrict SMS sender pool to verified toll-free only
- `41ae269` in-app toll-free SMS verification UI in Settings → Phone
- `a4ec4f1` toll-free carrier SMS verification gate + status endpoints
- `86f8472` custom SMS template management UI + blast template picker
- `436155a` custom operator SMS templates + AI generator + wholesale-RE moderation guardrail
- `51e94e5` operator-selectable 1x/2x/3x blast cadence for non-responders
- `7402788` local-presence area-code on hot-reply call + reply auto-stop cancels pending follow-ups

### 4.6 AI Brain / Strategy / Learning / Prediction
- `741803e` operator track-record adaptation — AI calls the way THIS operator's best calls go
- `b9fd53b` deal-state awareness across voice + SMS — resumes pipeline instead of re-pitching agreed sellers
- `4f690e1` feed same-state win rate into Alex's live call prompt
- `195255e` close the loop — record deal terminal outcomes for prediction learning
- `1e53683` surface AI Deal Prediction on the lead profile
- `9c76a96` unified AI Deal Prediction Engine over existing scorers
- `ddd41e1` novation + auto-pick ranking + manual override + deeper per-strategy scripts/offer math
- `99bce87` multi-strategy detection, scripts, offer + calculator (additive)

### 4.7 COO Command Center
- `d59adff` surface portfolio learning summary on COO dashboard
- `7413ddd` COO Command Center dashboard — render the 4 operator answers
- `199f44a` AI COO command center — fuse engines into the 4 operator answers
- `88c73be` COO: load real data (correct auth token) + restyle to app theme

### 4.8 Email (Cold + Transactional)
- `1de3b22` full Svix HMAC verification on Resend webhook
- `cdc85c1` analytics query filters on `sent_at`, not missing `created_at`
- `b59a9b0` daily send caps + warmup ramp + from-rotation + analytics dashboard
- `c015ecf` per-recipient spintax + A/B subject rotation + reply auto-stop drip
- `cb3cd96` Resend webhook engagement tracking + bounce/complaint auto-suppress + blast suppression fix
- `f4dee36` cold email drip + CAN-SPAM unsubscribe/suppression

### 4.9 Leads / Dedup / Imagery / DFD
- `4fffc54` auto-dedup on single add + normalized-phone dedup on import
- `77f43d6` find + merge duplicate leads into one canonical record
- `e75d2df` aerial + street-view property imagery on lead intelligence
- `1b69d6e` Driving-for-Dollars: route interactive map page + nav + auth-token fix

### 4.10 Voicemail
- `a033990` DNC + TCPA gates on RVM drops + voicemail sequence action

### 4.11 Contracts
- `8d780d4` strategy-aware contracts + real operator data + downloadable PDF

### 4.12 Platform / Security / Data-Integrity / Scale
- `1911441` **5-pipeline scale audit** — intake, dispo, closing, follow-ups, hot-path indexes
- `32793f0` replace em-dashes with plain hyphens across codebase
- `95585a6` **builder `.catch()` TypeError** silently breaking 51 write paths (see §5)
- `de9bea6` verify Twilio signature on all voice webhooks (security)
- `adb0e31` hardening — close every audit gap (compliance, PII, buyer vetting, autonomy)
- `c0f3e29` env-tunable AI concurrency + lead/buyer pagination + phone caps

---

## 5. Deep-Dive: The Highest-Impact Fixes

### `95585a6` — the `.catch()` TypeError (51 broken write paths)
supabase-js 2.103.3 query builders are **thenables with no `.catch()` method** —
calling `.catch()` throws a synchronous `TypeError`. This silently broke 51 write
paths, including: the 24h auto-sourcing **lead engine** (never completed a run),
outreach-credits gate, TCPA opt-out/opt-in compliance logging, federal-DNC log,
usage tracking, deals, the Vapi webhook, skip trace, SMS blast/inbound, direct
mail, missed calls, follow-ups, privacy export log, Flutterwave history, and DFD
scans. Fix: `.catch(fn)` → `.then(null, fn)` (identical on real Promises, works on
thenable builders) via a statement-scoped codemod. Clean on all 142 backend files.

### `91962a1` — four call bugs, each traced to root cause
1. **Silent calls:** `mediaStreamServer.speak()` logged "no audio" and kept
   listening on ElevenLabs failure → permanent dead air. Now downgrades to the
   turn-based `/twiml` engine (Twilio `<Say>` fallback) if a call was never
   audible. Also created the missing Supabase `call-recordings` bucket.
2. **Outcomes not logging:** `/status` webhook keyed on `vapi_call_id` (Twilio SID),
   but Twilio fires events before the SID is written → 0 rows matched. Now the dial
   passes our `calls.id` in the statusCallback URL and keys on it.
3. **Pipeline not updating:** in-house call path never touched the leads table
   post-call (only Vapi did) → leads stuck at `calling`. Now `scoreTwilioCall` +
   `/status` write lead status/pipeline_stage. Plus Pipeline.jsx got a 15s
   auto-refresh (paused while a modal is open).
4. **No ringback:** dialer showed "Ringing…" with no sound. Added `useRingback`
   hook synthesizing the US 440+480Hz 2s-on/4s-off tone via Web Audio.

### `150ab95` — Master Operator doctrine + learning + memory
1. **Master Operator doctrine** (`masterOperatorService.js`): non-negotiable
   guardrails (never fabricate/manipulate, FACT/ESTIMATE labeling, fair-treatment),
   state-aware compliance (TCPA/FHA/RESPA/FCRA + wholesaling statutes), valuation
   discipline (comps, repair bands, MAO/NOI/DSCR/BRRRR math), counterparty +
   vulnerable-person protocol. `fullDoctrine()` for the assistant;
   `liveCallDoctrine()` compact layer inside the voice prompt.
2. **Closed-loop learning** (`learningLoopService.js` + `ai_lessons`/
   `ai_predictions`): every scored call feeds CAPTURE; a nightly DISTILL pass has
   Claude study each operator's VERIFIED outcomes and produce evidence-backed
   lessons, which APPLY into the next call's prompt via a TTL cache. Refuses
   lessons not backed by multiple verified calls. Doctrine always outranks lessons.
3. **Cross-call memory** (`buildPriorContactBlock` + `loadCallContext`): the brain
   now knows every prior conversation with a lead and picks up where it left off.
   Also fixed a starvation bug where `loadCallContext` loaded too few fields, so
   veteran-read/tag-intelligence/strategy/offer-math layers ran empty.

### The Vapi decommission (multi-commit)
Vapi was fully cut from the call path in favor of the in-house streaming engine
(`862ad2e`), with progressively harder kill-switches (`e4a79f9`, `c7d3d57`) so no
stale Railway env var could ever route a call back to Vapi's wallet, and number
provisioning/rotation was made Vapi-independent (`a03c6d0`). Vapi remains only as
an explicit, intentionally-unset break-glass rollback.

---

## 6. System Inventory

### Backend services (`backend/src/services/`)
Voice/calls: `mediaStreamServer`, `twilioCallStreamService`, `twilioCallService`,
`deepgramStreamService`, `elevenLabsService`, `ambienceService`, `voiceBrainService`,
`vapiService` (legacy rollback), `voicemailService`.
Brain/learning: `masterOperatorService`, `learningLoopService`, `aiLearningService`,
`aiService`, `dualAIService`, `predictionEngine`, `dealIntelligence`, `negotiationPlaybook`,
`operatorMode`, `marketIntelligenceService`, `cooService`.
Leads/dedup/scoring: `leadEngine`, `leadEngineScorer`, `leadTaggingService`,
`buyerScoreService`, `buyerDispoService`, `sellerTrustScore` (route), `skipTraceService`,
`propertyImageryService`, `compsService`, `repairEstimator`, `dataMotService`.
SMS/comms: `smsService`, `customSmsService`, `smsBlastProcessor`, `smsInboundProcessor`,
`smsFirstWorkflow`, `smsRotation`, `sequenceEngine`, `followUpProcessor`, `missedCallService`,
`mmsCaptureService`.
Email: `emailService`, `emailSendGuard`, `emailFromRotation`, `emailReplyStop`,
`emailSpintax`, `emailSubjectAB`, `emailSuppression`.
Numbers/telephony: `numberProvisioning`, `phoneRotation`, `poolService`, `queueService`.
Compliance/security: `tcpaWindow`, `ftcDncService`, `fraudGuard`, `auditLog`,
`contactMasking`, `fieldCrypto`, `titleWarningsService`.
Deals/close/finance: `contractService`, `closeRitualService`, `dealActivityService`,
`assignmentFeeService`, `titleService`, `creativeFinanceCalc`, `outreachCredits`,
`wealthService`, `directMailService`, `analyticsRollup`.

### Backend routes (`backend/src/routes/`)
`auth`, `leads`, `leadEngine`, `campaigns`, `calls`, `v2voice`, `v2voices`, `vapi`,
`sms`, `smsFirst`, `smsTemplates`, `sequences`, `deals`, `dealPackage`,
`dealPrediction`, `dealProbability`, `contracts`, `buyers`, `pipeline` (via leads),
`analytics`, `callAnalytics`, `callerReputation`, `compliance`, `coo`, `dailyBriefing`,
`hotEscalation`, `notifications`, `appointments`, `missedCalls`, `followUps`, `heatmap`,
`smartList`, `titleCompanies`, `phones`, `directMail`, `drivingForDollars`,
`propertyMarketing`, `propertyPhotos`, `photoUpload`, `publicTour`, `virtualTours`,
`publishPipeline`, `postQueue`, `contentEngine`, `socialConnections`, `listings`,
`academy`, `wealth`, `referrals`, `billing`, `flutterwaveBilling`, `funding`,
`operatorProfile`, `privacy`, `emailOptOut`, `conversations`, `conversationMemory`,
`sentimentTimeline`, `sellerTrustScore`, `profitCalc`, `rehabEstimator`, `aria`,
`feedback`, `admin`, `waitlist`.

### Frontend pages (`frontend/src/pages/`)
Dashboard, Leads, LeadEngine, LeadPipeline, Pipeline, Campaigns, LiveMonitor,
Dialer, Buyers, TitleCompanies, FollowUps, Analytics, CallAnalyticsDashboard,
Calculator, ProfitCalculator, RehabEstimator, Compliance, Academy, WealthPlaybook,
WealthStrategy, WealthCalculatorPage, Marketplace, Aria, VirtualDFD,
DrivingForDollars, DirectMailDashboard, Listings, PropertyMarketing,
PropertyPhotoUpload, ContentStudio, SocialDashboard, VirtualTourStudio, TourViewer,
HeatMap, HotLeads, WeeklyFocus, DailyBriefing, COOCommandCenter, SmartList, Inbox,
Appointments, MissedCalls, LeadIntelligence, DealWorkspace, DealPhotoGallery,
ContractSigning, CallerReputation, SmsTemplates, Sequences, Settings, Referrals,
Billing/BillingVerify, Admin, Login/Register/ForgotPassword/ResetPassword/OAuthCallback,
LandingPage, Privacy, Terms, RefundPolicy.

### Migrations (repo root + `backend/migrations/`)
`SUPABASE_MIGRATION.sql`, `SUPABASE_RLS.sql`, `schema.sql`, `NEW_FEATURES_MIGRATION.sql`,
`PHOTO_UPLOAD_MIGRATION.sql`, `2FA_AUDIT_MIGRATION.sql`, `LANDING_VISITORS_MIGRATION.sql`,
`WEALTH_TABLES.sql`, `backend/migrations/2026-04-26_phase5_to_9.sql` (notifications table).

---

## 7. How We Work (Method & Conventions)

- **Root-cause over guessing.** Every fix traces the actual failure (webhook
  key mismatch, thenable-vs-Promise, overflow clipping, server-UTC vs lead-local
  time) before editing. Commit messages document the root cause and blast radius.
- **Additive & flag-gated.** Risky changes (voice engine, pacing, ambience) ship
  behind env flags with byte-identical "off" behavior and an explicit rollback path.
- **Verify before claiming done.** `node --check` on backend files, `vite build`
  on the frontend, live `dig` for DNS, and preview/console checks where the change
  is observable. If something can't be verified (e.g. domain blocked from the
  browser tool, or a login-gated screen), that's stated plainly.
- **Commit style:** Conventional Commits (`feat`/`fix`/`chore`/`style`/`perf` with
  a scope), a body explaining *why* and the blast radius, and a
  `Co-Authored-By: Claude ...` trailer. Push to `main` → Vercel + Railway deploy.
- **Security posture:** never enter the operator's credentials (Resend key, OAuth)
  — those steps are handed back to the operator with exact instructions.
- **Communication:** the operator communicates via voice transcription (often
  garbled); intent is inferred and confirmed, and outcomes are reported honestly
  including failures and partials.

---

## 8. Open Items / Follow-Ups

1. **Revoke the exposed GitHub token** at github.com/settings/tokens (still valid
   until revoked; already removed from the local git remote).
2. **Re-test email forwarding** for `divine@`/`support@`/`outreach@` once Namecheap
   propagation completes. If still bouncing `554 Relay access denied`, migrate
   forwarding to **ImprovMX** (leaves Resend `send` MX untouched).
3. **Operator-side email wiring:** Gmail "Send mail as" via `smtp.resend.com:587`
   (user: `resend`, pass: Resend API key); connect Gmail→Apollo; add
   `outreach@veori.net` as sending alias. Consider a **sibling domain** for
   cold-outreach volume to protect `veori.net` deliverability.
4. **`app.veori.net`** has no DNS record — either create it (CNAME to Vercel) or
   stop referencing it in marketing copy.
5. **Verify the notification fixes live** after the current Vercel + Railway
   deploys finish (hard-refresh, open bell, click + clear).
6. Backlog noted earlier: Vapi-free local Twilio number purchase + dialable-only
   rotation refinements (`numberProvisioning.js`, `phoneRotation.js`,
   `campaignManager.js`) — largely landed via `a03c6d0`; confirm nothing remains.

---

## Security — Open Follow-ups (REMINDER, do not lose)

> Context: backend uses the Supabase **service role key**, which **bypasses RLS**.
> Tenant isolation therefore depends **entirely** on app-layer `user_id` checks.

**Done (shipped `3763fef`, 2026-07-10):** cross-tenant IDOR ownership guards on
7 handlers — `conversations` GET `/:deal_id`; `virtualTours` GET
`/:id/analytics`; `dealProbability` GET `/:leadId` + POST `/:leadId/calculate`;
`smsFirst` GET `/:id/leads`; `sentimentTimeline` POST `/` + `/auto-tag`;
`conversationMemory` POST `/` + `/auto-extract`; `rehabEstimator` POST
`/estimate/:leadId/save`. Pattern: fetch parent `user_id`, return **404** on
mismatch. Rollback: `git revert 3763fef`.

**Still to do (not yet audited):**
1. **Sweep the remaining ~50 route files** for more cross-tenant IDORs — only the
   agent-flagged set was verified. This is the highest-priority remaining item.
2. **Auth hardening:** JWT 7-day expiry with no refresh; CORS `*` escape hatch
   (`ALLOWED_ORIGINS=*`); no per-email forgot-password throttle.
3. **Flutterwave defense-in-depth:** re-verify each webhook via
   `/transactions/:id/verify` (MEDIUM — signature already verified + idempotent,
   not an open hole).
4. **Background jobs/queues:** confirm BullMQ job idempotency.
5. **DB:** index review, backup + restore drill.
6. **Observability/alerting** and **5k→50k load posture**.

---

## Session 2026-09-16 — CRM spec audit, Phase 1 (compliance gates + code splitting)

**Audit (20-feature CRM spec):** verified against live code and DB. Missing today:
Dropbox Sign integration (built-in signing page only), mid-call sentiment, outbound
webhooks, public REST API/keys, team/RBAC, white label, CRM connectors. Partial:
agent, PMI escalation/nurture, predictions, kanban (two unsynced stage systems),
timeline, follow-up, contracts (never delivered), buyer matching, import, list
pulling, compliance, dashboard, market intel, mobile layout, onboarding. Twilio
production account still inactive (401 / 20003) — no call or SMS can send.

**Shipped:**
1. **Import texts gated on consent.** `POST /api/leads/bulk` used to text every
   imported lead with only a DNC check. Now it sends only when the operator ticks
   the consent attestation (`sms_consent: true`), which is stored on each lead
   (`consent`, `consent_source='operator_attestation_csv_import'`, `consent_at`).
   `sendOpeningSMS` checks consent, then `agents/complianceGate` (quiet hours,
   internal DNC, federal DNC); quiet-hours-only blocks are queued to the next 8 AM
   local via `enqueueSMS`. Every outcome writes `tcpa_log`. Import also reloads the
   exact inserted ids (was "newest N leads") and reports DB failures as `failed`
   instead of counting them as duplicates.
2. **Spoken opt-outs recorded.** `voiceBrainService` hung up on "stop calling me"
   but never saved it. New `services/dncRecorder.js` writes `dnc_records`, sets
   `leads.is_on_dnc`, and logs `tcpa_log`. "not interested"/"hang up" still end the
   call without suppression.
3. **Route code splitting.** All pages load via `React.lazy` (`utils/lazyWithRetry`
   reloads once on a stale chunk after deploy). Main script 2.2 MB → 513 KB.
4. Tests: `src/__tests__/outreachCompliance.test.js` (7 cases).

**Not done / next:** A2P gating of the shared sender, federal DNC key
(`FTC_DNC_API_KEY`), 1 MB JSON limit vs 10,000-row imports, stage-chain automation,
contract delivery, buyer matching fixes.

---

## Session 2026-09-16 (cont.) — Deal stage automation + AI action log

1. **One stage path.** New `services/dealStageService.js` (`changeDealStage`). Before:
   the UI saved labels ('under contract') via PUT that triggered nothing; the
   automation lived in `PATCH /deals/:id/stage`, which no screen called; contract
   signing wrote `under_contract` directly. Now PUT (status), PATCH /stage and
   fully signed PSA contracts all go through the service. Stage keys:
   `lead, contacted, offer_sent, negotiating, under_contract, sent_to_title,
   closing_prep, closed, lost` (frontend `constants/dealStages.js`, test keeps them in sync).
   The write is conditional (`status <> stage`), so a re-save or two simultaneous
   requests can't start buyer outreach twice. under_contract → buyer texts + title
   package; closed → playbook + close ritual; closed/lost → outcome learning.
   Signed *assignment* contracts don't restart buyer outreach. Production had 0 deals,
   so no data migration.
2. **Buyer fallback wording.** When no buy box matches, outreach texts all active
   buyers (existing behaviour); those texts no longer claim "Fits your buy box".
3. **ai_command_log never recorded anything.** All 12 writers used columns that don't
   exist (`message_sent`, `outcome`, `operator_id`, `contact_id`, `contact_name`); table
   had 0 rows. New `services/aiCommandLog.js` writes the real columns; readers alias
   `summary`/`status` so API shapes are unchanged. Hand-added leads' opening text is
   logged as `drafted` (nothing sends it). Qualification auto-escalation created deals
   with status `new`; now `lead`.
4. Pipeline "Add Deal" button called `toast.info` (not in react-hot-toast) and threw.
5. Tests: `src/__tests__/dealStage.test.js` (8 cases). 32/32 pass.

---

## Session 2026-09-17 — Full build-out: delivery, automation, compliance, API, teams, security, integrations

Verified with unit tests (`JWT_SECRET=test npm test`, 99 passing), production end-to-end
scripts against temporary `@example.com` accounts (all deleted afterwards), and
Railway HTTP logs for server-side latency.

### Features
1. **Contract delivery** (`8f2020c`) — each signer gets their own link by email (counterparty also SMS through the compliance gate); refuses to re-issue a partly signed contract.
2. **Post-call pipeline** (`02b42bf`) — `services/postCallPipeline.js` runs once per call (claimed via `calls.post_call_processed_at`): deal stage, sequence, memory, callback/appointment, missed-call text, stats.
3. **Buyer matching** (`16824c1`) — city / zip / min price / tire-kicker filters, one offer per buyer per deal (`buyer_deal_offers`), a buyer's YES tied to a deal they were offered; ambiguous replies ask which address.
4. **Follow-ups** (`49c56d4`) — nurture day 3/7/14/30/60/90, text only with consent, calls wait for calling hours, stops on reply/STOP/DNC.
5. **Import + DNC** (`dbd7226`) — E.164 phones (DB trigger), 1,000-row batches, fail-closed internal DNC check.
6. **Compliance** (`d7ecaac`) — operator texts need a registered sender unless `ALLOW_SHARED_SENDER_OUTREACH=true`; opt-outs revoked not deleted (history kept); plain-language STOP; recording objection ends the call.
7. **Mobile** (`cc501af`) and honest "recording no longer available" for dead Vapi links (`774d130`).
8. **Public REST API** (`c0418da`) — `/api/v1`, scoped `vk_live_` keys, HMAC-signed webhooks with retries and SSRF protection, docs at `/developers`.
9. **Dropbox Sign** (`b390127`) — active when `DROPBOX_SIGN_API_KEY` is set; callback `https://veori.net/api/esign/dropbox-sign/callback`.
10. **Live sentiment** (`c5a8c10`), **teams** with admin/member/viewer (`fce7215`), **white label** with verified custom domains (`0061b67`).
11. **Probate / divorce / vendor list import** (`d93aebf`) — list type in the import dialog; rows tagged; phoneless rows kept for skip tracing. Removed `services/sources/courtRecords.js` (unused; its CourtAPI host doesn't resolve, Florida endpoint 404). No direct probate data provider was built: none with a verifiable API schema was found.
12. **CRM sync** (`d2e5f24`) — Settings → Integrations. HubSpot (private app token) and Follow Up Boss (API key; needs `FUB_SYSTEM_NAME` + `FUB_SYSTEM_KEY`). Keys encrypted with `PII_ENCRYPTION_KEY`; queue with retries in `crm_sync_jobs`.
13. **Onboarding** (`b8770d7`, `d38f6d8`) — dashboard checklist computed from real data (company, leads, calling number, buyer, first call; texting registration optional), 8 minutes of required steps.

### Security
14. **Private call recordings** (`0beec8b`) — bucket private; `GET /api/calls/:id/recording` returns a 1-hour signed link after an ownership check.
15. **Per-endpoint rate limits** (`e4d6b0f`) — `middleware/rateLimits.js`, counted in Redis across instances; Twilio-signed callbacks skip the anonymous limit.
16. **Cross-workspace fixes** (`0ddb04f`) — `/api/conversations/schedule-call` could queue a dial to any lead id (worker dialled from the lead owner's account); email blasts could load other workspaces' buyers; unmetered `/api/vapi/aria` retired.
17. **Real visitor IP** (`ff901f9`) — anonymous limits (incl. login brute-force) were keyed on proxy IPs, shared by everyone. `utils/clientIp.js`, trust proxy 2. Residual: a caller hitting the Railway domain directly can forge `x-vercel-*` headers.
18. **Least-privilege DB** (`ff901f9`) — `anon`/`authenticated` have no table, sequence or function access (they could execute SECURITY DEFINER `increment_user_counter`). All 118 public tables have RLS on; backend uses service role only.
19. **4xx for bad input** (`a0167c6`) — Postgres input errors map to 400/404/409.

### Performance + data fixes (`8dc55e0`)
20. Dashboard stats in one call (`dashboard_stats()`), onboarding in one (`onboarding_flags()`). Server-side (Railway upstream): dashboard 492ms p50 / 1.3s p95 → 112ms / 159ms; onboarding 194/327 → 113/143ms; leads list 95/130ms. Checked identical on all 4 accounts.
21. `sms_messages` has no `created_at`: "SMS replies today" always showed 0, and the nightly rollup threw so `operator_daily_stats` was empty. Fixed; backfilled 140 days (658 calls reconcile).
22. `scripts/loadtest.js` — dependency-free load tester. Baseline only (≤25 concurrent). **10,000 concurrent was not run against production.**

### Owner actions (not doable in code)
- Twilio production account is inactive — reactivate.
- Set on Railway: `PII_ENCRYPTION_KEY` (CRM connections refuse without it), `DROPBOX_SIGN_API_KEY` (+ callback URL in Dropbox Sign), `FTC_DNC_API_KEY`, `BATCH_SKIP_TRACE_API_KEY`, `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` (custom domains), `FUB_SYSTEM_NAME` + `FUB_SYSTEM_KEY` (register at apps.followupboss.com/system-registration).
- A2P 10DLC registration for texting.
- Decide on AI voice calls to cold leads without prior consent (TCPA exposure).
- Load test at 10k concurrency on a staging copy, not production.

## Session 2026-09-17 (cont.) — Veori Super-Agent intelligence system (phases 1-5)

Extends the platform; nothing replaced. Code: `backend/src/intelligence/`, routes `routes/intelligence.js` (`/api/intelligence`), UI `pages/DealRoom.jsx` (`/deals/:id/room`), `pages/Opportunities.jsx`.

### Commits
`ec0c973` foundation + core agents · `ff62807` Deal Room · `60fffc2` engines · `c792bf2` 42-agent network · `f0cb368` worksheets UI · `2b7e2a1` flip uses rehab scope · `a063ee0` phase 5 autonomous systems · `9ca425f` phase 5 UI + fixes · `075e3a5` scorecard fix.

### What exists
1. **Spine** — seven evidence labels (VERIFIED, USER-PROVIDED, CALCULATED, ESTIMATED, INFERRED, UNVERIFIED, UNKNOWN) on every fact (`provenance.js`); deterministic calculation engine (`calc/`), never model math; append-only `audit_events` (trigger blocks update/delete); prompt-injection screening (`sanitize.js`); agent spine v1.1.
2. **Registry** — 46 intelligence agents + 8 original agents + Autopilot = 55 declarations, mirrored to `agent_registry` on boot. Each declares permissions (READ…HIGH_RISK), risk level, tools, knowledge sources, handoffs.
3. **Super-Agent** (`superAgent.js`) — routes a request to one of 29 intents, runs agents in dependency waves (risk → deal_rescue → challenger last), surfaces disagreements, merges missing information, computes Best Next Action, streams progress (SSE).
4. **Permissions** — offers, contracts, money, legal filings and material term changes always create an approval request; texts/calls/drafts follow Copilot/Autopilot settings (`agent_settings`).
5. **Engines** — scenarios, optimizer, scorecard (11 independent dimensions, no composite), timeline delay cost, Deal Understanding graph (`dealGraph.js`) with operator worksheets.
6. **Phase 5 (autonomous)** — tables `deal_alerts`, `autopilot_runs`; `deals.last_monitored_at`, `last_autopilot_at` (migration `2026-09-17_intelligence_monitoring_autopilot.sql`).
   - Deal Death Prevention: deterministic post-contract rules (no closing date, closing passed, title not opened, no buyer ≤7 days, EMD, unsigned contract, diligence issues). Sweep every 5 min (`DEAL_MONITOR=off` disables), deals claimed per 30-min interval, alert opened once per key, resolved when cleared, critical/high → notification. Dismissed warnings stay quiet until the condition clears.
   - Deal Rescue: cause, impact, options, next action, deadline, responsible party.
   - Opportunity Discovery: leads without a deal with 2+ signals (equity ≥50%, probate, pre-foreclosure, tax delinquent, vacant+absentee, 20+ years owned); evidence labeled UNVERIFIED.
   - Market Intelligence: zip snapshots into `market_data`, change vs prior snapshot. Needs an active RentCast subscription.
   - Autopilot: requires Autopilot mode; recorded steps (permissions, contract monitoring, understand/verify, analysis, challenger, rescue, approvals, seller follow-up, best next action). Seller text only with auto-text on + consent + phone + not DNC + compliance gate + no text exchanged in 72h; otherwise kept as a draft with the reason. Background sweep only with `AUTOPILOT_SWEEP_ENABLED=true` (off).

### Fixes found while verifying
- **Security:** `POST /api/deals` read the linked lead without a workspace filter, copying another workspace's seller name/phone/email into the caller's deal. Now 404 unless owned.
- Scorecard returned 500 on any deal where buyer matching had run, and silently showed several dimensions as not assessed (wrong unwrap of stored outputs).
- Wholesale agent requested offer approval on deals already under contract.
- CORS rejections returned 500 (now 403).
- Live-call polling: 3-5 independent 1.5s pollers per open tab → one shared poller, paused in hidden tabs.

### Verified on production
Unit tests 168/168. Prod e2e: intelligence 27/27, phase 3 7/7, phase 4 9/9, phase 5 16/16 (incl. background sweep checking an untouched deal on its own), fixes 6/6. UI checked in the browser against prod API (alerts re-check/dismiss, Autopilot switch + run, Opportunities → open deal, 375px width no horizontal scroll). All temp users cleaned up.

### Not built / owner decisions
- Data connectors beyond RentCast (BatchData, PropStream, MLS/IDX, Regrid, Reonomy, Trepp) are listed as not connected; no scraping.
- RentCast subscription is inactive → valuation/market data report "unavailable".
- No verified legal knowledge is seeded; the law agent says it cannot confirm and flags attorney review.
- Approving an approval request records the decision; it does not itself send an offer or sign.
- `AGENTS_ENABLED` (original 8 agents) remains off; `AUTOPILOT_SWEEP_ENABLED` off.
- Existing `marketIntelligenceService.js` aggregates motivation across all workspaces' leads per state (cross-tenant aggregate) — not changed; decide whether that is acceptable.

## Session 2026-09-17 (cont.) — Security audit, scale work, light mode, Portfolio

Asked for: attack the platform and fix what is found, make it hold 2,000-10,000
operators, use it like a real operator, fix light mode, and build what is missing
for running a whole business on it.

### How it was tested
- **Local attack harness** (`xtenant.js` in the scratchpad): every one of the 514
  mounted routes called as workspace B using workspace A's ids, against a recording
  fake database, with outbound network blocked. Flags reads, writes and inserts that
  touch another workspace's rows.
- **Unauthenticated sweep**: all 514 routes called with no token; ~50 answer, all of
  them intentionally public (login, webhooks, plans, signed links).
- **Live attack** on production with two temp accounts: 24 checks, all refused.
- **Operator journey** on production: register → log in → profile → leads → campaign
  → buyer → deal → Deal Room analysis → contract → stage moves → monitoring → buyer
  matching → autopilot → exports → sign out everywhere → account deletion. 27/27.
- **Load test**: 70 seeded workspaces (10 with 1,000 leads each), ramped 20 → 60 →
  120 concurrent operators through a realistic screen mix.

### Security fixes (commits `b648ed6`, `25e5f9f`)
1. **Campaign control without ownership** — `campaigns/:id/pause|stop`, `calls/campaign/pause|stop`
   and SMS-First `stop`/`status` acted on any campaign id. Anyone could stop another
   operator's live calling campaign.
2. **Foreign records linked into a deal** — `POST /api/deals`, `POST /api/deals/create`
   and `PUT /api/deals/:id` accepted another workspace's `lead_id`, `buyer_id` or
   `title_company_id`; the stage automation then read and acted on those records.
   `dealStageService` also read the lead unscoped.
3. Same class fixed on follow-up `contact_id`, funding `partner_id`, post queue
   lead/listing, DFD session, call analytics call/lead, virtual tour lead/listing and
   listing inquiry `buyer_id`. New `utils/ownership.js` centralises the check.
4. **Academy progress** readable for any user id; **landing-page visitor analytics**
   (country, city, referrer of every visitor) readable by any signed-in operator — now admin only.
5. **Payments**: a Flutterwave transaction without `meta.user_id` was accepted;
   subscription and top-up transactions could be claimed on the wrong route; ids went
   into the provider URL unencoded.
6. **Sessions**: a password reset left existing tokens working. `users.session_epoch`
   is now carried in every token and checked on each request; reset and the new
   `POST /api/auth/logout-all` retire every issued token.
7. **Uploads**: the photo endpoint trusted the browser's Content-Type, so an SVG (script)
   could land in a public bucket. Files are identified by their bytes, and the public
   buckets now have type and size limits.
8. `/calls/:id/listen` trusted a client-supplied provider call id; CORS rejections
   returned 500 instead of 403; a signing session with a missing contract returned 500.

### Account deletion was impossible (commit `677b25c`)
`audit_events` is append-only, but its user foreign key cascaded on delete: deleting
an account tried to delete its audit rows, the trigger refused, and the whole delete
failed. No account could be removed, including an erasure request. The key is dropped;
the audit trail outlives the account.

### Scale (commits `43cb127`, `cb64f0d`)
- **Idle tabs were most of the traffic**: several polls per second per open tab, running
  whether or not the tab was visible. New `usePolling` runs only while visible and
  refreshes on return; live-call polling drops from 1.5s to 10s when no call is running.
  Applied to dashboard, both pipelines, campaigns, inbox, monitor, lead engine, rail
  and status bar.
- **Indexes** for the shapes that dominated database time, from `pg_stat_statements`:
  the lead-engine dedupe (`user_id` + address `ILIKE '%...%'`) was ~17% of all execution
  time with only 2,373 leads — now a `pg_trgm` index; plus lead/call lists, pipeline,
  SMS history and follow-up sweeps.
- **Load test result**: 120 concurrent operators, 87.6 req/s, p50 474ms (mostly network
  round-trip from the test machine), p95 709ms, no rate-limit rejections.
- **The 502s are the CDN, not the app.** Same authenticated load through `veori.net`
  gave 34 × 502 and a 30s hang; straight to Railway, 1,200/1,200 succeeded with a 2.3s
  worst case. Reads now retry twice on a transient edge failure. The durable fix is an
  API subdomain (owner action below).

### Light mode (commit `677b25c`)
Measured contrast against the real rendered background on every main screen: the
dashboard had 102 unreadable text nodes, now 0. Shell and cards are soft off-whites
instead of white-on-white, muted text darkened, brand green/gold/amber/red given darker
text variants for light backgrounds. The floating **Feedback** button and its dialog
were hardcoded dark (the black pill), as was the assistant chat panel and five pages —
all now themed. A blue (`#4C9EFF`) that is not in the platform palette was replaced
with platform gold across six pages and the chart palette. Dark mode is unchanged.

### Portfolio — new (commits `2b4aaf7`, `e7d454a`)
Leads and deals covered buying; nothing covered what the operator owns afterwards.
Adds properties, units, leases and an income/expense ledger, with equity, NOI, cap
rate, DSCR, monthly cash flow, cash-on-cash and occupancy computed through the same
deterministic engine the Deal Room uses. Mortgage, capex and rehab are excluded from
operating expenses so NOI stays honest; a figure that cannot be computed is null with
the reason and how to fill it; yearly figures scale by the months actually recorded
(one month of rent is not multiplied into a year) and the card says so. A closed deal
can be brought across with its numbers in one click. `/portfolio`, 19/19 on production
including cross-workspace isolation.

### Owner actions
- **API subdomain**: point `api.veori.net` at the Railway service and set Vercel's
  `VITE_API_URL` to it. This removes the CDN hop that produced the 502s under load.
- Set `PUBLIC_BASE_URL` on Railway so Twilio signatures verify against a fixed host
  rather than the (spoofable) Host header.
- Still unset: `PII_ENCRYPTION_KEY`, `FTC_DNC_API_KEY`, `RESEND_WEBHOOK_SECRET` /
  `EMAIL_INBOUND_SECRET` (inbound email replies and delivery events are not processed),
  `FUB_SYSTEM_NAME` / `FUB_SYSTEM_KEY`, `ADMIN_EMAILS` (defaults to the owner address).
- RentCast and Twilio remain inactive.
- Scaling out to more than one instance needs sticky routing for live calls: campaign
  sessions and voice media streams are held in memory per instance. Scaling up (a
  bigger instance) is safe today. The database sweeps already claim rows, so they are
  safe with several instances.

## Session 2026-09-18 — Books: money, tax and vendors

### Books (commit `3f5f0cf`)
The portfolio ledger became a business ledger: an entry can sit against a property,
against a deal, or against neither (overhead such as marketing or software), so
nothing an operator spends lives outside the books.

- **Profit and loss** for any period, by category and by scope (properties / deals /
  overhead). Debt payments and capital improvements are reported separately - neither
  is an operating expense.
- **Schedule E summary** per property per tax year, mapping recorded categories to the
  real form lines (advertising 5, cleaning and maintenance 7, insurance 9, legal 10,
  management 11, repairs 14, supplies 15, taxes 16, utilities 17, other 19).
- **1099 tracking**: what each vendor was paid in the year, who crosses the $600
  threshold, who still owes a W-9. Corporations can be marked exempt. **Tax ids are
  refused by the API, never stored** - only whether a W-9 is held.
- **CSV exports** for the ledger, the Schedule E summary and the 1099 list.
- **Reconciliation**: a fee collected on a closed deal that never reached the books is
  flagged, so a year's income is not quietly short.

Two figures are deliberately not computed and say so on screen: **mortgage interest**
(a recorded payment mixes principal and interest; Schedule E line 12 wants interest
only) and **depreciation** (needs basis, in-service date and method). New tables:
`vendors`; `portfolio_transactions` gained `deal_id`, `vendor_id`, `paid_method` and
`property_id` became nullable. `/books`, 17/17 on production including isolation.

### Fixes found while verifying (commits `5022aa9`, `38554b5`)
- **`GET /api/operator/preferences` returned 500 for every account on every page load**:
  it selected `users.notification_preferences`, a column that was never created. Column
  added, writes validated as a small object, verified 200 on production.
- Buttons mixed the CSS `border` shorthand with a `borderColor` hover, which React warns
  about and which can drop the border; the shared Button and the assistant prompt buttons
  now use longhand. The Books page loads with zero console errors or warnings.

### Portfolio follow-up (commit `e7d454a`)
A single month of entries inside a 12-month window was annualised by 12, inventing
eleven months that never happened (a new property showed a negative yearly cash flow).
Figures now scale by the months actually recorded, and the card says how many.

---

*End of build log. If you add work, append to §3-style session notes and the
§4 changelog so this file stays the single source of truth.*
