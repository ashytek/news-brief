export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="aspect-video bg-gray-800 animate-pulse" />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-20 bg-gray-800 rounded-full animate-pulse" />
          <div className="h-3 w-16 bg-gray-800 rounded-full animate-pulse" />
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-full bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-4/5 bg-gray-800 rounded animate-pulse" />
        </div>
        <div className="h-3 w-full bg-gray-800/60 rounded animate-pulse" />
        <div className="space-y-2 pt-1">
          <div className="h-3 w-full bg-gray-800/60 rounded animate-pulse" />
          <div className="h-3 w-11/12 bg-gray-800/60 rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-gray-800/60 rounded animate-pulse" />
        </div>
      </div>
    </div>
  )
}
