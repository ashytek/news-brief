'use client'

import type { Category, Cluster, Story } from '@/lib/types'

const COLOR_MAP: Record<string, string> = {
  violet:  'text-violet-400 border-violet-500',
  blue:    'text-blue-400 border-blue-500',
  amber:   'text-amber-400 border-amber-500',
  emerald: 'text-emerald-400 border-emerald-500',
  rose:    'text-rose-400 border-rose-500',
}

export type ActiveTab = Category | 'topics' | 'today'

interface Props {
  categories: { key: Category; label: string; color: string }[]
  active: ActiveTab
  onChange: (c: ActiveTab) => void
  readIds: Set<string>
  clusters: Cluster[]
  soloStories: Story[]
  topicCount?: number
  todayUnread?: number
}

export function CategoryNav({ categories, active, onChange, readIds, clusters, soloStories, topicCount, todayUnread }: Props) {
  return (
    <div className="flex overflow-x-auto scrollbar-hide border-t border-gray-800/40">
      {/* Today tab — always first */}
      <button
        onClick={() => onChange('today')}
        className={`flex-shrink-0 px-5 py-2.5 text-sm font-medium transition-all border-b-2 flex items-center gap-1.5 ${
          active === 'today'
            ? 'text-white border-white'
            : 'text-gray-500 border-transparent hover:text-gray-300'
        }`}
      >
        Today
        {todayUnread != null && todayUnread > 0 && (
          <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full leading-none">
            {todayUnread}
          </span>
        )}
      </button>

      {categories.map(cat => {
        const isActive = cat.key === active
        const colorClass = COLOR_MAP[cat.color] || 'text-gray-400 border-gray-500'
        return (
          <button
            key={cat.key}
            onClick={() => onChange(cat.key)}
            className={`flex-shrink-0 px-5 py-2.5 text-sm font-medium transition-all border-b-2 ${
              isActive
                ? `${colorClass}`
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >
            {cat.label}
          </button>
        )
      })}

      {/* Topics tab */}
      <button
        onClick={() => onChange('topics')}
        className={`flex-shrink-0 px-5 py-2.5 text-sm font-medium transition-all border-b-2 flex items-center gap-1.5 ${
          active === 'topics'
            ? 'text-rose-400 border-rose-500'
            : 'text-gray-500 border-transparent hover:text-gray-300'
        }`}
      >
        Topics
        {topicCount != null && topicCount > 0 && (
          <span className="text-xs bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded-full leading-none">
            {topicCount}
          </span>
        )}
      </button>
    </div>
  )
}
