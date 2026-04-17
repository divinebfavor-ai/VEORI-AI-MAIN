/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#050A14',
        surface: '#0D1421',
        card: '#111B2E',
        elevated: '#162035',
        'border-subtle': '#1E2D45',
        'border-default': '#243550',
        primary: '#3B82F6',
        'primary-hover': '#2563EB',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        hot: '#F97316',
        'text-primary': '#F8FAFC',
        'text-secondary': '#94A3B8',
        'text-muted': '#475569',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    }
  },
  plugins: [],
}
