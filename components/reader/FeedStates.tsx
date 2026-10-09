import { CircleCheck, Inbox, TriangleAlert } from 'lucide-react'
import { StateMessage } from '@/components/ui'
import { StorySkeleton } from '@/components/story/StorySkeleton'

/** Loading, error and empty views for a Sections feed. The Today feed words its
 *  own, for the brief. */

export function FeedLoading() {
  return <StorySkeleton />
}

export function FeedLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <StateMessage
      tone="error"
      icon={TriangleAlert}
      title="Couldn't load this feed"
      action={{ label: 'Try again', onClick: onRetry }}
    >
      Something went wrong fetching stories. Check the pipeline status in the top bar, or try again.
    </StateMessage>
  )
}

export function FeedEmpty({ showUnreadOnly, onShowAll }: { showUnreadOnly: boolean; onShowAll: () => void }) {
  return showUnreadOnly ? (
    <StateMessage
      tone="ok"
      icon={CircleCheck}
      title="All caught up"
      action={{ label: 'Show all stories', onClick: onShowAll }}
    >
      You&apos;ve read everything here. New stories arrive every 6 hours.
    </StateMessage>
  ) : (
    <StateMessage icon={Inbox} title="Nothing here yet">
      The pipeline will fill this section on its next run.
    </StateMessage>
  )
}
