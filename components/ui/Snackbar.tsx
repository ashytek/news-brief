'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export interface SnackbarOptions {
  message: string
  /** Optional single action ("Undo"). Runs, then the bar closes. */
  actionLabel?: string
  onAction?: () => void
  /** ms before it closes by itself. Default 6000. */
  duration?: number
}

interface SnackbarApi {
  show: (o: SnackbarOptions) => void
  dismiss: () => void
}

const Ctx = createContext<SnackbarApi | null>(null)

/** Provides `useSnackbar()`. One bar at a time: a new `show()` replaces the
 *  current one and restarts the timer. Mount once, high in the tree.
 *  The action button closes the bar *before* running its callback, so the
 *  callback may `show()` a follow-up ("Undone") without it being wiped. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<SnackbarOptions | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const dismiss = useCallback(() => { clear(); setItem(null) }, [])
  const show = useCallback((o: SnackbarOptions) => {
    clear()
    setItem(o)
    timer.current = setTimeout(() => setItem(null), o.duration ?? 6000)
  }, [])
  useEffect(() => clear, [])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* The live region exists before its content does, so screen readers
          announce the message when it appears. Sits above the bottom nav (on desktop there is none: bottom of the page, clear of the rail). */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-gutter bottom-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px))] z-[60] mb-3 flex justify-center desk:bottom-0 desk:left-[calc(var(--spacing-rail)+var(--spacing-gutter))]"
      >
        {item && (
          <div className="pointer-events-auto flex min-h-12 w-full max-w-md items-center gap-3 rounded-panel bg-fg-1 py-1 pl-4 pr-1 shadow-snackbar">
            <p className="t-label flex-1 text-canvas">{item.message}</p>
            {item.actionLabel && (
              <button
                type="button"
                onClick={() => { dismiss(); item.onAction?.() }}
                className="min-h-11 rounded-full px-3 text-sm font-semibold text-[#5b3fc4] active:opacity-70"
              >
                {item.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}

export function useSnackbar(): SnackbarApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useSnackbar must be used inside <SnackbarProvider>')
  return api
}
