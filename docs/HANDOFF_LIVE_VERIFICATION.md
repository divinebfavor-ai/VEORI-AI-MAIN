# Live verification checklist (pre-handoff)

These items are wired and logic-tested, but only a real run against live Twilio / a real
phone proves them end-to-end. Run each in the **Railway** environment (that's where the
Twilio / AI credentials live) using a test phone number you control.

## Env vars to set first (Railway → backend service)

| Var | Value | Enables |
|-----|-------|---------|
| `PUBLIC_BASE` | your backend's public URL, e.g. `https://api.veori.net` | SMS delivery-status callback (item 1) |
| `CONTRACT_AUTO_AFTER_CALL` | `true` | auto-PSA after a qualifying call (item 7) |
| `VOICE_ENGINE` | `stream` (should already be set) | in-house call engine (items 5, 6) |
| `SMS_BLAST_DAY_OFFSETS` | leave unset for real `1,3,7`; set `0.001,0.002,0.003` to test the cadence in minutes | fast cadence test (item 1) |

Delivery status needs no Twilio console change — the callback URL is attached per message.

---

## Item 1 — SMS blast (Day 1/3/7) + delivery status
1. Start an SMS-First campaign with a 1–2 number test list, touches = 3.
2. Confirm the Day-1 send, then check the outbound row moves past `sent`:
   ```sql
   SELECT status, to_number, telnyx_message_id, created_at
   FROM sms_messages WHERE direction='outbound' ORDER BY created_at DESC LIMIT 5;
   ```
   **PASS:** `status` becomes `delivered` (or `failed`/`undelivered` with a real reason) within ~1 min.
3. Cadence: with `SMS_BLAST_DAY_OFFSETS=0.001,0.002,0.003`, confirm touches 2 and 3 fire on the
   2-then-4 gap. **PASS:** three sends spaced correctly. Unset the var to restore real Day 1/3/7.

## Item 2 — Inbound SMS → AI engine
1. From the test phone, reply to the blast (e.g. "yeah what's this about").
2. Check the decision log:
   ```sql
   SELECT action, needs_human_review, pmi_score, reasoning, created_at
   FROM sms_decisions ORDER BY created_at DESC LIMIT 5;
   ```
   **PASS:** a row appears with an `action` (continue_sms / escalate_call / close_out), a
   `reasoning`, and a `pmi_score`; the test phone receives the AI's reply (or a call on escalate).

## Item 5 — Outbound AI call places + connects
1. Trigger a call to your test phone (dial from the Dialer, or reply hot so the judge escalates).
2. **PASS:** the phone rings and connects; a `calls` row exists and progresses
   (`queued → ringing → answered → completed`), and you can converse.

## Item 6 — Mandatory AI disclosure (LISTEN, do not assume)
On that same call, listen to the **first sentence**. It must say, verbatim in substance:
> "Hi {name}, this is {AI name}, an AI assistant with {company}. Quick heads up, this call may be recorded…"

**PASS:** you hear the AI disclosure in the opening line, on every call, with no operator toggle.

## Item 7 — Contract + e-sign after a qualifying call
1. Ensure `CONTRACT_AUTO_AFTER_CALL=true`.
2. On a test call, clearly agree to sell (so the AI records `verbal_yes`).
3. Check:
   ```sql
   SELECT d.status AS deal_status, c.signing_status, c.signing_url, c.created_at
   FROM deals d LEFT JOIN contracts c ON c.deal_id = d.id
   ORDER BY d.created_at DESC LIMIT 3;
   ```
   **PASS:** deal is `under_contract` and a `contracts` row has `signing_status='sent'` with a
   `signing_url`. Backend log shows `[Vapi] Auto-generated PSA for deal …`.

---

## Already verified this cycle (no live run needed)
- Item 3 (PMI reads full conversation), 4 (judgment escalation, 4 scenarios), 8 (subaccount —
  live-verified `AC99353…`), 9 (A2P approve + reject paths), 10 (split billing, two separate
  charges), 11 (pricing page), 12 (custom calculator). See the audit report / test harnesses.
