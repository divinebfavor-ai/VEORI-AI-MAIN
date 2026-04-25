const express = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../services/dealActivityService');

const router = express.Router();
const BUCKET = process.env.PROPERTY_PHOTOS_BUCKET || 'veori-property-photos';

router.use(requireAuth);

async function ensureDealOwnership(req, dealId) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, lead_id, property_address')
    .eq('id', dealId)
    .eq('user_id', req.user.id)
    .single();
  if (error) throw error;
  return data;
}

router.post('/upload_property_photos', async (req, res, next) => {
  try {
    const { deal_id, photos = [] } = req.body;
    if (!deal_id || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, error: 'deal_id and at least one photo are required' });
    }

    const deal = await ensureDealOwnership(req, deal_id);
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const uploads = [];
    for (const photo of photos.slice(0, 12)) {
      if (!photo?.data_base64 || !photo?.content_type) continue;

      const ext = (photo.filename?.split('.').pop() || 'jpg').toLowerCase();
      const path = `${req.user.id}/${deal_id}/${Date.now()}-${uuidv4()}.${ext}`;
      const buffer = Buffer.from(photo.data_base64, 'base64');

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, {
          contentType: photo.content_type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      uploads.push({
        id: uuidv4(),
        user_id: req.user.id,
        deal_id,
        role: 'seller',
        storage_path: path,
        photo_url: path,
        caption: photo.caption || null,
        content_type: photo.content_type,
        created_at: new Date().toISOString(),
      });
    }

    if (uploads.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid photos uploaded' });
    }

    const { data, error } = await supabase
      .from('property_photos')
      .insert(uploads)
      .select();
    if (error) throw error;

    await logActivity({
      userId: req.user.id,
      dealId: deal_id,
      leadId: deal.lead_id,
      activityType: 'property_photos_uploaded',
      message: `${uploads.length} property photo${uploads.length === 1 ? '' : 's'} uploaded`,
      metadata: { count: uploads.length },
    });

    res.status(201).json({ success: true, photos: data || [] });
  } catch (err) { next(err); }
});

router.get('/get_property_photos_for_buyer/:dealId', async (req, res, next) => {
  try {
    const deal = await ensureDealOwnership(req, req.params.dealId);
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data, error } = await supabase
      .from('property_photos')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('deal_id', req.params.dealId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const photos = await Promise.all((data || []).map(async (photo) => {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(photo.storage_path || photo.photo_url, 60 * 60);
      return {
        ...photo,
        signed_url: signed?.signedUrl || null,
      };
    }));

    res.json({
      success: true,
      deal: {
        id: deal.id,
        property_address: deal.property_address,
      },
      photos,
    });
  } catch (err) { next(err); }
});

module.exports = router;
