// ─────────────────────────────────────────────────────────────────────────────
// mmsCaptureService — Stage 3a: capture seller PHOTOS texted in via MMS.
//
// WHY: sellers very often text pictures of the property ("here's the roof, here's
// the kitchen"). The SMS webhook historically read only From/Body/To/MessageSid,
// so those images were silently dropped — they never landed on the lead's chart.
// Twilio posts MMS media as NumMedia + MediaUrl{N} + MediaContentType{N} form
// fields. This service pulls each image down, stores it in the SAME bucket and
// SAME `lead_photos` table the seller-upload-link flow uses (so the gallery is one
// unified place), tags it source='sms_mms', and — when the lead has a deal — drops
// a `media_received` row on deal_activity so the photo shows in the timeline.
//
// Additive + best-effort: any failure is swallowed and logged; it must NEVER block
// or break the SMS webhook (a photo that fails to save can't stop a reply being
// scored). A text-only SMS (NumMedia=0) is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const supabase = require('../config/supabase');

const BUCKET = 'lead-photos'; // same bucket photoUpload.js writes to

// Map a media content-type to a file extension for a tidy storage path.
function extFromContentType(ct = '') {
  const m = String(ct).toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png'))  return 'png';
  if (m.includes('gif'))  return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  return 'jpg';
}

// Twilio media URLs require account auth to fetch. Build the Basic-auth header
// from the same creds the rest of the SMS stack uses. If creds are absent we
// simply skip download (capture is best-effort, never fatal).
function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

/**
 * Capture any MMS media on an inbound webhook body and attach it to the lead.
 *
 * @param {object} args
 * @param {object} args.body   the raw req.body from the Twilio webhook
 * @param {object} args.lead   the matched lead row (must have id, user_id)
 * @returns {Promise<number>}  count of photos successfully stored (0 if none/err)
 */
async function captureInboundMMS({ body, lead }) {
  try {
    const numMedia = parseInt(body?.NumMedia, 10) || 0;
    if (numMedia <= 0 || !lead?.id) return 0;

    const authHeader = twilioAuthHeader();
    let stored = 0;

    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = body[`MediaUrl${i}`];
      const contentType = body[`MediaContentType${i}`] || 'image/jpeg';
      if (!mediaUrl) continue;
      // Only images — sellers occasionally send vCards/audio; we only want photos.
      if (!String(contentType).toLowerCase().startsWith('image/')) continue;

      try {
        const headers = authHeader ? { Authorization: authHeader } : {};
        const resp = await fetch(mediaUrl, { headers });
        if (!resp.ok) {
          console.warn(`[MMS] media ${i} fetch failed: ${resp.status}`);
          continue;
        }
        const arrayBuf = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const ext = extFromContentType(contentType);
        const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
        const path = `${lead.id}/${filename}`;

        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, buffer, { contentType, upsert: false });
        if (uploadErr) throw uploadErr;

        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

        await supabase.from('lead_photos').insert({
          lead_id:      lead.id,
          user_id:      lead.user_id || null,
          url:          publicUrl,
          storage_path: path,
          source:       'sms_mms',
          file_name:    filename,
        });

        stored++;
      } catch (e) {
        console.warn(`[MMS] media ${i} store failed:`, e.message);
      }
    }

    if (stored > 0) {
      // Flag photos on the lead (mirrors the seller-upload-link flow).
      await supabase
        .from('leads')
        .update({ has_photos: true, updated_at: new Date().toISOString() })
        .eq('id', lead.id)
        .then(() => {}, () => {}); // best-effort

      // If this lead has a deal, drop a timeline entry so the photos surface there too.
      try {
        const { data: deal } = await supabase
          .from('deals')
          .select('id')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (deal?.id && lead.user_id) {
          const { logActivity } = require('./dealActivityService');
          await logActivity({
            userId: lead.user_id,
            dealId: deal.id,
            leadId: lead.id,
            actorType: 'seller',
            activityType: 'media_received',
            message: `Seller texted ${stored} photo${stored !== 1 ? 's' : ''}`,
            metadata: { source: 'sms_mms', count: stored },
          });
        }
      } catch (e) {
        console.warn('[MMS] activity log failed (non-fatal):', e.message);
      }

      console.log(`[MMS] stored ${stored} seller photo(s) for lead ${lead.id}`);
    }

    return stored;
  } catch (err) {
    console.warn('[MMS] captureInboundMMS error (non-fatal):', err.message);
    return 0;
  }
}

module.exports = { captureInboundMMS };
