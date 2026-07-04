/**
 * /coo - AI COO Command Center
 *
 * Renders the fused 4-answer briefing from GET /api/coo/briefing:
 *   1. What is happening?      (pipeline snapshot - real counts)
 *   2. Why is it happening?    (ranked bottlenecks + evidence)
 *   3. What is likely next?    (pipeline expected value, about-to-close, at-risk)
 *   4. What should I do now?   (EV-sorted action queue + escalations)
 *
 * NEW FILE. Read-only view - never writes. Mirrors the DailyBriefing page's
 * dark theme + fetch/auth pattern. Null-safe: every field degrades to "-" when
 * the engine returns null (missing pricing → no fake numbers).
 */
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'https://veori-ai-main-production.up.railway.app/api'
function authHeader() {
  const token = localStorage.getItem('veori_token') || localStorage.getItem('token') || localStorage.getItem('authToken') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const money = (v) => (v == null ? '-' : '$' + Number(v).toLocaleString())
const pct   = (v) => (v == null ? '-' : `${v}%`)

const SEV_COLOR = { high: 'var(--red)', medium: 'var(--gold)', low: 'var(--t3)' }

// Section E - the three operator autonomy modes (must match operatorMode.js).
const MODE_OPTIONS = [
  { id: 'manual',    label: 'Manual',    icon: '✋', color: 'var(--t2)',  hint: 'You drive. The AI only suggests - nothing fires on its own.' },
  { id: 'copilot',   label: 'Copilot',   icon: '🤝', color: 'var(--gold)', hint: 'AI queues every action for your one-click approval. (Default)' },
  { id: 'autopilot', label: 'Autopilot', icon: '⚡', color: 'var(--green)', hint: 'Low-risk, reversible actions auto-fire. Contracts, money & DNC always wait for you.' },
]

// How each per-action disposition renders in the queue.
const DISPOSITION_BADGE = {
  auto:    { label: 'Auto', color: 'var(--green)', bg: 'rgba(0,195,122,0.14)' },
  approve: { label: 'Approve', color: 'var(--gold)', bg: 'rgba(201,168,76,0.14)' },
  suggest: { label: 'Suggestion', color: 'var(--t2)', bg: 'var(--surface-bg)' },
}

const ACTION_LABEL = {
  escalate_to_human: 'Escalate to you',
  capture_pricing:   'Capture pricing',
  present_offer:     'Present offer',
  drive_to_close:    'Drive to close',
  nurture_followup:  'Nurture / follow up',
  capture_lead:      'Capture lead data',
}

export default function COOCommandCenter() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [savingMode, setSavingMode] = useState(false)

  function load() {
    setLoading(true); setError(false)
    fetch(`${API}/coo/briefing`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => setData(d?.data || null))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // Section E - switch copilot/autopilot mode. Persists via the preferences
  // endpoint, then reloads so the action queue re-annotates under the new mode.
  function setMode(mode) {
    setSavingMode(true)
    fetch(`${API}/operator/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ operator_mode: mode }),
    })
      .then(() => load())
      .catch(() => {})
      .finally(() => setSavingMode(false))
  }

  const s = {
    page:  { minHeight: '100vh', background: 'var(--bg)', color: 'var(--t1)', fontFamily: 'Inter,sans-serif', padding: '32px' },
    h1:    { fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 4, color: 'var(--t1)' },
    card:  { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 16, padding: '24px', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' },
    stat:  { background: 'var(--surface-bg)', borderRadius: 10, padding: '16px', textAlign: 'center', border: '1px solid var(--border)' },
    eyebrow: (c) => ({ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: c || 'var(--t3)', marginBottom: 16 }),
    row:   { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--surface-bg)', borderRadius: 8, border: '1px solid var(--border)' },
  }

  const h = data?.what_is_happening
  const why = data?.why_is_it_happening
  const next = data?.what_happens_next
  const now = data?.what_to_do_now

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={s.h1}>🧭 COO Command Center</h1>
          <p style={{ fontSize: 14, color: 'var(--t2)', margin: 0 }}>
            What's happening · why · what's next · what to do now
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Section E - copilot/autopilot mode switch. Governs whether the AI's
              recommended actions auto-fire (autopilot, low-risk + reversible only)
              or wait for your approval. Defaults to Copilot. */}
          {now?.operator_mode && (
            <div style={{ display: 'flex', background: 'var(--surface-bg)', borderRadius: 10, padding: 3, gap: 2 }}>
              {MODE_OPTIONS.map(opt => {
                const active = now.operator_mode.mode === opt.id
                return (
                  <button key={opt.id} onClick={() => setMode(opt.id)} disabled={savingMode || active}
                    title={opt.hint}
                    style={{
                      padding: '7px 14px', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 800,
                      fontFamily: 'Inter,sans-serif', cursor: active ? 'default' : savingMode ? 'wait' : 'pointer',
                      background: active ? opt.color : 'transparent',
                      color: active ? 'var(--bg)' : 'var(--t2)',
                      transition: 'all 0.15s',
                    }}>
                    {opt.icon} {opt.label}
                  </button>
                )
              })}
            </div>
          )}
          <button onClick={load} disabled={loading}
            style={{ padding: '10px 22px', background: 'var(--gold)', color: 'var(--bg)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: loading ? 'wait' : 'pointer', fontFamily: 'Inter,sans-serif' }}>
            {loading ? 'Analyzing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 48, color: 'var(--t2)' }}>Running the engines across your pipeline…</div>}
      {error && !loading && (
        <div style={{ ...s.card, textAlign: 'center', padding: 40, color: 'var(--t2)' }}>
          Couldn't load the briefing. <button onClick={load} style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Retry</button>
        </div>
      )}

      {!loading && !error && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Headline */}
          <div style={{ ...s.card, background: 'linear-gradient(135deg, rgba(0,195,122,0.10) 0%, var(--card-bg) 70%)', border: '1px solid rgba(0,195,122,0.20)' }}>
            <div style={s.eyebrow('var(--green)')}>The Pulse</div>
            <p style={{ fontSize: 15, color: 'var(--t1)', lineHeight: 1.7, margin: 0 }}>{data.headline}</p>
          </div>

          {/* Q1 - What is happening */}
          {h && (
            <div style={s.card}>
              <div style={s.eyebrow()}>1 · What's Happening</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { label: 'Active Leads', value: h.leads_active, color: 'var(--t1)' },
                  { label: 'Hot Leads',    value: h.leads_hot, color: 'var(--red)' },
                  { label: 'Live Deals',   value: h.deals_live, color: 'var(--green)' },
                  { label: 'Under Contract', value: h.deals_under_contract, color: 'var(--gold)' },
                  { label: 'Closed',       value: h.deals_closed, color: 'var(--green)' },
                  { label: 'Calls Today',  value: h.calls_today, color: 'var(--t1)' },
                  { label: 'Follow-Ups Due', value: h.follow_ups_due, color: 'var(--gold)' },
                  { label: 'Opportunities', value: data.opportunities_count, color: 'var(--green)' },
                ].map(item => (
                  <div key={item.label} style={s.stat}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: item.color, marginBottom: 4 }}>{item.value ?? '-'}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Q3 - What's next (forecast) */}
          {next && (
            <div style={s.card}>
              <div style={s.eyebrow()}>3 · What's Likely Next</div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: next.about_to_close?.length || next.at_risk?.length ? 18 : 0 }}>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: 'var(--green)' }}>{money(next.pipeline_expected_value)}</div>
                  <div style={{ fontSize: 12, color: 'var(--t2)' }}>Pipeline expected value</div>
                </div>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: 'var(--t1)' }}>{next.deals_with_ev ?? 0}</div>
                  <div style={{ fontSize: 12, color: 'var(--t2)' }}>Priced deals</div>
                </div>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: 'var(--gold)' }}>{next.deals_need_pricing ?? 0}</div>
                  <div style={{ fontSize: 12, color: 'var(--t2)' }}>Need pricing</div>
                </div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, margin: 0 }}>{next.summary}</p>

              {next.about_to_close?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>Likely to close</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {next.about_to_close.map((o, i) => (
                      <Link key={o.lead_id || i} to={`/leads`} style={{ ...s.row, textDecoration: 'none', color: 'var(--t1)' }}>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{o.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>{pct(o.close_odds)} close</span>
                        <span style={{ fontSize: 12, color: 'var(--t2)' }}>{money(o.expected_value)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {next.at_risk?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>At fallout risk</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {next.at_risk.map((o, i) => (
                      <div key={o.lead_id || i} style={s.row}>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{o.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>{pct(o.fallout_risk)} risk</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Q2 - Why (bottlenecks) */}
          {why && (
            <div style={s.card}>
              <div style={s.eyebrow()}>2 · Why It's Happening</div>
              {why.bottlenecks?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {why.bottlenecks.map((b, i) => (
                    <div key={b.key || i} style={{ ...s.row, alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEV_COLOR[b.severity] || 'var(--gold)', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{b.title}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: SEV_COLOR[b.severity] || 'var(--gold)' }}>{b.severity}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--t2)', paddingLeft: 18 }}>{b.detail}</div>
                      {b.evidence && <div style={{ fontSize: 11, color: 'var(--t3)', paddingLeft: 18, fontStyle: 'italic' }}>Evidence: {b.evidence}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>{why.summary}</p>
              )}
            </div>
          )}

          {/* Q4 - What to do now (action queue) */}
          {now && (
            <div style={s.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ ...s.eyebrow('var(--green)'), marginBottom: 0 }}>4 · What To Do Right Now</div>
                {now.operator_mode?.summary && (
                  <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>{now.operator_mode.summary}</div>
                )}
              </div>

              {now.escalations?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>⚠ Needs your decision</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {now.escalations.map((o, i) => (
                      <div key={o.lead_id || i} style={{ ...s.row, border: '1px solid rgba(239,68,68,0.25)' }}>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{o.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--red)' }}>conf {pct(o.confidence)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {now.actions?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {now.actions.map((a, i) => {
                    // Section E - the parallel annotated action carries the disposition
                    // under the current mode (auto / approve / suggest). Null-safe.
                    const ann = now.operator_mode?.actions?.[i]
                    const disp = ann && DISPOSITION_BADGE[ann.disposition]
                    return (
                      <div key={a.lead_id || i} style={{ ...s.row, alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                          <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,195,122,0.15)', color: 'var(--green)', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{a.name}</span>
                          {disp && (
                            <span title={ann.decision_reason || ''} style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 20, background: disp.bg, color: disp.color }}>{disp.label}</span>
                          )}
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(0,195,122,0.12)', color: 'var(--green)' }}>{ACTION_LABEL[a.action] || a.action || 'Review'}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--t1)', minWidth: 64, textAlign: 'right' }}>{money(a.expected_value)}</span>
                        </div>
                        {a.reason && <div style={{ fontSize: 12, color: 'var(--t2)', paddingLeft: 34 }}>{a.reason}</div>}
                        <div style={{ fontSize: 11, color: 'var(--t3)', paddingLeft: 34 }}>
                          {a.strategy} · {pct(a.close_odds)} close · conf {pct(a.confidence)}
                        </div>
                        {ann?.decision_reason && (
                          <div style={{ fontSize: 11, color: disp ? disp.color : 'var(--t3)', paddingLeft: 34, opacity: 0.85 }}>{ann.decision_reason}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>{now.summary}</p>
              )}
            </div>
          )}

          {/* What I've Learned - Rule 3 (outcome learning) made visible */}
          {data.learning && (
            <div style={{ ...s.card, border: '1px solid rgba(201,168,76,0.20)' }}>
              <div style={s.eyebrow('var(--gold)')}>What I've Learned</div>
              {data.learning.learned ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 }}>
                    {[
                      { label: 'Deals Closed', value: data.learning.won, color: 'var(--green)' },
                      { label: 'Deals Dead',   value: data.learning.lost, color: 'var(--red)' },
                      { label: 'Win Rate',     value: pct(data.learning.win_rate), color: 'var(--gold)' },
                      { label: 'Avg Days to Close', value: data.learning.avg_days_to_close ?? '-', color: 'var(--t1)' },
                      {
                        label: 'Strongest Market',
                        value: data.learning.best_state ? data.learning.best_state.state : '-',
                        sub: data.learning.best_state ? `${pct(data.learning.best_state.win_rate)} win` : null,
                        color: 'var(--green)',
                      },
                    ].map(item => (
                      <div key={item.label} style={s.stat}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: item.color, marginBottom: 4 }}>{item.value ?? '-'}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>{item.label}</div>
                        {item.sub && <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{item.sub}</div>}
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, margin: 0 }}>{data.learning.summary}</p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--t2)', margin: 0 }}>{data.learning.summary}</p>
              )}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--t4)', textAlign: 'center', marginTop: 4 }}>
            Generated {data.generated_at ? new Date(data.generated_at).toLocaleString() : ''} · derived from real pipeline data, no fabricated numbers
          </div>
        </div>
      )}
    </div>
  )
}
