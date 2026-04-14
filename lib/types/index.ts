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
  text: string
  timestamp_seconds: number | null
}

export interface Story {
  id: string
  video_id: string
  source_id: string
  category: Category
  headline: string
  summary: string
  bullets: Bullet[]
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
}

export interface PerspectiveItem {
  source: string
  angle: string
  timestamp_link: string | null
}

export interface Cluster {
  id: string
  category: Category
  core_fact: string | null
  consensus: string | null
  perspectives: PerspectiveItem[]
  story_count: number
  first_seen_at: string
  last_updated_at: string
  synthesised_at: string | null
  stories?: Story[]
}

export interface EngagementSignal {
  story_id?: string
  cluster_id?: string
  signal: 'like' | 'dislike' | 'expand_perspectives' | 'dwell_long' | 'dwell_short'
}
