import { Play } from 'lucide-react'
import { formatTime } from '@/lib/constants'

/** "▶ 3:42": the section's start time, a link into the video at that second.
 *  32 px pill inside a 44 px hit area. */
export function TimestampChip({ videoUrl, seconds }: { videoUrl: string; seconds: number }) {
  const href = `${videoUrl}${videoUrl.includes('?') ? '&' : '?'}t=${Math.floor(seconds)}s`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Play from ${formatTime(seconds)}`}
      className="relative -mt-[5px] inline-flex h-8 flex-none items-center gap-1.5 rounded-full bg-accent-soft pl-2.5 pr-3 text-sm font-medium leading-none tabular-nums text-accent after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] active:opacity-70"
    >
      <Play className="size-3 fill-current" aria-hidden="true" />
      {formatTime(seconds)}
    </a>
  )
}
