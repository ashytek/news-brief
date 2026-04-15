"""
Fetches new videos/articles from all active sources.
Returns a list of raw items ready for transcript extraction.
"""

import re
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional

import feedparser
import requests
from bs4 import BeautifulSoup
from googleapiclient.discovery import build

import db
from config import YOUTUBE_API_KEY

_youtube = None


def get_youtube():
    global _youtube
    if _youtube is None:
        _youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
    return _youtube


def resolve_channel_id(handle_or_id: str) -> Optional[str]:
    """Convert HANDLE:@channel to a real UCxxxx channel ID."""
    if handle_or_id.startswith("HANDLE:"):
        handle = handle_or_id.replace("HANDLE:", "").lstrip("@")
        yt = get_youtube()
        res = yt.search().list(
            part="snippet",
            q=handle,
            type="channel",
            maxResults=1
        ).execute()
        items = res.get("items", [])
        if items:
            return items[0]["snippet"]["channelId"]
        return None
    return handle_or_id  # Already a real ID


def fetch_youtube_channel(source: dict, cutoff: datetime) -> list[dict]:
    """Fetch recent videos from a YouTube channel."""
    channel_id_raw = source["youtube_channel_id"]
    if not channel_id_raw:
        return []

    channel_id = resolve_channel_id(channel_id_raw)
    if not channel_id:
        print(f"  ⚠ Could not resolve channel ID for {source['name']}")
        return []

    # Update the DB with the real channel ID if it was a handle placeholder
    if channel_id_raw.startswith("HANDLE:"):
        db.get_db().table("sources").update({
            "youtube_channel_id": channel_id
        }).eq("id", source["id"]).execute()

    yt = get_youtube()
    try:
        res = yt.search().list(
            part="snippet",
            channelId=channel_id,
            order="date",
            type="video",
            publishedAfter=cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
            maxResults=20  # 20 covers channels like Vantage that release 10-13 segments/day
        ).execute()
    except Exception as e:
        print(f"  ✗ YouTube API error for {source['name']}: {e}")
        return []

    items = []
    for item in res.get("items", []):
        vid_id = item["id"]["videoId"]
        snippet = item["snippet"]
        published = datetime.fromisoformat(
            snippet["publishedAt"].replace("Z", "+00:00")
        )
        # Best available thumbnail: high (480×360) → medium → fallback URL
        thumbnails = snippet.get("thumbnails", {})
        thumbnail_url = (
            thumbnails.get("high", {}).get("url") or
            thumbnails.get("medium", {}).get("url") or
            thumbnails.get("default", {}).get("url") or
            f"https://img.youtube.com/vi/{vid_id}/hqdefault.jpg"
        )
        items.append({
            "source_id": source["id"],
            "external_id": vid_id,
            "title": snippet["title"],
            "url": f"https://www.youtube.com/watch?v={vid_id}",
            "published_at": published.isoformat(),
            "transcript_status": "pending",
            "thumbnail_url": thumbnail_url,
        })
    return items


def fetch_google_news_rss(source: dict, cutoff: datetime) -> list[dict]:
    """Fetch articles from Google News RSS."""
    rss_url = source.get("rss_url")
    if not rss_url:
        return []

    feed = feedparser.parse(rss_url)
    items = []
    for entry in feed.entries:
        pub = entry.get("published_parsed")
        if pub:
            published = datetime(*pub[:6], tzinfo=timezone.utc)
            if published < cutoff:
                continue

        url = entry.get("link", "")
        external_id = hashlib.md5(url.encode()).hexdigest()

        items.append({
            "source_id": source["id"],
            "external_id": external_id,
            "title": entry.get("title", "Untitled"),
            "url": url,
            "published_at": datetime(*pub[:6], tzinfo=timezone.utc).isoformat() if pub else datetime.now(timezone.utc).isoformat(),
            "transcript_status": "not_applicable",  # no transcript for articles
        })
    return items


def fetch_website(source: dict, cutoff: datetime) -> list[dict]:
    """Scrape latest articles from a website."""
    website_url = source.get("website_url")
    if not website_url:
        return []

    try:
        resp = requests.get(website_url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)"
        })
        resp.raise_for_status()
    except Exception as e:
        print(f"  ✗ Website fetch error for {source['name']}: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    items = []

    # Try common article link patterns
    links = soup.select("article a[href], .post a[href], .entry a[href], h2 a[href], h3 a[href]")
    seen = set()
    for link in links[:10]:
        href = link.get("href", "")
        if not href or href in seen:
            continue
        seen.add(href)

        # Make absolute URL
        if href.startswith("/"):
            from urllib.parse import urlparse
            parsed = urlparse(website_url)
            href = f"{parsed.scheme}://{parsed.netloc}{href}"

        title = link.get_text(strip=True)
        if len(title) < 10:
            continue

        external_id = hashlib.md5(href.encode()).hexdigest()
        items.append({
            "source_id": source["id"],
            "external_id": external_id,
            "title": title,
            "url": href,
            "published_at": datetime.now(timezone.utc).isoformat(),
            "transcript_status": "not_applicable",
        })

    return items[:5]  # Max 5 articles per website scrape


def fetch_all_sources() -> tuple[list[dict], dict]:
    """
    Fetch new items from all active sources.
    Returns (new_video_records, stats)
    """
    sources = db.get_active_sources()
    new_items = []
    stats = {"sources_checked": 0, "videos_found": 0}

    for source in sources:
        source_lookback = source.get("lookback_hours") or 24
        cutoff = datetime.now(timezone.utc) - timedelta(hours=source_lookback)
        print(f"→ Checking {source['name']} ({source['category']}, lookback={source_lookback}h)")
        stats["sources_checked"] += 1

        try:
            if source["source_type"] == "youtube_channel":
                items = fetch_youtube_channel(source, cutoff)
            elif source["source_type"] == "google_news_rss":
                items = fetch_google_news_rss(source, cutoff)
            elif source["source_type"] == "website_scrape":
                items = fetch_website(source, cutoff)
            else:
                items = []

            # Filter out already-seen items
            fresh = []
            for item in items:
                if not db.video_exists(source["id"], item["external_id"]):
                    fresh.append(item)

            if fresh:
                print(f"  ✓ {len(fresh)} new items")
                db.mark_source_success(source["id"])
            else:
                print(f"  · No new items")
                db.mark_source_success(source["id"])

            new_items.extend(fresh)
            stats["videos_found"] += len(fresh)

        except Exception as e:
            print(f"  ✗ Error: {e}")
            db.mark_source_failure(source["id"])

    return new_items, stats
