# VEORI AI — Autonomous Real Estate Acquisitions Platform

> The world's first fully autonomous real estate acquisitions platform. AI handles everything — calling sellers, making offers, running comps, closing contracts, finding buyers. Built to Achieve.

---

## Stack

| Layer | Tech | Deploy |
|-------|------|--------|
| Backend | Node.js + Express | Railway |
| Database | Supabase (PostgreSQL) | Supabase |
| Frontend | React + Vite + Tailwind | Vercel |
| Voice AI | Vapi.ai (concurrent calls) | Vapi |
| AI Brain | Anthropic Claude Haiku 4.5 | API |
| Voice | ElevenLabs | API |
| Telephony | Twilio | API |

---

## Quick Start

### 1. Database Setup
Run `backend/schema.sql` in your Supabase SQL Editor.

### 2. Backend (Railway)
```bash
cd backend
cp .env.example .env
# Fill in your env vars
npm install
npm run dev
```

Set these in Railway dashboard:
- `SUPABASE_URL` = https://mmlfmknklsxzasaybbrp.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `ANTHROPIC_API_KEY`
- `VAPI_API_KEY`
- `VAPI_PHONE_NUMBER_ID`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `ELEVENLABS_API_KEY`
- `ALLOWED_ORIGINS` = your Vercel URL

### 3. Frontend (Vercel)
```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL to your Railway backend URL
npm install
npm run dev
```

Set in Vercel dashboard:
- `VITE_API_URL` = https://your-backend.railway.app

---

## Architecture

```
VEORI AI
├── backend/              # Express API
│   ├── src/
│   │   ├── index.js      # Entry point
│   │   ├── config/       # Supabase client
│   │   ├── middleware/   # Auth (JWT) + Error handling
│   │   ├── routes/       # All API routes
│   │   └── services/     # Vapi, AI, PhoneRotation, Campaign engine
│   └── schema.sql        # Complete DB schema
└── frontend/             # React app
    └── src/
        ├── pages/        # All page components
        ├── components/   # Reusable UI components
        ├── services/     # API client
        ├── store/        # Zustand auth store
        └── hooks/        # Custom hooks
```

---

## Key Features

- **Concurrent AI Calling** — Up to 5 simultaneous Vapi sessions
- **Live Monitor** — Watch calls in real-time, see transcripts word by word
- **Operator Takeover** — Mute AI, speak directly to seller, get coaching
- **Smart Phone Rotation** — Geographic matching, health scoring, spam prevention
- **Motivation Scoring** — Claude Haiku analyzes every call, 0-100 score
- **Auto Offer Calc** — MAO = ARV × 0.70 − repairs, with negotiation buffer
- **Pipeline CRM** — Kanban board from New → Closed
- **Buyer Module** — Isolated buyer campaigns per property
- **Contract Gen** — Auto-fill PSA and Assignment Agreement
- **Aria Chatbot** — Free public real estate advisor (acquisition funnel)
- **Operator Assistant** — AI advisor with full business context

---

## Vapi Webhook

Set your Vapi webhook URL to:
```
https://your-backend.railway.app/api/vapi/webhook
```

Events handled: `call-started`, `transcript`, `transcript-update`, `call-ended`, `status-update`

---

## Phone Number Rules (TCPA + Spam Prevention)

1. Max 50 calls/number/day
2. 90-second cooldown between calls on same number
3. Geographic matching (local area codes)
4. Health scoring (0-100, auto-rest below 40)
5. 200+ calls/week = 24h rest
6. Never call before 9am / after 8pm local time
7. Never call Sunday before noon
8. Max 3 attempts/lead/week

---

Built to Achieve. 🚀
