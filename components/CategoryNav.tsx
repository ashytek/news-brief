'use client'

import type { Category } from '@/lib/types'

const COLOR_MAP: Record<string, { text: string; bg: string; ring: string; border: string }> = {
  violet:  { text: 'text-violet-200',  bg: 'bg-violet-500/20',  ring: 'ring-violet-500/40',  border: 'border-violet-500' },
  blue:    { text: 'text-blue-200',    bg: 'bg-blue-500/20',    ring: 'ring-blue-500/40',    border: 'border-blue-500' },
  amber:   { text: 'text-amber-200',   bg: 'bg-amber-500/20',   ring: 'ring-amber-500/40',   border: 'border-amber-500' },
  emerald: { text: 'text-emerald-200', bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/40', border: 'border-emerald-500' },
  rose:    { text: 'text-rose-200',    bg: 'bg-rose-500/20',    ring: 'ring-rose-500/40',    border: 'border-rose-500' },
}

const TAB_ICONS: Record<string, string> = {
  today:       'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  prophetic:   'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  israel:      'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  india_global:'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  tech_ai:     'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  topics:      'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
}

const SHORT_LABELS: Record<string, string> = {
  today:       'Today',
  prophetic:   'Prophetic',
  israel:      'Israel',
  india_global:'India',
  tech_ai:     'Tech',
  topics:      'Topics',
}

export type ActiveTab = Category | 'topics' | 'today'

interface Props {
  categories: { key: Category; label: string; color: string }[]
  active: ActiveTab
  onChange: (c: ActiveTab) => void
  topicCount?: number
  todayUnread?: number
}

function NavButton({ id, label, icon, isActive, color, badge, onClick }: {
  id: string
  label: string
  icon: string
  isActive: boolean
  color: keyof typeof COLOR_MAP | 'gray'
  badge?: number
  onClick: () => void
}) {
  const palette = color === 'gray'
    ? { text: 'text-white', bg: 'bg-slate-700/40', ring: 'ring-slate-500/40', border: 'border-slate-500' }
    : COLOR_MAP[color]

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[60px] py-2 px-1 transition-all`}
    >
      <div className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
        isActive ? `${palette.bg} ${palette.text} ring-1 ${palette.ring}` : 'text-slate-400 hover:text-slate-200'
      }`}>
        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive ? 2 : 1.6} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
        <span className="text-[10px] font-semibold leading-none">{SHORT_LABELS[id] ?? label}</span>
      </div>
      {badge != null && badge > 0 && (
        <span className="absolute top-1 right-[calc(50%-22px)] min-w-[16px] h-4 text-[9px] font-bold bg-rose-500 text-white rounded-full flex items-center justify-center px-1 ring-2 ring-slate-950">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

export function CategoryNav({ categories, active, onChange, topicCount, todayUnread }: Props) {
  const allTabs = [
    { id: 'today' as ActiveTab, label: 'Today', color: 'gray' as const, badge: todayUnread },
    ...categories.map(c => ({ id: c.key as ActiveTab, label: c.label, color: c.color as keyof typeof COLOR_MAP, badge: undefined })),
    { id: 'topics' as ActiveTab, label: 'Topics', color: 'rose' as const, badge: topicCount },
  ]

  return (
    <>
      {/* ── Mobile: fixed bottom nav ──────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-md border-t border-slate-800/80 flex safe-area-inset-bottom shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.6)]">
        {allTabs.map(tab => (
          <NavButton
            key={tab.id}
            id={tab.id}
            label={tab.label}
            icon={TAB_ICONS[tab.id] ?? TAB_ICONS.today}
            isActive={active === tab.id}
            color={tab.color}
            badge={tab.badge}
            onClick={() => onChange(tab.id)}
          />
        ))}
      </nav>

      {/* ── Desktop: horizontal tabs ─────────────────────────────── */}
      <div className="hidden md:flex overflow-x-auto scrollbar-hide border-t border-slate-800/40">
        <button
          onClick={() => onChange('today')}
          className={`flex-shrink-0 px-5 py-3 text-sm font-semibold transition-all border-b-2 flex items-center gap-1.5 ${
            active === 'today' ? 'text-white border-white' : 'text-slate-400 border-transparent hover:text-slate-200'
          }`}
        >
          Today
          {todayUnread != null && todayUnread > 0 && (
            <span className="text-xs bg-rose-500 text-white px-1.5 py-0.5 rounded-full leading-none font-bold">{todayUnread}</span>
          )}
        </button>

        {categories.map(cat => {
          const isActive = cat.key === active
          const palette = COLOR_MAP[cat.color] || COLOR_MAP.violet
          return (
            <button
              key={cat.key}
              onClick={() => onChange(cat.key)}
              className={`flex-shrink-0 px-5 py-3 text-sm font-semibold transition-all border-b-2 ${
                isActive ? `${palette.text} ${palette.border}` : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              {cat.label}
            </button>
          )
        })}

        <button
          onClick={() => onChange('topics')}
          className={`flex-shrink-0 px-5 py-3 text-sm font-semibold transition-all border-b-2 flex items-center gap-1.5 ${
            active === 'topics' ? 'text-rose-200 border-rose-500' : 'text-slate-400 border-transparent hover:text-slate-200'
          }`}
        >
          Topics
          {topicCount != null && topicCount > 0 && (
            <span className="text-xs bg-rose-500/25 text-rose-200 ring-1 ring-rose-500/40 px-1.5 py-0.5 rounded-full leading-none">{topicCount}</span>
          )}
        </button>
      </div>
    </>
  )
}
