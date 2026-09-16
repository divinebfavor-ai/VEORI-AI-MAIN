import { create } from 'zustand'
import { branding } from '../services/api'

// Workspace branding (white label). Signed in: the workspace's brand. On a custom
// domain before sign-in: the brand registered (and DNS-verified) for that domain.
const PLATFORM_HOSTS = ['veori.net', 'www.veori.net', 'localhost', '127.0.0.1']

const useBrandStore = create((set, get) => ({
  brand: null,
  loaded: false,

  load: async ({ authenticated }) => {
    try {
      if (authenticated) {
        const r = await branding.get()
        set({ brand: r.data?.data || null, loaded: true })
      } else {
        const host = window.location.hostname
        if (PLATFORM_HOSTS.includes(host) || host.endsWith('.vercel.app')) { set({ brand: null, loaded: true }); return }
        const r = await branding.forDomain(host)
        set({ brand: r.data?.data || null, loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  setBrand: (brand) => set({ brand }),
}))

export default useBrandStore
