// ─── Branding (white label) ──────────────────────────────────────────────────
// Signed in: read/update the workspace brand (writes: owner or team admin, see
// teamService access rules). Public: brand for a verified custom domain, so the
// login page on app.theircompany.com shows their name and logo.
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const brand = require('../services/brandingService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e instanceof brand.BrandError) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}

router.get('/public', wrap(async (req, res) => {
  const ownerId = await brand.ownerForDomain(req.query.domain);
  if (!ownerId) return res.json({ success: true, data: null });
  res.json({ success: true, data: await brand.getPublicBrand(ownerId) });
}));

router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  res.json({ success: true, data: await brand.getBrand(req.user.id) });
}));

router.put('/', wrap(async (req, res) => {
  res.json({ success: true, data: await brand.updateBrand(req.user.id, req.body || {}) });
}));

router.post('/logo', (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Logo must be 1 MB or smaller' : 'Upload failed';
      return res.status(400).json({ success: false, error: msg });
    }
    wrap(async () => {
      res.json({ success: true, data: await brand.uploadLogo(req.user.id, req.file?.buffer) });
    })(req, res, next);
  });
});

router.delete('/logo', wrap(async (req, res) => {
  res.json({ success: true, data: await brand.removeLogo(req.user.id) });
}));

router.put('/domain', wrap(async (req, res) => {
  res.json({ success: true, data: await brand.setDomain(req.user.id, req.body?.domain) });
}));

router.post('/domain/verify', wrap(async (req, res) => {
  const { brand: data, vercel } = await brand.verifyDomain(req.user.id);
  res.json({ success: true, data, vercel });
}));

module.exports = router;
