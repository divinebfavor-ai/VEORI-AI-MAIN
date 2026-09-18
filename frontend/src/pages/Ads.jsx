import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Sparkles, ShieldCheck, Plug, Copy, Check, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { ads } from '../services/api'
import useIsMobile from '../hooks/useIsMobile'

const errText = (e, f) => e?.response?.data?.error || e?.message || f
const TABS = [
  { id: 'market',   label: 'Market intelligence' },
  { id: 'creative', label: 'Creative' },
  { id: 'learning', label: 'What works' },
  { id: 'profile',  label: 'Your profile' },
  { id: 'sources',  label: 'Data sources' },
]

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
const label = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--t3)', fontWeight: 600 }
const muted = { fontSize: 12, color: 'var(--t3)', lineHeight: 1.5 }
const scoreColor = (n) => (n == null ? 'var(--t3)' : n >= 70 ? 'var(--green)' : n >= 40 ? 'var(--gold)' : 'var(--amber)')

function Score({ value, of = 100, caption }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 30, fontWeight: 700, color: scoreColor(value), lineHeight: 1 }}>{value == null ? '—' : value}</span>
      <span style={{ fontSize: 12, color: 'var(--t3)' }}>/ {of}</span>
      {caption && <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 6 }}>{caption}</span>}
    </div>
  )
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? 'Copied' : 'Copy'}
    </Button>
  )
}

export default function Ads() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('market')
  const [market, setMarket] = useState('')
  const [brief, setBrief] = useState(null)
  const [briefMissing, setBriefMissing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pack, setPack] = useState(null)
  const [creatives, setCreatives] = useState([])
  const [learning, setLearning] = useState(null)
  const [profile, setProfile] = useState(null)
  const [sources, setSources] = useState([])
  const [checkText, setCheckText] = useState('')
  const [checkResult, setCheckResult] = useState(null)

  useEffect(() => {
    ads.connectors().then(r => setSources(r.data.data.sources)).catch(() => {})
    ads.profile().then(r => setProfile(r.data)).catch(() => {})
    ads.learning().then(r => setLearning(r.data.data)).catch(() => {})
    ads.creatives({ limit: 20 }).then(r => setCreatives(r.data.data)).catch(() => {})
    const saved = localStorage.getItem('veori.ads.market')
    if (saved) { setMarket(saved); loadBrief(saved) }
  }, [])

  const loadBrief = useCallback(async (m) => {
    setBriefMissing(null)
    try { const r = await ads.preflight(m); setBrief(r.data.data) }
    catch (e) { setBrief(null); setBriefMissing(errText(e, 'No brief yet')) }
  }, [])

  const runPreflight = async () => {
    if (!market.trim()) return toast.error('Enter a market, for example "Austin, TX"')
    setBusy(true)
    try {
      const r = await ads.runPreflight(market.trim())
      setBrief(r.data.data); setBriefMissing(null)
      localStorage.setItem('veori.ads.market', market.trim())
      toast.success(r.data.agent_output.summary)
    } catch (e) { toast.error(errText(e, 'Pre-flight failed')) }
    finally { setBusy(false) }
  }

  const generate = async (angle) => {
    setBusy(true)
    try {
      const r = await ads.generate({ market: brief.market, angle: angle || undefined })
      setPack(r.data.agent_output.data); setTab('creative')
      ads.creatives({ limit: 20 }).then(x => setCreatives(x.data.data)).catch(() => {})
      toast.success('Creative package built')
    } catch (e) {
      const d = e?.response?.data
      toast.error(d?.agent_output?.summary || errText(e, 'Could not build a creative'))
    } finally { setBusy(false) }
  }

  const b = brief?.brief || null
  const pulse = b?.market_pulse || null

  return (
    <div style={{ padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1080 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--t1)' }}>Ads</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--t3)' }}>
          Nothing here is generated until a market has been read. Every figure below is counted from your own leads and deals; anything that would need a source Veori is not connected to is shown as unknown, never estimated.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            borderWidth: 1, borderStyle: 'solid', borderColor: tab === t.id ? 'var(--green)' : 'var(--border)',
            background: tab === t.id ? 'rgba(0,195,122,0.10)' : 'var(--surface-bg)',
            color: tab === t.id ? 'var(--green)' : 'var(--t2)', fontWeight: tab === t.id ? 600 : 400,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Market intelligence ─────────────────────────────────────────── */}
      {tab === 'market' && (
        <>
          <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              value={market} onChange={e => setMarket(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runPreflight()}
              placeholder='Austin, TX  ·  78701  ·  TX'
              style={{ flex: '1 1 220px', padding: '8px 10px', borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-text)', fontSize: 13 }}
            />
            <Button size="sm" loading={busy} onClick={runPreflight}><RefreshCw size={12} /> Run pre-flight</Button>
            {market && <Button size="sm" variant="secondary" onClick={() => loadBrief(market)}>Load existing</Button>}
          </div>

          {!brief && briefMissing && <div style={{ ...card, ...muted }}>{briefMissing}</div>}

          {brief && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
                <div style={card}>
                  <div style={label}>Market opportunity</div>
                  <Score value={brief.opportunity_score} />
                  <p style={{ ...muted, margin: '8px 0 0' }}>{pulse?.basis}</p>
                </div>
                <div style={card}>
                  <div style={label}>Creative intelligence</div>
                  <Score value={brief.creative_intelligence_score} />
                  <p style={{ ...muted, margin: '8px 0 0' }}>{b?.creative_intelligence_score?.meaning}</p>
                </div>
                <div style={card}>
                  <div style={label}>Data confidence</div>
                  <Score value={brief.data_confidence} />
                  <p style={{ ...muted, margin: '8px 0 0' }}>
                    Brief expires {new Date(brief.expires_at).toLocaleDateString()}. {pulse?.lead_sample} leads and {pulse?.deal_sample} deals read.
                  </p>
                </div>
              </div>

              <div style={card}>
                <div style={label}>How the score was built</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {(pulse?.components || []).map(c => (
                    <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <div style={{ flex: '1 1 260px' }}>
                        <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{c.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--t4)', marginLeft: 8 }}>weight {c.weight}</span>
                        <p style={{ ...muted, margin: '2px 0 0' }}>{c.basis}</p>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: c.status === 'measured' ? scoreColor(c.score) : 'var(--t4)' }}>
                        {c.status === 'measured' ? c.score : c.status === 'unavailable' ? 'not available' : 'not enough data'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={label}>Situations with evidence in this market</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {(b?.angle_ranking || []).map(a => (
                    <div key={a.angle} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: '1 1 280px' }}>
                        <div style={{ fontSize: 14, color: 'var(--t1)', fontWeight: 600 }}>
                          {a.name} <Badge variant={a.evidence_strength === 'strong' ? 'green' : a.evidence_strength === 'moderate' ? 'amber' : 'gray'}>{a.evidence_strength}</Badge>
                        </div>
                        <p style={{ ...muted, margin: '3px 0 0' }}>{a.evidence} {a.audience}</p>
                      </div>
                      <Button size="sm" variant="secondary" loading={busy} onClick={() => generate(a.angle)}><Sparkles size={12} /> Build creative</Button>
                    </div>
                  ))}
                  {!(b?.angle_ranking || []).length && <p style={muted}>No situation in this market has evidence behind it yet.</p>}
                </div>
                {!!(b?.angles_without_evidence || []).length && (
                  <p style={{ ...muted, marginTop: 10 }}>
                    No evidence here for: {b.angles_without_evidence.map(x => x.name).join(', ')}. Veori will not build creative for a situation it cannot see in your data.
                  </p>
                )}
              </div>

              <div style={card}>
                <div style={label}>Who to spend on first</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {(b?.audience_priority_matrix || []).map(s => (
                    <div key={s.segment} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                      <div style={{ flex: '1 1 300px' }}>
                        <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{s.name}</span>
                        <p style={{ ...muted, margin: '2px 0 0' }}>{s.why} {s.operator_fit_basis}</p>
                      </div>
                      <Badge variant={s.tier === 'first' ? 'green' : s.tier === 'second' ? 'amber' : 'gray'}>{s.tier}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={label}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> What this brief does not know</div>
                <ul style={{ ...muted, margin: '8px 0 0', paddingLeft: 18 }}>
                  {(brief.data_gaps || []).map((g, i) => <li key={i} style={{ marginBottom: 4 }}><strong style={{ color: 'var(--t2)' }}>{g.item}</strong> — {g.why_it_matters} <em style={{ color: 'var(--t4)' }}>{g.how_to_get}</em></li>)}
                </ul>
                <p style={{ ...muted, marginTop: 8 }}>{b?.no_agent_may_assume?.rule} No agent will state any of these as fact.</p>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Creative ────────────────────────────────────────────────────── */}
      {tab === 'creative' && (
        <>
          {!pack && <div style={{ ...card, ...muted }}>Run a pre-flight, then build a creative from one of the situations that has evidence. Nothing can be generated without a live brief.</div>}
          {pack && (
            <>
              <div style={card}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t1)' }}>{pack.angle_name} · {pack.psychological_driver}</div>
                    <p style={{ ...muted, margin: '3px 0 0' }}>{pack.driver_basis}</p>
                  </div>
                  <Score value={pack.creative_intelligence_score} caption="creative intelligence" />
                </div>
              </div>

              <div style={card}>
                <div style={label}>Hooks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {(pack.hooks || []).map(h => (
                    <div key={h.hook_style} style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h.style_name}</span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Badge variant={h.differentiation >= 70 ? 'green' : h.differentiation >= 40 ? 'amber' : 'red'}>{h.differentiation}/100 distinct</Badge>
                          <CopyButton text={h.text} />
                        </span>
                      </div>
                      <p style={{ margin: '6px 0 0', fontSize: 14, color: h.allowed ? 'var(--t1)' : 'var(--t3)', lineHeight: 1.5 }}>{h.text}</p>
                      {(h.why_not || h.blockers) && <p style={{ ...muted, margin: '4px 0 0', color: 'var(--amber)' }}>{h.why_not || h.blockers}</p>}
                    </div>
                  ))}
                  {(pack.skipped_shapes || []).map(s => (
                    <p key={s.hook_style} style={{ ...muted, margin: 0 }}><strong style={{ color: 'var(--t3)' }}>{s.hook_style}</strong> — {s.why}</p>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={label}>Image brief</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 13, color: 'var(--t2)', lineHeight: 1.55 }}>
                  <div><strong style={{ color: 'var(--t1)' }}>{pack.image_brief.format_name}</strong> — {pack.image_brief.why_this_format}</div>
                  <div><strong>Subject.</strong> {pack.image_brief.subject}</div>
                  <div><strong>Composition.</strong> {pack.image_brief.composition}</div>
                  <div><strong>Lighting.</strong> {pack.image_brief.lighting}</div>
                  <div><strong>Palette.</strong> {pack.image_brief.palette}</div>
                  <div><strong>Overlay.</strong> “{pack.image_brief.text_overlay.text}” — {pack.image_brief.text_overlay.placement}. {pack.image_brief.text_overlay.rules}</div>
                  <div><strong>Must not appear.</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pack.image_brief.must_not_appear.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                  <div><strong>Sizes.</strong> {pack.image_brief.aspect_ratios.map(a => `${a.placement} ${a.pixels}`).join(' · ')}</div>
                  <div><strong>Alt text.</strong> {pack.image_brief.accessibility.alt_text}</div>
                  <p style={{ ...muted, margin: '4px 0 0' }}>{pack.image_brief.production_note}</p>
                </div>
              </div>

              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={label}>Video script — {pack.video_script.total_seconds} seconds</div>
                  <CopyButton text={pack.video_script.parts.map(p => `${p.seconds}s ${p.name}: ${p.line}`).join('\n\n')} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {pack.video_script.parts.map(p => (
                    <div key={p.part}>
                      <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>{p.seconds}s · {p.name}</span>
                      <p style={{ margin: '3px 0 0', fontSize: 14, color: 'var(--t1)', lineHeight: 1.5 }}>{p.line}</p>
                      <p style={{ ...muted, margin: '2px 0 0' }}>{p.on_screen} <em>{p.rule}</em></p>
                    </div>
                  ))}
                </div>
                <p style={{ ...muted, marginTop: 10 }}>{pack.video_script.delivery} {pack.video_script.captions}</p>
              </div>

              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={label}>Organic companion</div>
                  <CopyButton text={pack.organic_companion.post} />
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--t1)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{pack.organic_companion.post}</p>
                <p style={{ ...muted, marginTop: 8 }}>{pack.organic_companion.why_it_works} {pack.organic_companion.do_not.join(' ')}</p>
              </div>

              <div style={card}>
                <div style={label}>Expected cost</div>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--t2)', lineHeight: 1.55 }}>
                  <Badge variant={pack.cost_expectation.label === 'BENCHMARKED' ? 'green' : pack.cost_expectation.label === 'ESTIMATED' ? 'amber' : 'gray'}>{pack.cost_expectation.label}</Badge>{' '}
                  {pack.cost_expectation.statement}
                </p>
                <p style={{ ...muted, marginTop: 6 }}>{pack.cost_expectation.not_a_guarantee}</p>
              </div>

              <div style={card}>
                <div style={label}><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> Before you run it</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {pack.compliance_checklist.map((c, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{c.item} — {c.question}</div>
                      <p style={{ ...muted, margin: '2px 0 0' }}>{c.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!!creatives.length && (
            <div style={card}>
              <div style={label}>Saved creatives</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {creatives.map(c => (
                  <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 260px' }}>
                      <div style={{ fontSize: 13, color: 'var(--t1)' }}>{c.hook}</div>
                      <p style={{ ...muted, margin: '2px 0 0' }}>{c.market} · {c.angle} · {c.psychological_driver} · {new Date(c.created_at).toLocaleDateString()}</p>
                    </div>
                    <Badge variant={c.status === 'active' ? 'green' : 'gray'}>{c.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={card}>
            <div style={label}>Check any copy</div>
            <textarea
              value={checkText} onChange={e => setCheckText(e.target.value)} rows={3}
              placeholder="Paste an ad you are about to run and Veori will screen it for fair-housing and claim failures."
              style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
            />
            <Button size="sm" variant="secondary" style={{ marginTop: 8 }} onClick={async () => {
              try { setCheckResult((await ads.checkCopy(checkText)).data.data) } catch (e) { toast.error(errText(e, 'Could not check that')) }
            }}><ShieldCheck size={12} /> Screen it</Button>
            {checkResult && (
              <div style={{ marginTop: 10 }}>
                <Badge variant={checkResult.ok ? 'green' : 'red'}>{checkResult.ok ? 'Nothing blocking' : `${checkResult.blocked.length} blocking`}</Badge>
                {[...checkResult.blocked, ...checkResult.warnings].map((f, i) => (
                  <p key={i} style={{ ...muted, margin: '6px 0 0' }}>
                    <strong style={{ color: f.level === 'block' ? 'var(--red)' : 'var(--amber)' }}>“{f.found}”</strong> — {f.detail} <em>{f.fix}</em>
                  </p>
                ))}
                <p style={{ ...muted, marginTop: 8 }}>{checkResult.disclaimer}</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Learning ────────────────────────────────────────────────────── */}
      {tab === 'learning' && learning && (
        <>
          <div style={card}>
            <div style={label}>Where recommendations come from</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, alignItems: 'baseline' }}>
              <Score value={learning.blend.own_weight} caption="your own results" />
              <Score value={learning.blend.network_weight} caption="the network" />
            </div>
            <p style={{ ...muted, marginTop: 8 }}>{learning.blend.explanation} {learning.blend.why_not_all_own}</p>
          </div>
          <div style={card}>
            <div style={label}>What the network has seen</div>
            {!learning.network.usable && <p style={{ ...muted, marginTop: 8 }}>{learning.network.empty_note}</p>}
            {learning.network.usable && ['by_angle', 'by_driver', 'by_hook_style', 'by_image_format'].map(k => (
              <div key={k} style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>{k.replace('by_', '').replace('_', ' ')}</div>
                {learning.network[k].map(r => (
                  <p key={r.value} style={{ ...muted, margin: '4px 0 0' }}>
                    <Badge variant={r.label === 'BENCHMARKED' ? 'green' : 'amber'}>{r.label}</Badge>{' '}
                    <strong style={{ color: 'var(--t1)' }}>{r.value}</strong> — {r.label_meaning} {r.median_cpl != null && `Median $${r.median_cpl} per lead.`}
                  </p>
                ))}
              </div>
            ))}
            <p style={{ ...muted, marginTop: 10 }}>{learning.network.cpl_note}</p>
          </div>
        </>
      )}

      {/* ── Profile ─────────────────────────────────────────────────────── */}
      {tab === 'profile' && profile && (
        <div style={card}>
          <div style={label}>Your ad profile — {profile.completeness.pct}% complete</div>
          <p style={{ ...muted, marginTop: 6 }}>{profile.voice.instruction}</p>
          {!!profile.completeness.missing.length && (
            <p style={{ ...muted, marginTop: 8 }}>
              Still missing: {profile.completeness.missing.join(', ')}. Each one Veori does not have is one it will not write to.
            </p>
          )}
          <ProfileForm profile={profile.data} onSaved={(d) => { setProfile(p => ({ ...p, data: d.data, completeness: d.completeness })); toast.success('Saved') }} />
        </div>
      )}

      {/* ── Sources ─────────────────────────────────────────────────────── */}
      {tab === 'sources' && (
        <div style={card}>
          <div style={label}><Plug size={11} style={{ verticalAlign: -1 }} /> Advertising data sources</div>
          <p style={{ ...muted, marginTop: 6 }}>None of these is connected. Rather than estimate what they would have told us, Veori records the gap on every brief.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {sources.map(s => (
              <div key={s.id} style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{s.name}</span>
                  <Badge variant={s.connected ? 'green' : 'gray'}>{s.connected ? 'connected' : 'not connected'}</Badge>
                </div>
                <p style={{ ...muted, margin: '3px 0 0' }}>{s.reason}</p>
                <p style={{ ...muted, margin: '3px 0 0' }}><strong style={{ color: 'var(--t3)' }}>Without it:</strong> {s.without_it}</p>
                {!!(s.env || []).length && <p style={{ ...muted, margin: '3px 0 0', color: 'var(--t4)' }}>Needs: {s.env.join(', ')}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const FIELDS = [
  { k: 'business_years', label: 'Years in business', type: 'number' },
  { k: 'monthly_ad_budget', label: 'Monthly ad budget', type: 'number' },
  { k: 'target_leads_per_month', label: 'Leads you want a month', type: 'number' },
  { k: 'price_min', label: 'Lowest price you buy', type: 'number' },
  { k: 'price_max', label: 'Highest price you buy', type: 'number' },
  { k: 'property_types', label: 'Property types (comma separated)', type: 'list' },
  { k: 'exit_strategies', label: 'Exit strategies (comma separated)', type: 'list' },
  { k: 'good_lead_definition', label: 'What makes a good lead for you', type: 'text' },
  { k: 'bad_lead_definition', label: 'What makes a bad one', type: 'text' },
  { k: 'biggest_frustration', label: 'Your biggest frustration with ads so far', type: 'text' },
]

function ProfileForm({ profile, onSaved }) {
  const [form, setForm] = useState(() => {
    const f = {}
    for (const x of FIELDS) f[x.k] = x.type === 'list' ? (profile?.[x.k] || []).join(', ') : (profile?.[x.k] ?? '')
    f.tone = profile?.voice?.tone || ''
    f.phrases_to_avoid = (profile?.voice?.phrases_to_avoid || []).join(', ')
    return f
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const body = {}
      for (const x of FIELDS) {
        const v = form[x.k]
        if (v === '' || v == null) continue
        body[x.k] = x.type === 'list' ? String(v).split(',').map(s => s.trim()).filter(Boolean) : x.type === 'number' ? Number(v) : v
      }
      const voice = {}
      if (form.tone) voice.tone = form.tone
      if (form.phrases_to_avoid) voice.phrases_to_avoid = form.phrases_to_avoid.split(',').map(s => s.trim()).filter(Boolean)
      if (Object.keys(voice).length) body.voice = voice
      if (!Object.keys(body).length) return toast.error('Nothing to save yet')
      const r = await ads.saveProfile(body)
      onSaved(r.data)
    } catch (e) { toast.error(errText(e, 'Could not save')) }
    finally { setSaving(false) }
  }

  const input = { width: '100%', padding: '8px 10px', borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-text)', fontSize: 13, fontFamily: 'inherit' }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
      {FIELDS.map(f => (
        <label key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>{f.label}</span>
          <input style={input} type={f.type === 'number' ? 'number' : 'text'} value={form[f.k]} onChange={e => setForm(s => ({ ...s, [f.k]: e.target.value }))} />
        </label>
      ))}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--t3)' }}>How you speak to sellers</span>
        <input style={input} value={form.tone} onChange={e => setForm(s => ({ ...s, tone: e.target.value }))} placeholder="blunt, no slogans" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--t3)' }}>Phrases you never use</span>
        <input style={input} value={form.phrases_to_avoid} onChange={e => setForm(s => ({ ...s, phrases_to_avoid: e.target.value }))} placeholder="reach out, circle back" />
      </label>
      <div style={{ gridColumn: '1 / -1' }}>
        <Button size="sm" loading={saving} onClick={save}>Save profile</Button>
      </div>
    </div>
  )
}
