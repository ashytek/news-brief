'use client'

import { useState } from 'react'

interface Props {
  isRead: boolean
  onRead: () => void
  onEngagement: (signal: string) => void
  onMuteTopic?: () => void
  canMute?: boolean
}

export function EngagementBar({ isRead, onRead, onEngagement, onMuteTopic, canMute }: Props) {
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)
  const [muted, setMuted] = useState(false)

  const handleLike = () => {
    if (liked) return
    setLiked(true)
    setDisliked(false)
    onEngagement('like')
  }
  const handleDislike = () => {
    if (disliked) return
    setDisliked(true)
    setLiked(false)
    onEngagement('dislike')
  }
  const handleRead = () => {
    onRead()
  }
  const handleMute = () => {
    if (muted || !onMuteTopic) return
    setMuted(true)
    onMuteTopic()
    onEngagement('mute_topic')
  }

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-800/60">
      <button
        onClick={handleLike}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
          liked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill={liked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
        </svg>
        More like this
      </button>

      <button
        onClick={handleDislike}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
          disliked ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill={disliked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
        </svg>
        Less
      </button>

      {canMute && (
        <button
          onClick={handleMute}
          disabled={muted}
          title="Mute this topic for 2 weeks"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            muted ? 'bg-gray-800/60 text-gray-600' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          {muted ? 'Muted' : 'Mute topic'}
        </button>
      )}

      <div className="flex-1" />

      {!isRead && (
        <button
          onClick={handleRead}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 text-gray-500 hover:text-gray-300 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Mark read
        </button>
      )}
      {isRead && (
        <span className="flex items-center gap-1 text-xs text-gray-600">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Read
        </span>
      )}
    </div>
  )
}
