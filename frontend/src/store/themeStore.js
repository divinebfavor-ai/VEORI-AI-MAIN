import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

async function persistThemeToDB(theme) {
  try {
    const token = localStorage.getItem('veori_token')
    if (!token) return
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    await fetch(`${base}/api/operator/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ theme, dark_mode: theme === 'dark' }),
    })
  } catch {}
}

async function loadThemeFromDB() {
  try {
    const token = localStorage.getItem('veori_token')
    if (!token) return null
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${base}/api/operator/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const { preferences } = await res.json()
    return preferences?.theme || (preferences?.dark_mode === false ? 'light' : 'dark')
  } catch {
    return null
  }
}

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'dark',

      toggleTheme: async () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ theme: next })
        await persistThemeToDB(next)
      },

      setTheme: async (theme) => {
        applyTheme(theme)
        set({ theme })
        await persistThemeToDB(theme)
      },

      // Detect OS preference on first visit (before user sets preference)
      detectOSPreference: () => {
        const stored = localStorage.getItem('veori-theme')
        if (stored) return
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
        const theme = prefersDark ? 'dark' : 'light'
        applyTheme(theme)
        set({ theme })
      },

      // Sync from DB on login — DB wins over localStorage
      syncFromDB: async () => {
        const dbTheme = await loadThemeFromDB()
        if (dbTheme) {
          applyTheme(dbTheme)
          set({ theme: dbTheme })
        }
      },

      init: () => {
        applyTheme(get().theme)
      },
    }),
    {
      name: 'veori-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    }
  )
)

export default useThemeStore
