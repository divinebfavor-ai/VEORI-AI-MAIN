import React, { useState, useEffect } from 'react'
import { BookOpen, CheckCircle, ChevronRight, Search, Award, Lock, X } from 'lucide-react'
import { academy as academyApi, waitlist as waitlistApi } from '../services/api'
import useAuthStore from '../store/authStore'

// ─── Lesson modal ─────────────────────────────────────────────────────────────
function LessonModal({ lesson, onClose, onComplete, completed }) {
  const [tab, setTab] = useState('lesson')
  const [answer, setAnswer] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect] = useState(null)

  if (!lesson) return null

  const handleSubmit = async () => {
    if (answer == null) return
    const isCorrect = answer === lesson.quiz?.answer
    setCorrect(isCorrect)
    setSubmitted(true)
    if (isCorrect && !completed) {
      await onComplete(lesson.lesson_id)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-card border border-border-subtle rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border-subtle">
          <div>
            <span className="text-[10px] font-medium tracking-widest uppercase text-text-muted">
              {lesson.section} · Lesson {lesson.order}
            </span>
            <h2 className="text-[20px] font-semibold text-text-primary mt-1">{lesson.title}</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors ml-4 mt-1">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 border-b border-border-subtle">
          {['lesson', 'quiz'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-[13px] font-medium rounded-t-lg transition-colors capitalize ${
                tab === t ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text-secondary'
              }`}>
              {t === 'quiz' ? 'Quiz' : 'Lesson'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          {tab === 'lesson' ? (
            <div className="space-y-6">
              <p className="text-[14px] text-text-secondary leading-relaxed">{lesson.body}</p>

              {lesson.example && (
                <div className="bg-surface border border-border-subtle rounded-xl p-5">
                  <p className="text-[10px] font-medium tracking-widest uppercase text-text-muted mb-3">Example</p>
                  <p className="text-[13px] text-text-secondary leading-relaxed italic">{lesson.example}</p>
                </div>
              )}

              {lesson.takeaways && lesson.takeaways.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium tracking-widest uppercase text-text-muted mb-3">Key Takeaways</p>
                  <div className="space-y-2">
                    {lesson.takeaways.map((t, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <CheckCircle size={14} className="text-primary shrink-0 mt-0.5" />
                        <p className="text-[13px] text-text-secondary">{t}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-[15px] font-medium text-text-primary">{lesson.quiz?.question}</p>
              <div className="space-y-2">
                {lesson.quiz?.options?.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => !submitted && setAnswer(i)}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-[13px] transition-all ${
                      submitted
                        ? i === lesson.quiz.answer
                          ? 'border-primary bg-primary/10 text-primary'
                          : i === answer && !correct
                          ? 'border-danger bg-danger/10 text-danger'
                          : 'border-border-subtle text-text-muted'
                        : answer === i
                        ? 'border-primary bg-primary/10 text-text-primary'
                        : 'border-border-subtle text-text-secondary hover:border-border-active'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {submitted && (
                <div className={`p-4 rounded-xl ${correct ? 'bg-primary/10 border border-primary/20' : 'bg-danger/10 border border-danger/20'}`}>
                  <p className={`text-[13px] font-medium ${correct ? 'text-primary' : 'text-danger'}`}>
                    {correct ? '✓ Correct! Lesson marked complete.' : '✗ Not quite — the correct answer is highlighted above.'}
                  </p>
                </div>
              )}

              {!submitted && (
                <button
                  onClick={handleSubmit}
                  disabled={answer == null}
                  className="w-full py-3 rounded-xl bg-primary text-black text-[13px] font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  Submit Answer
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Veori Credits waitlist form ──────────────────────────────────────────────
function CreditsWaitlist() {
  const [form, setForm] = useState({ name: '', email: '', investment_range: '' })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [count, setCount] = useState(null)
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    waitlistApi.count().then(r => setCount(r.data?.count)).catch(() => {})
    if (user) setForm(f => ({ ...f, name: user.full_name || '', email: user.email || '' }))
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.email) return
    setLoading(true)
    try {
      const r = await waitlistApi.join(form)
      setCount(r.data?.waitlist_count)
      setDone(true)
    } catch {
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-card border border-border-subtle rounded-2xl p-8 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.04]"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, #C9A84C, transparent)' }} />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Award size={18} className="text-gold" />
          <h3 className="text-[18px] font-semibold text-text-primary">Veori Credits</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/10 text-gold border border-gold/20 font-medium">Coming Soon</span>
        </div>
        <p className="text-[13px] text-text-secondary mb-6 leading-relaxed">
          Earn credits for every deal closed through Veori and redeem them for premium features, skip traces, and more. Join the waitlist to get early access.
        </p>

        {count != null && (
          <p className="text-[12px] text-text-muted mb-4">
            <span className="text-gold font-medium">{count.toLocaleString()}</span> operators already on the waitlist.
          </p>
        )}

        {done ? (
          <div className="flex items-center gap-2 text-primary text-[14px] font-medium">
            <CheckCircle size={16} />
            You're on the list! We'll reach out when credits launch.
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text" placeholder="Full name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="flex-1 px-4 py-2.5 rounded-xl bg-surface border border-border-subtle text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-gold/50"
            />
            <input
              type="email" placeholder="Email address" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="flex-1 px-4 py-2.5 rounded-xl bg-surface border border-border-subtle text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-gold/50"
            />
            <button type="submit" disabled={loading || !form.name || !form.email}
              className="px-6 py-2.5 rounded-xl bg-gold text-black text-[13px] font-semibold hover:bg-gold/90 transition-colors disabled:opacity-50 shrink-0">
              {loading ? 'Joining…' : 'Join Waitlist'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Main Academy page ────────────────────────────────────────────────────────
export default function Academy() {
  const user = useAuthStore(s => s.user)
  const [lessons, setLessons]       = useState([])
  const [progress, setProgress]     = useState([])
  const [glossary, setGlossary]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('lessons')
  const [search, setSearch]         = useState('')
  const [activeLesson, setActiveLesson] = useState(null)

  useEffect(() => {
    Promise.allSettled([
      academyApi.getLessons(),
      user?.id ? academyApi.getProgress(user.id) : Promise.resolve(null),
      academyApi.getGlossary(),
    ]).then(([lRes, pRes, gRes]) => {
      if (lRes.status === 'fulfilled') setLessons(lRes.value.data?.lessons || [])
      if (pRes.status === 'fulfilled' && pRes.value) setProgress(pRes.value.data?.completed_lesson_ids || [])
      if (gRes.status === 'fulfilled') setGlossary(gRes.value.data?.glossary || [])
    }).finally(() => setLoading(false))
  }, [user?.id])

  const handleComplete = async (lessonId) => {
    if (!user?.id) return
    await academyApi.completeLesson({ user_id: user.id, lesson_id: lessonId }).catch(() => {})
    setProgress(p => p.includes(lessonId) ? p : [...p, lessonId])
  }

  const sections = [...new Set(lessons.map(l => l.section))].filter(Boolean)

  const filteredGlossary = glossary.filter(g =>
    !search || g.term?.toLowerCase().includes(search.toLowerCase()) || g.definition?.toLowerCase().includes(search.toLowerCase())
  )

  const completedCount = progress.length
  const totalCount = lessons.length
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">

      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={20} className="text-primary" strokeWidth={1.5} />
            <h1 className="text-[28px] font-semibold text-text-primary tracking-tight">Veori Academy</h1>
          </div>
          <p className="text-[13px] text-text-muted">Master real estate wholesaling. Learn the system. Close more deals.</p>
        </div>

        {/* Progress pill */}
        {totalCount > 0 && (
          <div className="flex items-center gap-3 bg-card border border-border-subtle rounded-xl px-5 py-3">
            <div className="w-24 h-1.5 rounded-full bg-surface overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[13px] font-medium text-text-primary">{completedCount}/{totalCount}</span>
            <span className="text-[12px] text-text-muted">complete</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface border border-border-subtle rounded-xl p-1 mb-8 w-fit">
        {['lessons', 'glossary'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-[13px] font-medium capitalize transition-all ${
              tab === t ? 'bg-card text-text-primary border border-border-subtle' : 'text-text-muted hover:text-text-secondary'
            }`}>
            {t === 'glossary' ? `Glossary (${glossary.length})` : `Lessons (${totalCount})`}
          </button>
        ))}
      </div>

      {tab === 'lessons' && (
        loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-2xl bg-card animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-8">
            {sections.map(section => {
              const sectionLessons = lessons.filter(l => l.section === section)
              return (
                <div key={section}>
                  <p className="text-[11px] font-semibold tracking-widest uppercase text-text-muted mb-4">{section}</p>
                  <div className="space-y-2">
                    {sectionLessons.map(lesson => {
                      const done = progress.includes(lesson.lesson_id)
                      return (
                        <button
                          key={lesson.lesson_id}
                          onClick={() => setActiveLesson(lesson)}
                          className="w-full flex items-center gap-4 p-5 bg-card border border-border-subtle rounded-2xl text-left hover:border-border-active transition-all group"
                        >
                          <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center border transition-colors ${
                            done
                              ? 'bg-primary/15 border-primary/30'
                              : 'bg-surface border-border-subtle group-hover:border-border-active'
                          }`}>
                            {done
                              ? <CheckCircle size={14} className="text-primary" />
                              : <span className="text-[11px] font-semibold text-text-muted">{lesson.order}</span>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-text-primary group-hover:text-white transition-colors">{lesson.title}</p>
                            <p className="text-[12px] text-text-muted mt-0.5 truncate">{lesson.body?.slice(0, 90)}…</p>
                          </div>
                          <ChevronRight size={16} className="text-text-muted group-hover:text-text-secondary shrink-0 transition-colors" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'glossary' && (
        <div>
          <div className="relative mb-6">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search terms…"
              className="w-full pl-10 pr-4 py-3 bg-card border border-border-subtle rounded-xl text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-border-active"
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)}
            </div>
          ) : filteredGlossary.length === 0 ? (
            <p className="text-center text-text-muted py-12 text-[13px]">No terms matching "{search}"</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredGlossary.map((g, i) => (
                <div key={i} className="bg-card border border-border-subtle rounded-xl p-5">
                  <p className="text-[14px] font-semibold text-text-primary mb-2">{g.term}</p>
                  <p className="text-[13px] text-text-secondary leading-relaxed">{g.definition}</p>
                  {g.section_link && (
                    <p className="text-[11px] text-primary mt-2">→ {g.section_link}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Veori Credits waitlist */}
      <div className="mt-10">
        <CreditsWaitlist />
      </div>

      {/* Lesson modal */}
      {activeLesson && (
        <LessonModal
          lesson={activeLesson}
          onClose={() => setActiveLesson(null)}
          onComplete={handleComplete}
          completed={progress.includes(activeLesson.lesson_id)}
        />
      )}
    </div>
  )
}
