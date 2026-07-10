# VEORI AI — Complete Build Log

> A full record of everything built and changed on the VEORI AI platform.
> Covers **2026-06-23 → 2026-07-06** (last two weeks) plus session work that
> lives outside git (DNS, email, deploy, and security operations).
>
> Last updated: **2026-07-06**. Nothing here is meant to be forgotten.

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

*End of build log. If you add work, append to §3-style session notes and the
§4 changelog so this file stays the single source of truth.*
