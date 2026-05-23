export function SkeletonCard() {
  return (
    <div className="relative rounded-2xl ring-1 ring-slate-800 bg-slate-900/60 overflow-hidden">
      {/* Accent bar placeholder */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-800 animate-pulse" />
      <div className="aspect-video bg-slate-800/60 animate-pulse" />
      <div className="pl-5 pr-4 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-20 bg-slate-800 rounded-full animate-pulse" />
          <div className="h-3 w-16 bg-slate-800 rounded-full animate-pulse" />
          <div className="h-3 w-12 bg-slate-800 rounded-full animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-5 w-full bg-slate-800 rounded animate-pulse" />
          <div className="h-5 w-4/5 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="h-3.5 w-full bg-slate-800/60 rounded animate-pulse" />
        <div className="space-y-2 pt-1">
          <div className="h-3 w-full bg-slate-800/60 rounded animate-pulse" />
          <div className="h-3 w-11/12 bg-slate-800/60 rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-slate-800/60 rounded animate-pulse" />
        </div>
      </div>
    </div>
  )
}
