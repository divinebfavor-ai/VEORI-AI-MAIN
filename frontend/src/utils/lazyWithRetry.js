import { lazy } from 'react'

// After a deploy, a tab that was already open can request a chunk file whose
// hashed name no longer exists, and the import rejects. Reload once so the tab
// picks up the new build. The session flag stops a reload loop: if the chunk is
// still missing after one reload, the error reaches the app's ErrorBoundary.
const RELOAD_FLAG = 'veori_chunk_reload'

export default function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      const module = await factory()
      try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* storage unavailable */ }
      return module
    } catch (error) {
      let alreadyReloaded = false
      try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1' } catch { /* storage unavailable */ }
      if (!alreadyReloaded) {
        try { sessionStorage.setItem(RELOAD_FLAG, '1') } catch { /* storage unavailable */ }
        window.location.reload()
        return new Promise(() => {})
      }
      throw error
    }
  })
}
