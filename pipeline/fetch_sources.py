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


def _fetch_via_uploads_playlist(channel_id: str, source: dict, cutoff: datetime) -> list[dict]:
    """
    Fetch recent videos via the channel's uploads playlist, paginating until
    we either hit the cutoff date or reach MAX_PAGES pages.

    High-volume channels (e.g. Firstpost) upload 100+ videos per day, so
    Vantage segments get buried past position 50 quickly. Paginating up to
    200 videos (4 pages × 50) costs only 4 quota units vs 100 for search.list.

    Stops early once the oldest item on a page is before the cutoff — no point
    fetching further back than our lookback window.
    """
    MAX_PAGES = 4  # 4 × 50 = 200 videos, 4 quota units total

    yt = get_youtube()
    uploads_id = "UU" + channel_id[2:] if channel_id.startswith("UC") else None
    if not uploads_id:
        return []

    title_filter = source.get("title_filter")
    items = []
    page_token = None

    for page in range(MAX_PAGES):
        try:
            kwargs: dict = {
                "part":       "snippet,contentDetails",
                "playlistId": uploads_id,
                "maxResults": 50,
            }
            if page_token:
                kwargs["pageToken"] = page_token

            res = yt.playlistItems().list(**kwargs).execute()
        except Exception as e:
            print(f"  ⚠ Uploads playlist fetch failed for {source['name']} (page {page+1}): {e}")
            break

        page_items = res.get("items", [])
        oldest_on_page = None

        for it in page_items:
            sn = it.get("snippet", {})
            cd = it.get("contentDetails", {})
            vid_id = cd.get("videoId") or sn.get("resourceId", {}).get("videoId")
            if not vid_id:
                continue

            published_str = cd.get("videoPublishedAt") or sn.get("publishedAt")
            try:
                published = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
            except Exception:
                continue

            if oldest_on_page is None or published < oldest_on_page:
                oldest_on_page = published

            if published < cutoff:
                continue

            title = sn.get("title", "Untitled")
            if title.startswith("LIVE") or " LIVE " in title or " LIVE:" in title:
                continue
            if title_filter and title_filter.lower() not in title.lower():
                continue

            thumbs = sn.get("thumbnails", {})
            thumb_url = (
                (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url")
                or f"https://img.youtube.com/vi/{vid_id}/hqdefault.jpg"
            )

            items.append({
                "source_id": source["id"],
                "external_id": vid_id,
                "title": title,
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "published_at": published.isoformat(),
                "transcript_status": "pending",
                "thumbnail_url": thumb_url,
            })

        # Stop paginating once oldest item on this page is before the cutoff —
        # everything further back is definitely outside our lookback window.
        if oldest_on_page and oldest_on_page < cutoff:
            break

        page_token = res.get("nextPageToken")
        if not page_token:
            break

    return items


def fetch_youtube_channel(source: dict, cutoff: datetime) -> list[dict]:
    """
    Fetch recent videos from a YouTube channel.

    Default: free RSS feed (15 items, zero API quota).
    When `title_filter` is set: use the channel's uploads playlist via the
      YouTube Data API (50 items, 1 quota unit) — RSS misses filtered items
      when the channel uploads many LIVE streams that crowd out segments.
    """
    channel_id_raw = source["youtube_channel_id"]
    if not channel_id_raw:
        return []

    channel_id = resolve_channel_id(channel_id_raw)
    if not channel_id:
        print(f"  ⚠ Could not resolve channel ID for {source['name']}")
        return []

    # Persist resolved ID back to DB if it was a handle placeholder
    if channel_id_raw.startswith("HANDLE:"):
        db.get_db().table("sources").update({
            "youtube_channel_id": channel_id
        }).eq("id", source["id"]).execute()

    # ── Uploads playlist for ALL YouTube sources ──────────────────────────
    # Costs 1–4 quota units per source (vs 0 for RSS) but gives 50–200 videos
    # instead of 15, preventing segments from being buried on high-volume
    # channels. With 7 sources × 4 runs/day = at most 112 units/day (quota
    # limit is 10,000). Pagination only kicks in for title_filter sources
    # (MAX_PAGES=4); others stop at page 1 unless content is within cutoff.
    return _fetch_via_uploads_playlist(channel_id, source, cutoff)


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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
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
