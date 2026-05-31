/**
 * Seller Photo Upload
 *
 * Public routes — no auth needed (sellers use a one-time token link)
 *
 *   GET  /api/photo-upload/:token        — get property info for the upload page
 *   POST /api/photo-upload/:token        — receive photos from seller
 */

const express = require('express');
const multer  = require('multer');
const crypto  = require('crypto');
const supabase = require('../config/supabase');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, // 25 MB per file, 20 files max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

const BUCKET = 'lead-photos';

// ─── Validate token helper ─────────────────────────────────────────────────
async function validateToken(token) {
  const { data, error } = await supabase
    .from('photo_upload_tokens')
    .select('id, lead_id, user_id, expires_at, used_count')
    .eq('token', token)
    .single();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

// ─── GET /api/photo-upload/:token ─────────────────────────────────────────────
// Returns property info so the upload page can show the address/seller name
router.get('/:token', async (req, res) => {
  try {
    const tokenRecord = await validateToken(req.params.token);
    if (!tokenRecord) {
      return res.status(410).json({ success: false, error: 'This link has expired or is invalid.' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, first_name, last_name, property_address, property_city, property_state')
      .eq('id', tokenRecord.lead_id)
      .single();

    if (!lead) return res.status(404).json({ success: false, error: 'Property not found.' });

    // Count existing photos
    const { count } = await supabase
      .from('lead_photos')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', lead.id);

    res.json({
      success: true,
      property: {
        address:    lead.property_address,
        city:       lead.property_city,
        state:      lead.property_state,
        seller:     `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || null,
        photo_count: count || 0,
      },
    });
  } catch (err) {
    console.error('[PhotoUpload] GET error:', err.message);
    res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// ─── POST /api/photo-upload/:token ────────────────────────────────────────────
// Receives photos from seller, uploads to Supabase Storage
router.post('/:token', upload.array('photos', 20), async (req, res) => {
  try {
    const tokenRecord = await validateToken(req.params.token);
    if (!tokenRecord) {
      return res.status(410).json({ success: false, error: 'This link has expired or is invalid.' });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'No photos received. Please select at least one photo.' });
    }

    const uploaded = [];
    const failed   = [];

    for (const file of files) {
      try {
        const ext      = file.originalname.split('.').pop() || 'jpg';
        const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
        const path     = `${tokenRecord.lead_id}/${filename}`;

        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file.buffer, {
            contentType: file.mimetype,
            upsert:      false,
          });

        if (uploadErr) throw uploadErr;

        const { data: { publicUrl } } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(path);

        // Save to lead_photos table
        const { data: photo } = await supabase.from('lead_photos').insert({
          lead_id:      tokenRecord.lead_id,
          user_id:      tokenRecord.user_id,
          url:          publicUrl,
          storage_path: path,
          source:       'seller_upload',
          file_name:    file.originalname,
        }).select().single();

        uploaded.push({ url: publicUrl, id: photo?.id });
      } catch (e) {
        console.error('[PhotoUpload] File upload failed:', e.message);
        failed.push(file.originalname);
      }
    }

    // Increment used_count on token
    await supabase
      .from('photo_upload_tokens')
      .update({ used_count: (tokenRecord.used_count || 0) + uploaded.length })
      .eq('id', tokenRecord.id);

    // Update lead to flag photos received
    await supabase
      .from('leads')
      .update({ has_photos: true, updated_at: new Date().toISOString() })
      .eq('id', tokenRecord.lead_id);

    console.log(`[PhotoUpload] ${uploaded.length} photos uploaded for lead ${tokenRecord.lead_id}`);

    res.json({
      success:  true,
      uploaded: uploaded.length,
      failed:   failed.length,
      message:  `${uploaded.length} photo${uploaded.length !== 1 ? 's' : ''} received. Thank you!`,
    });
  } catch (err) {
    console.error('[PhotoUpload] POST error:', err.message);
    res.status(500).json({ success: false, error: 'Upload failed. Please try again.' });
  }
});

module.exports = router;
