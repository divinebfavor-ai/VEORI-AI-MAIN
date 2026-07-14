import { Link } from 'react-router-dom'

// Swap this for your actual partner/affiliate link. Veori does NOT file LLCs in-house -
// this refers customers to a third-party formation service.
const LLC_PARTNER_URL  = 'https://www.zenbusiness.com/'
const IRS_EIN_URL      = 'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online'

const A2P_DOCS = [
  'Legal business name (exactly as registered)',
  'EIN (Employer Identification Number)',
  'Business address (street, city, state, ZIP)',
  'Business website URL',
  'Authorized representative: name, email, phone, and job title',
  'How your contacts opt in, plus a sample text message',
]

function Step({ n, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-[15px]"
        style={{ background: 'rgba(0,196,123,0.12)', color: 'var(--lp-green-ink, #0a8a5a)' }}>{n}</div>
      <div className="flex-1 pb-8 border-b border-border-subtle">
        <h3 className="text-[17px] font-semibold text-text-primary mb-2">{title}</h3>
        <div className="text-[14px] text-text-soft leading-relaxed space-y-3">{children}</div>
      </div>
    </div>
  )
}

function ExtLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 font-semibold"
      style={{ color: 'var(--lp-green-ink, #0a8a5a)' }}>
      {children}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </a>
  )
}

export default function GettingStarted() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-10">
      <div className="mb-2 text-[12px] font-bold tracking-wider uppercase" style={{ color: 'var(--lp-green-ink, #0a8a5a)' }}>Solo setup checklist</div>
      <h1 className="text-[30px] font-bold tracking-tight text-text-primary mb-3">Get your business ready to text</h1>
      <p className="text-[15px] text-text-soft leading-relaxed mb-8">
        On Solo and above, your outreach sends from your own verified business number. US carriers
        require every business that texts to register (A2P 10DLC), and that registration needs a
        real business identity. Work through the three steps below, then head to your Business
        Identity settings to submit. It is a one-time setup.
      </p>

      <div className="space-y-8">
        <Step n={1} title="Get an EIN (free, ~15 minutes)">
          <p>
            An <strong className="text-text-primary">EIN (Employer Identification Number)</strong> is a
            federal tax ID for your business, like a Social Security number, but for your company. The
            carriers use it to confirm your business is real when they approve your texting brand.
          </p>
          <p>
            You apply directly with the IRS and it is <strong className="text-text-primary">completely free</strong>.
            Beware of sites that charge for this, you never need to pay.
          </p>
          <p><ExtLink href={IRS_EIN_URL}>Apply for an EIN free at irs.gov</ExtLink></p>
        </Step>

        <Step n={2} title="Have a registered business (LLC)">
          <p>
            To register your texting brand you need a registered business entity. Most operators use
            an <strong className="text-text-primary">LLC</strong>, it is quick and inexpensive to form
            and keeps your acquisitions under a real company name.
          </p>
          <p>
            Veori does not file LLCs for you. If you do not have one yet, our partner can set one up in
            a few minutes:
          </p>
          <p>
            <a href={LLC_PARTNER_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-4 py-2 rounded-[8px] font-semibold text-[14px]"
              style={{ background: '#00C47B', color: '#04120c' }}>
              Form your LLC with our partner
            </a>
            <span className="block text-[12px] text-text-muted mt-1.5">Third-party service. Already have an LLC or corporation? Skip this step.</span>
          </p>
        </Step>

        <Step n={3} title="Gather your A2P registration documents">
          <p>Once you have your EIN and business set up, you will need these details to register:</p>
          <ul className="space-y-2 mt-1">
            {A2P_DOCS.map(d => (
              <li key={d} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--lp-green-ink, #0a8a5a)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </Step>
      </div>

      <div className="mt-9 p-5 rounded-[12px]" style={{ background: 'rgba(0,196,123,0.06)', border: '1px solid rgba(0,196,123,0.22)' }}>
        <h3 className="text-[16px] font-semibold text-text-primary mb-1.5">Ready to submit?</h3>
        <p className="text-[14px] text-text-soft mb-4">Enter these details in Business Identity, then register your texting brand. We handle the carrier submission for you and track approval.</p>
        <Link to="/settings"
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-[980px] font-semibold text-[14px]"
          style={{ background: '#00C47B', color: '#04120c' }}>
          Go to Business Identity settings
        </Link>
      </div>

      <p className="text-[12px] text-text-muted mt-6 leading-relaxed">
        The EIN application is free at irs.gov. LLC formation is handled by a third-party partner, not by
        Veori. These steps are required by US mobile carriers for business texting (A2P 10DLC), not by Veori.
      </p>
    </div>
  )
}
