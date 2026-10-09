import { SkeletonCard } from '@/components/SkeletonCard'

/** Loading, error and empty views for a category feed (markup moved unchanged
 *  from ReaderClient). The Today feed keeps its own, worded for the brief. */

export function FeedLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  )
}

export function FeedLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-center py-20 px-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-500/10 ring-1 ring-rose-500/30 mb-4">
        <svg className="w-8 h-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <p className="text-base font-semibold text-rose-200">Couldn&apos;t load this feed</p>
      <p className="text-sm text-slate-400 mt-1.5 max-w-xs mx-auto">
        Something went wrong fetching stories — check the pipeline status above, or try refreshing.
      </p>
      <button
        onClick={onRetry}
        className="mt-5 text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
      >
        Try again
      </button>
    </div>
  )
}

export function FeedEmpty({ showUnreadOnly, onShowAll }: { showUnreadOnly: boolean; onShowAll: () => void }) {
  return (
    <div className="text-center py-20 px-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/60 ring-1 ring-slate-700/60 mb-4">
        {showUnreadOnly ? (
          <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )}
      </div>
      <p className="text-base font-semibold text-slate-200">
        {showUnreadOnly ? 'All caught up' : 'Nothing here yet'}
      </p>
      <p className="text-sm text-slate-400 mt-1.5 max-w-xs mx-auto">
        {showUnreadOnly
          ? "You've read everything in this category. New stories arrive every 6 hours."
          : 'The pipeline will populate this category on its next run.'}
      </p>
      {showUnreadOnly && (
        <button
          onClick={onShowAll}
          className="mt-5 text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors inline-flex items-center gap-1"
        >
          Show all stories
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      )}
    </div>
  )
}
