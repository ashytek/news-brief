/**
 * The one category map. Everything that names, orders, labels or colours a
 * category reads it from here — it replaces six hand-kept copies that had
 * drifted (`India/Global` vs `India & Global`, `Prophetic Word`, a separate
 * colour table per screen).
 *
 * Two layers of colour live side by side:
 *  - `mark`   — the design-system tokens (`--color-cat-*` in globals.css):
 *               an 8 px dot and kicker text, never a fill. New components use these.
 *  - `legacy` — the slate/violet/amber/emerald classes the pre-redesign cards
 *               and tabs still render with. Kept verbatim so session 3 changes
 *               no pixels; roadmap session 4 (the redesign) deletes this block
 *               along with the components that read it.
 */
import type { Category } from './types'

/** Classes used by the pre-redesign screens. Delete in the redesign (session 4). */
interface LegacyStyle {
  /** Filter pill, selected (Search) */
  pill: string
  /** Plain text colour (Archive/Search labels) */
  text: string
  /** Left accent bar on a card */
  accentBar: string
  /** Hover glow, paired with `.card-rise` */
  glow: string
  /** Bullet / category dot */
  bullet: string
  /** Badge on the Sources screen */
  badge: string
  /** Active tab in CategoryNav */
  tab: { text: string; bg: string; ring: string; border: string }
}

export interface CategoryMeta {
  key: Category
  /** Full name, used wherever there is room: "India & Global". */
  label: string
  /** Bottom-nav name, for four tabs across 360 px: "India". */
  shortLabel: string
  /** Design-system tokens — pair the dot with the kicker text. */
  mark: { dot: string; text: string }
  legacy: LegacyStyle
}

export const CATEGORIES: readonly CategoryMeta[] = [
  {
    key: 'prophetic',
    label: 'Prophetic',
    shortLabel: 'Prophetic',
    mark: { dot: 'bg-cat-prophetic', text: 'text-cat-prophetic' },
    legacy: {
      pill: 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/30',
      text: 'text-violet-300',
      accentBar: 'bg-gradient-to-b from-violet-400 to-violet-600',
      glow: 'card-glow-violet',
      bullet: 'bg-violet-400',
      badge: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
      tab: { text: 'text-violet-200', bg: 'bg-violet-500/20', ring: 'ring-violet-500/40', border: 'border-violet-500' },
    },
  },
  {
    key: 'israel',
    label: 'Israel',
    shortLabel: 'Israel',
    mark: { dot: 'bg-cat-israel', text: 'text-cat-israel' },
    legacy: {
      pill: 'bg-blue-500/25 text-blue-200 ring-1 ring-blue-500/30',
      text: 'text-blue-300',
      accentBar: 'bg-gradient-to-b from-blue-400 to-blue-600',
      glow: 'card-glow-blue',
      bullet: 'bg-blue-400',
      badge: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
      tab: { text: 'text-blue-200', bg: 'bg-blue-500/20', ring: 'ring-blue-500/40', border: 'border-blue-500' },
    },
  },
  {
    key: 'india_global',
    label: 'India & Global',
    shortLabel: 'India',
    mark: { dot: 'bg-cat-india', text: 'text-cat-india' },
    legacy: {
      pill: 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-500/30',
      text: 'text-amber-300',
      accentBar: 'bg-gradient-to-b from-amber-400 to-amber-600',
      glow: 'card-glow-amber',
      bullet: 'bg-amber-400',
      badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      tab: { text: 'text-amber-200', bg: 'bg-amber-500/20', ring: 'ring-amber-500/40', border: 'border-amber-500' },
    },
  },
  {
    key: 'tech_ai',
    label: 'Tech & AI',
    shortLabel: 'Tech',
    mark: { dot: 'bg-cat-tech', text: 'text-cat-tech' },
    legacy: {
      pill: 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-500/30',
      text: 'text-emerald-300',
      accentBar: 'bg-gradient-to-b from-emerald-400 to-emerald-600',
      glow: 'card-glow-emerald',
      bullet: 'bg-emerald-400',
      badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      tab: { text: 'text-emerald-200', bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/40', border: 'border-emerald-500' },
    },
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
