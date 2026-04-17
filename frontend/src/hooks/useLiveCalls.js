import { useState, useEffect } from 'react'
import { calls } from '../services/api'

export function useLiveCalls() {
  const [liveCalls, setLiveCalls] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const fetchLive = async () => {
      try {
        const res = await calls.getLiveCalls()
        if (mounted) {
          setLiveCalls(res.data?.calls || res.data || [])
          setIsLoading(false)
        }
      } catch {
        if (mounted) setIsLoading(false)
      }
    }

    fetchLive()
    const interval = setInterval(fetchLive, 3000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { calls: liveCalls, isLoading }
}
