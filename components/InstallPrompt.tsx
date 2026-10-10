'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'newsbrief_install_dismissed'
const SNOOZE_DAYS = 7

// Only "installed" is permanent — a snoozed timestamp re-offers the prompt
// after SNOOZE_DAYS so a single accidental tap doesn't hide it forever.
function isSnoozed(): boolean {
  const stored = localStorage.getItem(DISMISS_KEY)
  if (!stored) return false
  if (stored === 'installed') return true
  const snoozedAt = Number(stored)
  if (Number.isNaN(snoozedAt)) return false
  return Date.now() - snoozedAt < SNOOZE_DAYS * 24 * 60 * 60 * 1000
}

export function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isSnoozed()) return

    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!prompt || dismissed) return null

  const handleInstall = async () => {
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    setDismissed(true)
    // Only "accepted" is permanent — a swipe-away of the native sheet just snoozes.
    localStorage.setItem(DISMISS_KEY, outcome === 'accepted' ? 'installed' : String(Date.now()))
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  return (
    <div
      role="dialog"
      aria-label="Install the app"
      className="fixed inset-x-gutter bottom-[calc(var(--spacing-navbar)+env(safe-area-inset-bottom,0px)+0.75rem)] z-40 desk:bottom-6 mx-auto flex max-w-md items-start gap-3 rounded-panel bg-surface-2 p-4 shadow-snackbar"
    >
      <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-control bg-accent-fill font-serif text-lg font-bold text-on-accent">N</span>
      <div className="min-w-0 flex-1">
        <p className="t-h3">Add NewsBrief to your home screen</p>
        <p className="t-meta mt-0.5">Opens instantly, like a native app.</p>
        <div className="mt-3 flex gap-2">
          <Button onClick={handleInstall} className="min-h-11 flex-1">Install</Button>
          <Button variant="tonal" onClick={handleDismiss} className="min-h-11 flex-1">Not now</Button>
        </div>
      </div>
    </div>
  )
}
