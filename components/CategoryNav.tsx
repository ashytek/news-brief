'use client'

import type { Category, Cluster, Story } from '@/lib/types'

const COLOR_MAP: Record<string, string> = {
  violet: 'text-violet-400 border-violet-500',
  blue:   'text-blue-400 border-blue-500',
  amber:  'text-amber-400 border-amber-500',
  emerald: 'text-emerald-400 border-emerald-500',
}

interface Props {
  categories: { key: Category; label: string; color: string }[]
  active: Category
  onChange: (c: Category) => void
  readIds: Set<string>
  clusters: Cluster[]
  soloStories: Story[]
}

export function CategoryNav({ categories, active, onChange, readIds, clusters, soloStories }: Props) {
  return (
    <div className="flex overflow-x-auto scrollbar-hide border-t border-gray-800/40">
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
    </div>
  )
}
