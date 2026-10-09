/** Loading placeholder: the shape of a standard card (kicker, two-line headline
 *  with a thumbnail, three lines of text), hairline-separated like the real ones. */
export function StorySkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading stories" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-hairline py-5">
          <div className="mb-3 h-3 w-40 animate-pulse rounded-full bg-surface-2" />
          <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-3.5">
            <div className="space-y-2.5">
              <div className="h-[19px] w-full animate-pulse rounded bg-surface-2" />
              <div className="h-[19px] w-4/5 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-32 animate-pulse rounded-full bg-surface-1" />
            </div>
            <div className="aspect-video animate-pulse rounded-control bg-surface-2" />
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="h-3.5 w-full animate-pulse rounded bg-surface-1" />
            <div className="h-3.5 w-11/12 animate-pulse rounded bg-surface-1" />
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-1" />
          </div>
        </div>
      ))}
    </div>
  )
}
