"""
Transcript extraction.
Primary: youtube-transcript-api (works on residential IPs).
AssemblyAI fallback: only for non-YouTube direct audio URLs (articles, podcasts).
  — AssemblyAI cannot process YouTube page URLs directly; it needs a raw audio stream.
For non-video sources: scrapes article text.
"""
from __future__ import annotations

import re
import requests
from bs4 import BeautifulSoup

import assemblyai as aai
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

import db
from config import ASSEMBLYAI_API_KEY

_ytt = YouTubeTranscriptApi()

# Errors that mean "this video will never have a transcript" — mark permanent
PERMANENT_ERRORS = (
    "live event",
    "unplayable",
    "disabled",
    "no captions",
    "no subtitle",
)


def extract_video_id(url: str) -> str | None:
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else None


def is_permanent_error(msg: str) -> bool:
    msg_lower = msg.lower()
    return any(p in msg_lower for p in PERMANENT_ERRORS)


def get_youtube_transcript(video_id: str) -> tuple | None:
    """
    Returns (plain_text, segments) or None.
    Raises PermError string if this video will never have a transcript.
    """
    try:
        fetched = _ytt.fetch(video_id, languages=["en", "en-GB", "en-US"])
        segments = [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched]
        plain = " ".join(s["text"] for s in segments)
        return plain, segments
    except (TranscriptsDisabled, NoTranscriptFound):
        return None
    except Exception as e:
        msg = str(e)
        if is_permanent_error(msg):
            raise RuntimeError(f"PERMANENT:{msg}")
        print(f"    youtube-transcript-api error: {e}")
        return None


def get_article_text(url: str, title: str) -> str:
    """For non-video sources: scrape article text."""
    try:
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)"
        })
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        article = soup.find("article") or soup.find("main") or soup
        paragraphs = article.find_all("p")
        text = " ".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 50)
        return f"{title}\n\n{text}" if text else title
    except Exception as e:
        print(f"    Article scrape error: {e}")
        return title


def fetch_transcript(video: dict) -> tuple:
    """
    Returns (transcript_text, status, segments).
    status: fetched | fallback_fetched | failed | no_transcript | not_applicable
    """
    url = video["url"]
    title = video["title"]
    video_id = video.get("video_id")
    transcript_status = video.get("transcript_status", "pending")

    # Non-video sources (articles, RSS)
    if transcript_status == "not_applicable":
        text = get_article_text(url, title)
        return text, "not_applicable", []

    # YouTube videos
    vid_id = extract_video_id(url)
    if not vid_id:
        return None, "failed", []

    print(f"    Fetching transcript for {vid_id}…")

    try:
        result = get_youtube_transcript(vid_id)
    except RuntimeError as e:
        # Permanent failure — live stream, unplayable, etc.
        print(f"    ✗ Permanent failure: {str(e).replace('PERMANENT:', '')[:80]}")
        if video_id:
            db.mark_video_permanent_failure(video_id)
        return None, "no_transcript", []

    if result:
        text, segments = result
        print(f"    ✓ Transcript via youtube-transcript-api ({len(text)} chars)")
        return text, "fetched", segments

    # No transcript available (disabled/not found) — mark permanent, no point retrying
    print(f"    ✗ No transcript available (captions disabled or not found)")
    if video_id:
        db.mark_video_permanent_failure(video_id)
    return None, "no_transcript", []
