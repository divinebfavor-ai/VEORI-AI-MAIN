import { create } from 'zustand'

const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  hydrated: false,           // true once localStorage has been read

  setAuth: (user, token) => {
    localStorage.setItem('veori_token', token)
    localStorage.setItem('veori_user', JSON.stringify(user))
    set({ user, token, isAuthenticated: true })
  },

  clearAuth: () => {
    localStorage.removeItem('veori_token')
    localStorage.removeItem('veori_user')
    set({ user: null, token: null, isAuthenticated: false })
  },

  loadFromStorage: () => {
    const token   = localStorage.getItem('veori_token')
    const userStr = localStorage.getItem('veori_user')
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr)
        set({ user, token, isAuthenticated: true, hydrated: true })
        return
      } catch {
        localStorage.removeItem('veori_token')
        localStorage.removeItem('veori_user')
      }
    }
    set({ hydrated: true })
  },
}))

// Hydrate synchronously on module load
useAuthStore.getState().loadFromStorage()

export default useAuthStore
