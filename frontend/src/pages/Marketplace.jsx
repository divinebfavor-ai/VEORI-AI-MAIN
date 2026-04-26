import React from 'react'
import { Lock, TrendingUp, Users, Zap, Building2 } from 'lucide-react'

const PREVIEW_ITEMS = [
  {
    icon: TrendingUp,
    title: 'Deal Marketplace',
    desc: 'List and discover off-market wholesale deals across 50 states. Instant buyer matching.',
    tag: 'Deals',
  },
  {
    icon: Users,
    title: 'Verified Buyer Network',
    desc: 'Connect with 10,000+ cash buyers and institutional investors actively looking to close.',
    tag: 'Buyers',
  },
  {
    icon: Zap,
    title: 'AI Deal Matching',
    desc: 'AI matches your deals to the highest-probability buyers based on historical acceptance rates.',
    tag: 'AI',
  },
  {
    icon: Building2,
    title: 'Title & Closing Integrations',
    desc: 'One-click title company assignment with real-time closing status across your portfolio.',
    tag: 'Operations',
  },
]

export default function Marketplace() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-[680px]">

        {/* Lock badge */}
        <div className="flex items-center justify-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center"
            style={{ boxShadow: '0 0 40px rgba(201,168,76,0.12)' }}>
            <Lock size={24} className="text-gold" strokeWidth={1.5} />
          </div>
        </div>

        {/* Heading */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <h1 className="text-[32px] font-semibold text-text-primary tracking-tight">Veori Marketplace</h1>
            <span className="text-[11px] font-medium px-3 py-1 rounded-full bg-gold/10 text-gold border border-gold/20">
              Coming Soon
            </span>
          </div>
          <p className="text-[15px] text-text-muted leading-relaxed max-w-[480px] mx-auto">
            The first AI-native wholesale deal exchange. Find buyers, list deals, and close faster — all without leaving Veori.
          </p>
        </div>

        {/* Preview cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {PREVIEW_ITEMS.map((item, i) => {
            const Icon = item.icon
            return (
              <div key={i} className="bg-card border border-border-subtle rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.025]"
                  style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, #C9A84C, transparent)' }} />
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/15 flex items-center justify-center">
                      <Icon size={16} className="text-gold" strokeWidth={1.5} />
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface border border-border-subtle text-text-muted">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-[13px] text-text-muted leading-relaxed">{item.desc}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* CTA */}
        <div className="text-center">
          <p className="text-[13px] text-text-muted">
            Marketplace launches with{' '}
            <span className="text-gold font-medium">Veori Credits</span>
            {' '}— complete lessons in the Academy to get early access.
          </p>
        </div>
      </div>
    </div>
  )
}
