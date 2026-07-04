/**
 * Feature 25 - Deal Package PDF Auto-Generator
 * Routes: POST /api/deal-package/generate/:listingId,
 *         GET /api/deal-package/:listingId
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// POST /api/deal-package/generate/:listingId - generate PDF deal package
router.post('/generate/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;

    const { data: listing, error: listErr } = await supabase
      .from('listings')
      .select('*, leads(*)')
      .eq('id', listingId)
      .eq('user_id', req.user.id)
      .single();

    if (listErr || !listing) return res.status(404).json({ success: false, error: 'Listing not found' });

    const { data: operator } = await supabase
      .from('operator_profiles')
      .select('full_name, company_name, email, phone')
      .eq('user_id', req.user.id)
      .single();

    const { data: calc } = await supabase
      .from('profit_calculations')
      .select('*')
      .eq('lead_id', listing.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Build PDF using pdfkit
    const PDFDocument = require('pdfkit');
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      const base64Pdf = pdfBuffer.toString('base64');

      // Store PDF record in DB (base64 or upload to storage)
      const sections = {
        property_overview: {
          address: listing.address,
          city:    listing.city,
          state:   listing.state,
          zip:     listing.zip,
          beds:    listing.bedrooms,
          baths:   listing.bathrooms,
          sqft:    listing.sqft,
          year:    listing.year_built,
          type:    listing.property_type,
        },
        financials: {
          asking_price: listing.asking_price,
          arv:          listing.arv,
          repair_cost:  listing.repair_cost,
          equity:       listing.equity,
          mao:          calc?.mao,
          net_profit:   calc?.net_profit,
          roi_pct:      calc?.roi_pct,
        },
        contact: {
          name:    operator?.full_name || operator?.company_name || 'VEORI Operator',
          email:   operator?.email,
          phone:   operator?.phone,
        },
      };

      const { data: pkg, error: pkgErr } = await supabase
        .from('deal_packages')
        .upsert({
          user_id:    req.user.id,
          listing_id: listingId,
          lead_id:    listing.lead_id || null,
          sections,
          generated_at: new Date().toISOString(),
        }, { onConflict: 'listing_id' })
        .select().single();

      if (pkgErr) {
        return res.status(500).json({ success: false, error: 'Failed to save deal package' });
      }

      // Return PDF as base64 data URL
      res.json({
        success: true,
        package: pkg,
        pdf_base64: `data:application/pdf;base64,${base64Pdf}`,
        filename: `deal-package-${listing.address?.replace(/\s+/g, '-') || listingId}.pdf`,
      });
    });

    // ─── Build PDF content ────────────────────────────────────────────────────
    const GREEN = '#00C37A';
    const GOLD  = '#C9A84C';
    const DARK  = '#0A1526';

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill(DARK);
    doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold')
      .text('DEAL PACKAGE', 50, 25, { align: 'left' });
    doc.fillColor(GREEN).fontSize(12).font('Helvetica')
      .text('Prepared by VEORI AI', 50, 55, { align: 'left' });

    doc.fillColor(DARK);

    // Property title
    doc.moveDown(2);
    doc.fillColor(DARK).fontSize(18).font('Helvetica-Bold')
      .text(listing.title || 'Investment Property Opportunity', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#666').fontSize(12).font('Helvetica')
      .text(`${listing.address || ''}, ${listing.city || ''}, ${listing.state || ''} ${listing.zip || ''}`, { align: 'center' });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(GREEN);
    doc.moveDown(1);

    // Property Details section
    doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text('PROPERTY DETAILS');
    doc.moveDown(0.5);
    const details = [
      ['Type',      listing.property_type || 'N/A'],
      ['Bedrooms',  listing.bedrooms || 'N/A'],
      ['Bathrooms', listing.bathrooms || 'N/A'],
      ['Sq. Footage', listing.sqft ? listing.sqft.toLocaleString() + ' sqft' : 'N/A'],
      ['Year Built', listing.year_built || 'N/A'],
    ];
    for (const [label, value] of details) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#333').text(`${label}: `, { continued: true });
      doc.font('Helvetica').fillColor('#555').text(String(value));
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#EEE');
    doc.moveDown(1);

    // Financials
    doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text('DEAL FINANCIALS');
    doc.moveDown(0.5);
    const financials = [
      ['Asking Price',       listing.asking_price ? `$${Number(listing.asking_price).toLocaleString()}` : 'N/A'],
      ['After Repair Value (ARV)', listing.arv ? `$${Number(listing.arv).toLocaleString()}` : 'N/A'],
      ['Estimated Repairs',  listing.repair_cost ? `$${Number(listing.repair_cost).toLocaleString()}` : 'N/A'],
      ['Built-in Equity',    listing.equity ? `$${Number(listing.equity).toLocaleString()}` : 'N/A'],
      ['Buyer Net Profit (est.)', calc?.net_profit ? `$${Number(calc.net_profit).toLocaleString()}` : 'N/A'],
      ['Est. ROI',           calc?.roi_pct ? `${calc.roi_pct}%` : 'N/A'],
    ];
    for (const [label, value] of financials) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#333').text(`${label}: `, { continued: true });
      doc.font('Helvetica').fillColor(GREEN).text(String(value));
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#EEE');
    doc.moveDown(1);

    // Highlights
    if (listing.highlights?.length > 0) {
      doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text('PROPERTY HIGHLIGHTS');
      doc.moveDown(0.5);
      for (const h of listing.highlights) {
        doc.fontSize(11).font('Helvetica').fillColor('#333').text(`• ${h}`);
      }
      doc.moveDown(1);
    }

    // Description
    if (listing.description) {
      doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text('DESCRIPTION');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').fillColor('#555').text(listing.description);
      doc.moveDown(1);
    }

    // Contact
    doc.rect(50, doc.y, doc.page.width - 100, 60).fill('#F5F5F5');
    doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
      .text('CONTACT', 60, doc.y - 50);
    const contactY = doc.y - 30;
    const contact = operator?.full_name || operator?.company_name || 'VEORI Operator';
    doc.fontSize(11).font('Helvetica').fillColor('#333')
      .text(`${contact}   |   ${operator?.email || ''}   |   ${operator?.phone || ''}`, 60, contactY);

    // Footer
    doc.moveDown(3);
    doc.fillColor('#999').fontSize(9).font('Helvetica')
      .text(`Generated by VEORI AI • ${new Date().toLocaleDateString()} • Confidential Investment Package`, { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[DealPackage] generate error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate deal package' });
  }
});

// GET /api/deal-package/:listingId - retrieve saved package metadata
router.get('/:listingId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deal_packages')
      .select('*')
      .eq('listing_id', req.params.listingId)
      .eq('user_id', req.user.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ success: true, package: data || null });
  } catch (err) {
    console.error('[DealPackage] get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load deal package' });
  }
});

module.exports = router;
