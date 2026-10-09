'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/reader`,
        // Personal single-user app — block anyone who isn't already a
        // registered user from self-signing-up via the magic link.
        shouldCreateUser: false,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-gutter py-10">
      <div className="w-full max-w-[360px]">
        {/* Brand */}
        <div className="mb-9 text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-4 grid size-12 place-items-center rounded-[13px] bg-accent-fill font-serif text-[26px] font-bold leading-none text-on-accent"
          >
            N
          </span>
          <h1 className="font-serif text-[28px] font-semibold leading-8 tracking-[-0.01em]">NewsBrief</h1>
          <p className="t-standfirst mt-2">Your daily brief from the channels you follow.</p>
        </div>

        {sent ? (
          <div role="status" className="rounded-panel bg-surface-1 p-6 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-panel bg-ok/10 text-ok ring-1 ring-ok/30">
              <Mail className="size-6" aria-hidden="true" />
            </div>
            <h2 className="t-h3 mb-2">Check your email</h2>
            <p className="t-meta">
              We sent a sign-in link to <span className="text-fg-1">{email}</span>. Open it in this browser. No password needed.
            </p>
            <Button variant="text" className="mt-3" onClick={() => setSent(false)}>Try a different email</Button>
          </div>
        ) : (
          <form onSubmit={handleSignIn}>
            <label htmlFor="email" className="t-label mb-1.5 block text-fg-2">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="h-12 w-full rounded-panel bg-surface-2 px-3.5 text-base text-fg-1 placeholder:text-fg-3 focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent"
            />

            {error && <p role="alert" className="mt-3 rounded-control bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

            <Button type="submit" block loading={loading} disabled={!email} className="mt-4">
              {loading ? 'Sending…' : 'Email me a sign-in link'}
            </Button>

            <p className="t-meta mt-4 text-center">No password needed.</p>
          </form>
        )}
      </div>
    </main>
  )
}
