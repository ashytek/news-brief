import type { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/types'

/** The browser Supabase client (a singleton per page load). */
export type Supabase = ReturnType<typeof createClient>

/** What the Reader is showing: the Today brief, the Topics page, or a Sections
 *  feed (`'all'` = every category, otherwise one category). The bottom nav has
 *  three Reader destinations (Today · Sections · Topics); the Sections chip row
 *  picks which feed. */
export type ActiveTab = 'today' | 'topics' | 'all' | Category

/** The Sections feeds: `all` or one category. */
export type SectionKey = 'all' | Category

export const isSection = (t: ActiveTab): t is SectionKey => t !== 'today' && t !== 'topics'
