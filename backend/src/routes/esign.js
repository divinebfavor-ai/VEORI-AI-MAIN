// ─── E-signature provider callbacks ──────────────────────────────────────────
// POST /api/esign/dropbox-sign/callback - set as the account callback URL in
// Dropbox Sign. Dropbox Sign posts multipart/form-data with a `json` field and
// requires the exact body "Hello API Event Received" in the response.
const express = require('express');
const multer = require('multer');
const dropbox = require('../services/dropboxSignService');
const contractService = require('../services/contractService');

const router = express.Router();
const ACK = 'Hello API Event Received';
const parseForm = multer({ limits: { fieldSize: 2 * 1024 * 1024, files: 0 } }).none();

router.post('/dropbox-sign/callback', (req, res) => {
  parseForm(req, res, async (formErr) => {
    if (formErr) return res.status(400).type('text/plain').send('bad request');
    let payload;
    try {
      payload = JSON.parse(req.body?.json || '{}');
    } catch {
      return res.status(400).type('text/plain').send('bad json');
    }
    if (!dropbox.isEnabled()) return res.status(503).type('text/plain').send('Dropbox Sign is not configured');
    if (!dropbox.verifyEvent(payload)) {
      console.warn('[ESign] Dropbox Sign callback with an invalid event_hash - ignored');
      return res.status(401).type('text/plain').send('invalid signature');
    }

    const eventType = payload.event?.event_type;
    const sr = payload.signature_request;
    try {
      if (sr?.signature_request_id && ['signature_request_signed', 'signature_request_all_signed'].includes(eventType)) {
        const result = await contractService.applyProviderEvent({
          requestId: sr.signature_request_id, eventType, signatures: sr.signatures || [],
        });
        if (!result.handled) console.warn(`[ESign] ${eventType} for unknown request ${sr.signature_request_id}`);
      } else if (eventType === 'signature_request_declined' && sr?.signature_request_id) {
        console.warn(`[ESign] signature request ${sr.signature_request_id} was declined`);
      }
    } catch (e) {
      // Dropbox Sign retries a callback that does not get the ACK, so a transient
      // failure here is recovered by their retry.
      console.error('[ESign] applying Dropbox Sign event failed:', e.message);
      return res.status(500).type('text/plain').send('error');
    }
    res.status(200).type('text/plain').send(ACK);
  });
});

module.exports = router;
