/**
 * Intelligence Panel Store
 * Controls what the persistent right-side panel shows.
 * Any page can call setIntel() to populate it.
 */
import { create } from 'zustand'

const useIntelStore = create((set) => ({
  // mode: 'system' | 'lead' | 'call' | 'deal'
  mode: 'system',
  data: null,

  setIntel: (mode, data) => set({ mode, data }),
  clearIntel: () => set({ mode: 'system', data: null }),
}))

export default useIntelStore
