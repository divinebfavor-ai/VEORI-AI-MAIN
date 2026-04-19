/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ─── System backgrounds (layered depth) ───────────────────────
        bg:  '#0D0D0F',
        s1:  '#111115',
        s2:  '#17171C',
        s3:  '#1E1E25',
        s4:  '#25252E',
        s5:  '#2D2D37',

        // ─── Primary action — electric green ──────────────────────────
        green:        '#00E57A',
        'green-hover':'#00CC6E',

        // ─── Deal / money — gold ───────────────────────────────────────
        gold:  '#D4A843',

        // ─── Alerts ───────────────────────────────────────────────────
        red:   '#FF3B4E',
        amber: '#FF8C00',

        // ─── Text ─────────────────────────────────────────────────────
        t1: '#F0F0F5',
        t2: '#8A8A96',
        t3: '#44444F',
        t4: '#2E2E38',

        // ─── Legacy aliases — keep existing pages working ─────────────
        primary:          '#00E57A',
        'primary-hover':  '#00CC6E',
        danger:           '#FF3B4E',
        warning:          '#FF8C00',
        success:          '#00E57A',
        'text-primary':   '#F0F0F5',
        'text-secondary': '#8A8A96',
        'text-muted':     '#44444F',
        'border-subtle':  '#1E1E25',
        'border-default': '#25252E',
        card:             '#17171C',
        elevated:         '#1E1E25',
        surface:          '#111115',
      },

      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
      },

      borderRadius: {
        DEFAULT: '6px',
        tight:  '4px',
        card:   '8px',
        lg:     '12px',
        xl:     '16px',
        full:   '9999px',
      },

      animation: {
        'pulse-green':  'pulse-green 0.35s ease-out',
        'pulse-red':    'pulse-red 0.35s ease-out',
        'dot-live':     'dot-live 2s ease-in-out infinite',
        'node-breathe': 'node-breathe 3.5s ease-in-out infinite',
        'slide-right':  'slide-right 0.2s ease-out',
        'slide-up':     'slide-up 0.2s ease-out',
        'fade-in':      'fade-in 0.2s ease-out',
        waveform:       'waveform 0.9s ease-in-out infinite',
        // legacy
        'pulse-dot':      'dot-live 2s ease-in-out infinite',
        'slide-in-right': 'slide-right 0.2s ease-out',
        'slide-in-up':    'slide-up 0.2s ease-out',
        'pulse-slow':     'dot-live 3s ease-in-out infinite',
      },

      keyframes: {
        'pulse-green': {
          '0%':   { boxShadow: '0 0 0 0 rgba(0,229,122,0.45)' },
          '100%': { boxShadow: '0 0 0 10px rgba(0,229,122,0)' },
        },
        'pulse-red': {
          '0%':   { boxShadow: '0 0 0 0 rgba(255,59,78,0.45)' },
          '100%': { boxShadow: '0 0 0 10px rgba(255,59,78,0)' },
        },
        'dot-live': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.25' },
        },
        'node-breathe': {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%':      { opacity: '1',    transform: 'scale(1.18)' },
        },
        'slide-right': {
          from: { transform: 'translateX(14px)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-up': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        waveform: {
          '0%, 100%': { transform: 'scaleY(0.14)' },
          '50%':      { transform: 'scaleY(1)' },
        },
      },
    },
  },
  plugins: [],
}
