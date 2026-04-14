"""
Transcript extraction.

Primary (when YOUTUBE_COOKIES_FILE is set): yt-dlp — proper cookie auth, much
better at bypassing YouTube IP rate-limits / residential blocks.

Fallback (no cookies): youtube-transcript-api — fast, no auth, works on fresh
IPs with light traffic.

For non-video sources (articles, RSS): scrapes article text.
"""
from __future__ import annotations

import os
import re
import time
import random
import requests
from bs4 import BeautifulSoup

from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

import db
from config import ASSEMBLYAI_API_KEY, YOUTUBE_COOKIES_FILE

# ---------------------------------------------------------------------------
# Error classification helpers
# ---------------------------------------------------------------------------

# Errors that mean "this video will NEVER have a transcript" — safe to mark permanent
PERMANENT_ERROR_PHRASES = (
    "live event",
    "unplayable",
    "subtitles are disabled",
    "no captions",
    "no subtitle",
    "members only",
    "private video",
    "video unavailable",
)

# Error phrases that indicate a temporary block / rate-limit — must NOT mark permanent
RETRYABLE_ERROR_PHRASES = (
    "blocking requests",
    " ip ",
    "too many",
    "requestblocked",
    "ipblocked",
    "connection",
    "timeout",
    "503",
    "429",
    "sign in",
    "bot",
)


class PermanentNoTranscript(Exception):
    """Raised when a video will never have a usable transcript."""


def is_permanent_error(msg: str) -> bool:
    msg_lower = msg.lower()
    # If it looks retryable (IP block, rate limit), never treat as permanent
    if any(p in msg_lower for p in RETRYABLE_ERROR_PHRASES):
        return False
    return any(p in msg_lower for p in PERMANENT_ERROR_PHRASES)


# ---------------------------------------------------------------------------
# Cookie path resolution
# ---------------------------------------------------------------------------

def _resolve_cookie_path() -> str | None:
    if not YOUTUBE_COOKIES_FILE:
        return None
    path = YOUTUBE_COOKIES_FILE
    if not os.path.isabs(path):
        path = os.path.join(os.path.dirname(__file__), path)
    return path if os.path.exists(path) else None


# ---------------------------------------------------------------------------
# VTT parser — turns a WebVTT subtitle file into (plain_text, segments)
# ---------------------------------------------------------------------------

def _parse_vtt(vtt: str) -> tuple[str, list]:
    segments = []
    lines = vtt.split("\n")
    i = 0
    while i < len(lines):
        if " --> " in lines[i]:
            start_str = lines[i].split(" --> ")[0].strip()
            try:
                parts = start_str.replace(",", ".").split(":")
                if len(parts) == 3:
                    start = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                elif len(parts) == 2:
                    start = float(parts[0]) * 60 + float(parts[1])
                else:
                    start = 0.0
            except Exception:
                start = 0.0
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                clean = re.sub(r"<[^>]+>", "", lines[i]).strip()
                if clean:
                    text_lines.append(clean)
                i += 1
            if text_lines:
                segments.append({"text": " ".join(text_lines), "start": start, "duration": 0})
        else:
            i += 1

    # Deduplicate consecutive identical lines (very common in auto-captions)
    deduped: list[dict] = []
    prev = None
    for seg in segments:
        if seg["text"] != prev:
            deduped.append(seg)
            prev = seg["text"]

    plain = " ".join(s["text"] for s in deduped)
    return plain, deduped


# ---------------------------------------------------------------------------
# yt-dlp transcript fetcher (primary when cookies configured)
# ---------------------------------------------------------------------------

def _get_transcript_ytdlp(video_id: str) -> tuple[str, list] | None:
    """
    Uses yt-dlp to resolve a subtitle URL (authenticated via cookies), then
    downloads and parses the VTT.

    Returns (plain_text, segments) on success.
    Returns None for retryable/network errors.
    Raises PermanentNoTranscript for truly permanent failures.
    """
    try:
        import yt_dlp
    except ImportError:
        print("    yt-dlp not installed — falling back to youtube-transcript-api")
        return _get_transcript_ytt(video_id)

    url = f"https://www.youtube.com/watch?v={video_id}"
    cookie_path = _resolve_cookie_path()

    ydl_opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    if cookie_path:
        ydl_opts["cookiefile"] = cookie_path

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        msg = str(e)
        if is_permanent_error(msg):
            raise PermanentNoTranscript(msg)
        print(f"    yt-dlp info error: {msg[:200]}")
        return None

    # Find a subtitle URL (prefer manual > auto, VTT > other)
    subs      = info.get("subtitles", {}) or {}
    auto_subs = info.get("automatic_captions", {}) or {}
    sub_url   = None

    for lang_key in ["en", "en-US", "en-GB", "en-orig"]:
        for source in [subs, auto_subs]:
            if lang_key not in source:
                continue
            formats = source[lang_key]
            for fmt in formats:
                if fmt.get("ext") == "vtt":
                    sub_url = fmt.get("url")
                    break
            if not sub_url and formats:
                sub_url = formats[0].get("url")
            if sub_url:
                break
        if sub_url:
            break

    if not sub_url:
        raise PermanentNoTranscript("No subtitles available for this video")

    try:
        resp = requests.get(sub_url, timeout=20)
        resp.raise_for_status()
        plain, segments = _parse_vtt(resp.text)
        if not plain.strip():
            raise PermanentNoTranscript("Subtitle file was empty")
        return plain, segments
    except PermanentNoTranscript:
        raise
    except Exception as e:
        print(f"    yt-dlp subtitle download error: {e}")
        return None


# ---------------------------------------------------------------------------
# youtube-transcript-api fetcher (fallback / no-cookie path)
# ---------------------------------------------------------------------------

_ytt = YouTubeTranscriptApi()


def _get_transcript_ytt(video_id: str) -> tuple[str, list] | None:
    """
    Returns (plain_text, segments) on success.
    Returns None for retryable errors.
    Raises PermanentNoTranscript for permanent failures.
    """
    try:
        fetched  = _ytt.fetch(video_id, languages=["en", "en-GB", "en-US"])
        segments = [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched]
        plain    = " ".join(s["text"] for s in segments)
        return plain, segments

    except (TranscriptsDisabled, NoTranscriptFound) as e:
        raise PermanentNoTranscript(str(e))

    except Exception as e:
        msg = str(e)
        if is_permanent_error(msg):
            raise PermanentNoTranscript(msg)
        print(f"    youtube-transcript-api error: {str(e)[:200]}")
        return None


# ---------------------------------------------------------------------------
# Unified public transcript getter
# ---------------------------------------------------------------------------

def get_youtube_transcript(video_id: str) -> tuple[str, list] | None:
    """
    Routes to the best available fetcher:
    - YOUTUBE_COOKIES_FILE set & file exists → yt-dlp (cookie-aware, better bypass)
    - Otherwise → youtube-transcript-api (fast, no auth needed)
    """
    cookie_path = _resolve_cookie_path()
    if cookie_path:
        return _get_transcript_ytdlp(video_id)
    return _get_transcript_ytt(video_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_video_id(url: str) -> str | None:
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else None


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
        article    = soup.find("article") or soup.find("main") or soup
        paragraphs = article.find_all("p")
        text = " ".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 50)
        return f"{title}\n\n{text}" if text else title
    except Exception as e:
        print(f"    Article scrape error: {e}")
        return title


# ---------------------------------------------------------------------------
# Entry point called by run_pipeline.py
# ---------------------------------------------------------------------------

def fetch_transcript(video: dict) -> tuple:
    """
    Returns (transcript_text, status, segments).
    status: fetched | not_applicable | failed | no_transcript
      'failed'        → retryable (IP block, network error)
      'no_transcript' → permanent (captions disabled on this video)
    """
    url               = video["url"]
    title             = video["title"]
    video_id          = video.get("video_id")
    transcript_status = video.get("transcript_status", "pending")

    # Non-video sources (articles, RSS)
    if transcript_status == "not_applicable":
        text = get_article_text(url, title)
        return text, "not_applicable", []

    vid_id = extract_video_id(url)
    if not vid_id:
        return None, "failed", []

    fetcher = "yt-dlp+cookies" if _resolve_cookie_path() else "youtube-transcript-api"
    print(f"    Fetching transcript for {vid_id} via {fetcher}…")

    # Delay to avoid triggering YouTube rate limits
    time.sleep(random.uniform(1.0, 3.0))

    try:
        result = get_youtube_transcript(vid_id)
    except PermanentNoTranscript as e:
        print(f"    ✗ No transcript (permanent): {str(e)[:80]}")
        if video_id:
            db.mark_video_permanent_failure(video_id)
        return None, "no_transcript", []

    if result:
        text, segments = result
        print(f"    ✓ Transcript ({len(text)} chars, {len(segments)} segments)")
        return text, "fetched", segments

    # Retryable — status stays 'failed' so it will be retried next run
    print(f"    ✗ Transcript fetch failed (retryable — IP block or network)")
    return None, "failed", []
