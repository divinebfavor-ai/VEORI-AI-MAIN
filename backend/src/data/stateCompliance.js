const STATE_COMPLIANCE = {
  SC: { state_name: 'South Carolina', risk_level: 'high', license_required: true, disclosure_required: true, assignment_legal: false, notes: 'Effectively banned unlicensed wholesaling. Double-close strategy strongly recommended.', cancellation_period_days: 0, disclosure_language: 'IMPORTANT: Wholesaling real estate without a license may be prohibited in South Carolina. Consult a real estate attorney before proceeding.' },
  IL: { state_name: 'Illinois', risk_level: 'high', license_required: true, disclosure_required: true, assignment_legal: false, notes: 'License required for repeated assignments. High risk for unlicensed operators.', cancellation_period_days: 0, disclosure_language: 'Illinois law may require a real estate license for repeated assignment of contracts. Operator acknowledges this risk.' },
  OK: { state_name: 'Oklahoma', risk_level: 'medium', license_required: false, disclosure_required: true, assignment_legal: true, cancellation_period_days: 2, notes: 'Requires disclosure of intent to assign. Seller has 2-business-day right to cancel.', disclosure_language: 'OKLAHOMA DISCLOSURE: Buyer intends to assign or sell equitable interest in this contract to a third party. Seller has the right to cancel this agreement within two (2) business days of execution without penalty.' },
  MD: { state_name: 'Maryland', risk_level: 'medium', license_required: false, disclosure_required: true, assignment_legal: true, cancellation_period_days: 0, notes: 'Requires disclosure of intent to assign. Non-disclosure allows seller to cancel without penalty.', disclosure_language: 'MARYLAND DISCLOSURE: Buyer is a real estate investor who intends to assign or sell their equitable interest in this property. Seller acknowledges this disclosure.' },
  TN: { state_name: 'Tennessee', risk_level: 'medium', license_required: false, disclosure_required: true, assignment_legal: true, cancellation_period_days: 0, notes: 'Requires disclosing intent to assign and nature of interest.', disclosure_language: 'TENNESSEE DISCLOSURE: Buyer discloses the nature of their interest as equitable interest only, and their intent to assign this contract to a third-party purchaser.' },
  CT: { state_name: 'Connecticut', risk_level: 'high', license_required: true, disclosure_required: true, assignment_legal: false, registration_required: true, notes: 'HB 7287 effective July 1, 2026 — requires registration with Dept of Consumer Protection. Monitor closely.', cancellation_period_days: 0, disclosure_language: 'Connecticut requires registration with the Department of Consumer Protection for wholesale real estate transactions effective July 1, 2026.' },
  OR: { state_name: 'Oregon', risk_level: 'high', license_required: false, disclosure_required: true, assignment_legal: true, registration_required: true, notes: 'Requires registration with Oregon Real Estate Agency plus criminal background check.', cancellation_period_days: 0, disclosure_language: 'Oregon requires registration with the Oregon Real Estate Agency for wholesale transactions.' },
  ND: { state_name: 'North Dakota', risk_level: 'medium', license_required: false, disclosure_required: true, assignment_legal: true, notes: 'Expanded wholesale regulations cover all real estate transactions, not just residential.', cancellation_period_days: 0, disclosure_language: 'North Dakota disclosure requirements apply to this wholesale transaction.' },
  PA: { state_name: 'Pennsylvania', risk_level: 'medium', license_required: false, disclosure_required: true, assignment_legal: true, notes: 'Wholesale Real Estate Transaction Transparency and Protection Act (Jan 2025) requires specific disclosures.', cancellation_period_days: 0, disclosure_language: 'PENNSYLVANIA WHOLESALE DISCLOSURE (per WRETTA 2025): This is a wholesale real estate transaction. Buyer is purchasing equitable interest and may assign this contract. Seller has been advised to seek independent legal counsel.' },
  IN: { state_name: 'Indiana', risk_level: 'medium', license_required: false, disclosure_required: true, assignment_legal: true, notes: 'Requires written disclosure of role and intent to assign. Non-disclosure is deceptive act under consumer protection.', cancellation_period_days: 0, disclosure_language: 'INDIANA DISCLOSURE: Buyer is a real estate investor and discloses their intent to assign this contract to a third party. Non-disclosure would constitute a deceptive act under Indiana consumer protection law.' },
};

const UNIVERSAL_DISCLOSURE = `WHOLESALE TRANSACTION DISCLOSURE: Buyer is a real estate investor and may assign this contract to a third party buyer. Buyer is purchasing the equitable interest in this property and is not acting as a licensed real estate agent or broker. Seller has been advised to seek independent legal counsel before signing this agreement. Seller acknowledges understanding of this disclosure.`;

function getStateCompliance(stateCode) {
  const code = stateCode?.toUpperCase();
  return STATE_COMPLIANCE[code] || {
    state_name: stateCode,
    risk_level: 'low',
    license_required: false,
    disclosure_required: true,
    assignment_legal: true,
    cancellation_period_days: 0,
    disclosure_language: UNIVERSAL_DISCLOSURE,
  };
}

function getContractDisclosure(stateCode) {
  const compliance = getStateCompliance(stateCode);
  return compliance.disclosure_language || UNIVERSAL_DISCLOSURE;
}

module.exports = { STATE_COMPLIANCE, UNIVERSAL_DISCLOSURE, getStateCompliance, getContractDisclosure };
