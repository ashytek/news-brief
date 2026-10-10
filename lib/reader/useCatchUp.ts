import { useCallback, useEffect, useState } from 'react'
import { decideCatchUp, type CatchUpReason } from './catchUp'

/** If the data the unread clause needs has not arrived by now, the feed shows
 *  normally rather than waiting for ever. */
const GIVE_UP_MS = 4000

/** 'pending' while the automatic decision is still being made (the feed shows its
 *  skeleton and loads nothing), then 'on' or 'off'. */
export type CatchUpMode = 'pending' | 'on' | 'off'

type Decision = { on: boolean; reason: 'away' | 'unread' | null }

/**
 * Whether the catch-up view is showing (Ash, 3 Oct 2026): it switches itself on after
 * 24 h away or with 40+ unread, and the Brief | Catch-up toggle (or "Normal feed")
 * overrides that until the app is reopened. The automatic decision is made **once**:
 * reading stories lowers the unread count, and the view must not flip away under you.
 *
 * "Away" is known as soon as the previous visit has been read; the unread clause needs
 * the read marks, the mutes and the unread pool (`ready`), so a short absence waits for
 * them. One state for every tab: Today and each Sections feed share it.
 */
export function useCatchUp({ enabled, visitReady, prevVisit, ready, unreadCount }: {
  /** The Reader has been opened (the provider is inert before that). */
  enabled: boolean
  visitReady: boolean
  prevVisit: number | null
  /** Read marks, mutes and the unread pool are all loaded. */
  ready: boolean
  unreadCount: number | null
}) {
  const [decision, setDecision] = useState<Decision | null>(null)
  const [override, setOverride] = useState<boolean | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect -- the one-off automatic decision,
     made when the inputs it needs (previous visit, unread pool) have arrived */
  useEffect(() => {
    if (!enabled || !visitReady || decision) return
    const now = Date.now()
    const away = decideCatchUp({ prevVisit, now, unreadCount: null })
    if (away.on) setDecision(away)
    else if (ready) setDecision(decideCatchUp({ prevVisit, now, unreadCount }))
  }, [enabled, visitReady, prevVisit, ready, unreadCount, decision])

  useEffect(() => {
    if (!enabled || decision) return
    const t = setTimeout(() => setDecision(d => d ?? { on: false, reason: null }), GIVE_UP_MS)
    return () => clearTimeout(t)
  }, [enabled, decision])
  /* eslint-enable react-hooks/set-state-in-effect */

  const mode: CatchUpMode =
    override !== null ? (override ? 'on' : 'off')
    : decision === null ? 'pending'
    : decision.on ? 'on' : 'off'
  const reason: CatchUpReason | null = mode !== 'on' ? null : decision?.on ? decision.reason ?? 'manual' : 'manual'

  const setOn = useCallback((on: boolean) => setOverride(on), [])
  /** Forget the decision and any toggle, as if the app had just been opened (the
   *  app came back after 24 h or more: see resume.ts). It is made again from the
   *  previous visit, which the caller has already moved. */
  const reset = useCallback(() => { setDecision(null); setOverride(null) }, [])
  return { mode, reason, on: mode === 'on', pending: mode === 'pending', setOn, reset }
}
