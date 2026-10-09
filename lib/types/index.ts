export type Category = 'prophetic' | 'israel' | 'india_global' | 'tech_ai'

export interface Source {
  id: string
  name: string
  category: Category
  source_type: 'youtube_channel' | 'google_news_rss' | 'website_scrape'
  youtube_channel_id: string | null
  rss_url: string | null
  website_url: string | null
  is_active: boolean
  lookback_hours: number
  last_checked_at: string | null
  last_success_at: string | null
  consecutive_failures: number
  created_at: string
}

export interface Bullet {
  /** Walkthrough section mini-headline (stories summarised after July 2026).
      Absent on older stories — renderers fall back to plain dot bullets. */
  title?: string
  text: string
  timestamp_seconds: number | null
}

/** Skim-card version of a story (~120 words), shown by default in place of
 *  the long overview. Null/absent on stories that haven't been backfilled. */
export interface ShortVersion {
  lead: string
  key_points: string[]
}

/** What a storyline's recap says (pipeline/storylines.py `build_recap`). `so_far`
 *  has one entry per earlier day (empty for a single-day storyline); `latest` is
 *  the newest day's developments; `differ` is optional: disputed figures the day
 *  entries had no room for ("people on board: 174 vs 180"). */
export interface StorylineRecap {
  so_far?: { date: string; text: string }[]
  latest?: { date: string; text: string } | null
  differ?: string[]
}

/** One developing news event with many reports, across sources. The recap exists
 *  only once it has 3+ reports. `recap_story_count` is the count the recap was
 *  built from (the pipeline refreshes it when `story_count` moves on). */
export interface Storyline {
  id: string
  category: Category
  title: string
  recap: StorylineRecap | null
  story_count: number
  recap_story_count: number
  first_report_at: string | null
  last_report_at: string | null
  recap_updated_at: string | null
}

export interface Story {
  id: string
  video_id: string
  source_id: string
  category: Category
  headline: string
  summary: string
  bullets: Bullet[]
  short?: ShortVersion | null
  /** The developing event this story is one report of (news categories only;
   *  null for round-ups, prophetic stories and anything the pipeline hasn't
   *  grouped). Written by pipeline/storylines.py. */
  storyline_id?: string | null
  cluster_id: string | null
  matched_topics: string[] | null
  created_at: string
  source?: Source
  video?: Video
}

export interface Video {
  id: string
  source_id: string
  external_id: string
  title: string
  url: string
  published_at: string
  duration_seconds: number | null
  thumbnail_url: string | null
}

export interface EngagementSignal {
  story_id?: string
  cluster_id?: string
  signal: 'like' | 'dislike' | 'expand_perspectives' | 'dwell_long' | 'dwell_short'
}

// Supabase join relations come back under the table name (videos), not the field name (video).
// The source comes from the `sources` lookup the screens load once (by `source_id`), not from a
// join on every story row (F081).
export interface StoryWithRelations extends Omit<Story, 'video' | 'source'> {
  videos?: Video | null
}
