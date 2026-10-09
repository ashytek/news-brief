/**
 * The one category map. Everything that names, orders, labels or colours a
 * category reads it from here — it replaced six hand-kept copies that had
 * drifted (`India/Global` vs `India & Global`, `Prophetic Word`, a separate
 * colour table per screen).
 *
 * `mark` is the design-system colour (`--color-cat-*` in globals.css): an 8 px
 * dot and kicker text, never a fill. (The `legacy` slate/violet/amber/emerald
 * classes the old cards used were deleted with them in roadmap session 4.)
 */
import type { Category } from './types'

export interface CategoryMeta {
  key: Category
  /** Full name, used wherever there is room: "India & Global". */
  label: string
  /** Short name for tight spots: "India". */
  shortLabel: string
  /** Design-system tokens — pair the dot with the kicker text. */
  mark: { dot: string; text: string }
}

export const CATEGORIES: readonly CategoryMeta[] = [
  {
    key: 'prophetic',
    label: 'Prophetic',
    shortLabel: 'Prophetic',
    mark: { dot: 'bg-cat-prophetic', text: 'text-cat-prophetic' },
  },
  {
    key: 'israel',
    label: 'Israel',
    shortLabel: 'Israel',
    mark: { dot: 'bg-cat-israel', text: 'text-cat-israel' },
  },
  {
    key: 'india_global',
    label: 'India & Global',
    shortLabel: 'India',
    mark: { dot: 'bg-cat-india', text: 'text-cat-india' },
  },
  {
    key: 'tech_ai',
    label: 'Tech & AI',
    shortLabel: 'Tech',
    mark: { dot: 'bg-cat-tech', text: 'text-cat-tech' },
  },
]

export const CATEGORY_KEYS: readonly Category[] = CATEGORIES.map(c => c.key)

const BY_KEY = new Map<string, CategoryMeta>(CATEGORIES.map(c => [c.key, c]))

/** Meta for a category key, or undefined for an unknown string (the database
 *  column is plain text, so callers that take a `string` get a safe lookup). */
export function categoryMeta(key: string | null | undefined): CategoryMeta | undefined {
  return key ? BY_KEY.get(key) : undefined
}

/** Display name, falling back to the raw key for a category added later. */
export function categoryLabel(key: string | null | undefined): string {
  return categoryMeta(key)?.label ?? key ?? ''
}

/** Same lookup for a key already known to be a `Category`. */
export function getCategory(key: Category): CategoryMeta {
  return BY_KEY.get(key)!
}
