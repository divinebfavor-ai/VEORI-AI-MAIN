import { useEffect, useState } from 'react'

// Below this width the app shell switches to a phone layout: no side panels,
// navigation in a slide-out drawer. Matches Tailwind's md breakpoint.
export const MOBILE_QUERY = '(max-width: 767px)'

export default function useIsMobile() {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_QUERY).matches
  const [isMobile, setIsMobile] = useState(get)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (e) => setIsMobile(e.matches)
    setIsMobile(mql.matches)
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  return isMobile
}
