/**
 * Theme Store — dark / light mode
 * Persists preference to localStorage.
 * Applies data-theme attribute on html element.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'dark', // 'dark' | 'light'

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ theme: next })
      },

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },

      // Call on app init to apply saved theme
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
