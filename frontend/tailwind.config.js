/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ─── Backgrounds ─────────────────────────────────────────────────
        bg:       '#000000',
        surface:  '#0C0C0C',
        card:     '#141414',
        elevated: '#1A1A1A',
        // ─── Borders ─────────────────────────────────────────────────────
        'border-subtle':  '#242424',
        'border-default': '#2E2E2E',
        // ─── Accents ─────────────────────────────────────────────────────
        primary:         '#00C37A',
        'primary-hover': '#00A868',
        gold:            '#C9A84C',
        // ─── States ──────────────────────────────────────────────────────
        danger:  '#FF4444',
        warning: '#FF9500',
        success: '#00C37A',
        // ─── Text ────────────────────────────────────────────────────────
        'text-primary':   '#FFFFFF',
        'text-secondary': '#8A8A8A',
        'text-muted':     '#555555',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-dot':      'pulse-dot 2s ease-in-out infinite',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'slide-in-up':    'slide-in-up 0.25s ease-out',
        'fade-in':        'fade-in 0.2s ease-out',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.3' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(24px)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-in-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to:   { transform: 'translateY(0)',   opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
