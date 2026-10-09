import { Play } from 'lucide-react'
import type { StoryWithRelations } from '@/lib/types'
import { formatDuration } from '@/lib/constants'
import { cx } from './cx'

/** The story's video thumbnail, a link to the video with an always-visible play
 *  badge (not hover-only: this is a phone app). `row` is the 104 px thumbnail
 *  beside a headline (`compact` is the 88 px one of the catch-up headline list); `lead` is the full-width 16:9 image of the Today lead card,
 *  with the video length. The headline sits right next to it, so the image
 *  itself is decorative (alt=""). */
export function StoryThumb({ story, isRead = false, size = 'row', className }: {
  story: StoryWithRelations
  isRead?: boolean
  size?: 'row' | 'compact' | 'lead'
  className?: string
}) {
  const video = story.videos
  const lead = size === 'lead'
  // mqdefault is a true 16:9 image; hqdefault carries letterbox bars at 104 px.
  const src = lead ? video?.thumbnail_url : video?.thumbnail_url?.replace('/hqdefault.', '/mqdefault.')
  if (!src) return null

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className={cx('size-full object-cover', isRead && 'opacity-55')} />
  )
  const badge = lead ? (
    <span className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white">
      <Play className="size-3.5 fill-current" aria-hidden="true" />
      {video?.duration_seconds ? formatDuration(video.duration_seconds) : 'Watch'}
    </span>
  ) : (
    <span className="absolute bottom-1.5 left-1.5 grid size-[22px] place-items-center rounded-full bg-black/60 text-white">
      <Play className="ml-px size-[11px] fill-current" aria-hidden="true" />
    </span>
  )

  return (
    <div
      className={cx(
        'relative aspect-video overflow-hidden bg-surface-2',
        lead ? 'w-full rounded-panel' : cx('flex-none rounded-control', size === 'compact' ? 'w-[88px]' : 'w-[104px]'),
        className,
      )}
    >
      {video?.url ? (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Watch on YouTube: ${story.headline}`}
          className="block size-full"
        >
          {img}
          {badge}
        </a>
      ) : img}
    </div>
  )
}
