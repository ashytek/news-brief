import { useEffect, useRef, useState } from 'react'

/** Pull-to-refresh: drag down ≥ 90 px from the very top of the feed.
 *  Window-level listeners so it works regardless of which card is under
 *  the thumb; passive handlers keep scrolling at 60fps. Returns whether a
 *  pull-triggered refresh is in flight. */
export function usePullToRefresh({ loading, onRefresh }: { loading: boolean; onRefresh: () => Promise<unknown> }) {
  const pullStartY = useRef<number | null>(null)
  const [pullRefreshing, setPullRefreshing] = useState(false)

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      pullStartY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (pullStartY.current == null) return
      const dy = e.changedTouches[0].clientY - pullStartY.current
      pullStartY.current = null
      if (dy > 90 && window.scrollY <= 0 && !loading && !pullRefreshing) {
        setPullRefreshing(true)
        onRefresh().finally(() => setPullRefreshing(false))
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onRefresh, loading, pullRefreshing])

  return pullRefreshing
}
