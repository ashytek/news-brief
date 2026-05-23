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

import subprocess
import tempfile

from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled, VideoUnavailable

import db
from config import ASSEMBLYAI_API_KEY, YOUTUBE_COOKIES_FILE, YOUTUBE_BROWSER, MIN_VIDEO_DURATION_SECONDS

# ---------------------------------------------------------------------------
# Adaptive rate-limit handling
# ---------------------------------------------------------------------------
#
# YouTube/Google aggressively rate-limit residential IPs that fetch many
# transcripts via timedtext or yt-dlp's VTT path. Once we detect a 429 we
# enter a back-off mode: every subsequent fetch in the same run waits much
# longer, and after N consecutive rate-limits we abort the batch entirely.
#
# Tunable via env var:
#   TRANSCRIPT_BASE_DELAY_MIN / TRANSCRIPT_BASE_DELAY_MAX  — per-request jitter
#   TRANSCRIPT_RATE_LIMIT_COOLDOWN — seconds to wait after a 429 (default 60)
#   HTTP_PROXY / HTTPS_PROXY      — honoured automatically by both libraries
#
# These are read at module load so a single run uses consistent values.

_BASE_DELAY_MIN = float(os.environ.get("TRANSCRIPT_BASE_DELAY_MIN", "5"))
_BASE_DELAY_MAX = float(os.environ.get("TRANSCRIPT_BASE_DELAY_MAX", "12"))
_RATE_LIMIT_COOLDOWN = float(os.environ.get("TRANSCRIPT_RATE_LIMIT_COOLDOWN", "60"))
_MAX_RETRIES_PER_VIDEO = int(os.environ.get("TRANSCRIPT_MAX_RETRIES", "3"))

# Module-level state for in-run backoff. Reset implicitly each pipeline run
# because the module is reloaded by run_pipeline.py's subprocess.
_rate_limit_streak = 0
_last_rate_limit_at: float = 0.0


def _is_rate_limit_error(msg: str) -> bool:
    """Distinguish 429-style rate limits from other retryable errors."""
    m = msg.lower()
    return any(p in m for p in ("429", "too many", "ipblocked", "requestblocked", "rate limit"))


def _record_rate_limit():
    global _rate_limit_streak, _last_rate_limit_at
    _rate_limit_streak += 1
    _last_rate_limit_at = time.time()


def _record_success():
    global _rate_limit_streak
    _rate_limit_streak = 0


def _adaptive_pre_request_delay():
    """
    Sleep before the next request. Length scales with how recently / how many
    times we've been rate-limited:
      streak 0 → normal jittered delay (5–12s)
      streak 1 → cooldown × 1   (60s default)
      streak 2 → cooldown × 2   (120s)
      streak 3+ → cooldown × 4  (240s — last-ditch)
    """
    if _rate_limit_streak == 0:
        time.sleep(random.uniform(_BASE_DELAY_MIN, _BASE_DELAY_MAX))
        return
    multiplier = min(4, 2 ** (_rate_limit_streak - 1))
    wait = _RATE_LIMIT_COOLDOWN * multiplier
    print(f"    ⏸ rate-limit cooldown — waiting {int(wait)}s (streak {_rate_limit_streak})…")
    time.sleep(wait)

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
    "no longer available",                # video deleted by creator after publishing
    "has been removed",                   # YouTube removed for policy
    # The following used to be retryable, but observed behaviour is that they
    # never recover — they sit in the failed pool and poison the retry batch
    # (3 consecutive permanent-error retries → batch abort → no stories).
    # Better to mark permanent immediately and free the retry slots for real
    # transient failures.
    "requested format is not available",  # yt-dlp can't find a downloadable stream
    "no video formats found",             # yt-dlp parsed page but no formats listed
    "premieres in",                       # scheduled future content; never airs reliably
    "this live event has ended",          # post-stream limbo, no captions saved
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
    Uses yt-dlp to download subtitles to a temp dir (fully authenticated via
    browser cookies), then parses the VTT.  Letting yt-dlp do the actual
    download means it carries the right headers/cookies for the timedtext API.

    Cookie auth priority:
      1. YOUTUBE_BROWSER — reads fresh cookies directly from the browser (recommended)
      2. YOUTUBE_COOKIES_FILE — reads from a Netscape cookies.txt file

    Returns (plain_text, segments) on success.
    Returns None for retryable/network errors.
    Raises PermanentNoTranscript for truly permanent failures.
    """
    try:
        import yt_dlp
    except ImportError:
        print("    yt-dlp not installed — falling back to youtube-transcript-api")
        return _get_transcript_ytt(video_id)

    import tempfile, glob

    url = f"https://www.youtube.com/watch?v={video_id}"
    cookie_path = _resolve_cookie_path()

    with tempfile.TemporaryDirectory() as tmpdir:
        ydl_opts: dict = {
            "writesubtitles":    True,
            "writeautomaticsub": True,
            "subtitleslangs":    ["en", "en-US", "en-GB"],
            "subtitlesformat":   "vtt",
            "skip_download":     True,
            "outtmpl":           os.path.join(tmpdir, "%(id)s"),
            "quiet":             True,
            "no_warnings":       True,
        }
        if YOUTUBE_BROWSER:
            ydl_opts["cookiesfrombrowser"] = (YOUTUBE_BROWSER, None, None, None)
        elif cookie_path:
            ydl_opts["cookiefile"] = cookie_path

        # Honour HTTPS_PROXY / HTTP_PROXY for yt-dlp too (Webshare proxies need
        # the WS-specific URL format — set HTTPS_PROXY to that if using Webshare)
        proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
        if proxy_url:
            ydl_opts["proxy"] = proxy_url

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
        except Exception as e:
            msg = str(e)
            if is_permanent_error(msg):
                raise PermanentNoTranscript(msg)
            if _is_rate_limit_error(msg):
                _record_rate_limit()
                print(f"    ⚠ yt-dlp rate-limited: {msg[:160]}")
            else:
                print(f"    yt-dlp download error: {msg[:200]}")
            return None

        # Find the downloaded VTT file (yt-dlp names it <video_id>.<lang>.vtt)
        vtt_files = glob.glob(os.path.join(tmpdir, "*.vtt"))
        if not vtt_files:
            raise PermanentNoTranscript("No subtitles available for this video")

        with open(vtt_files[0], encoding="utf-8") as f:
            vtt_content = f.read()

    plain, segments = _parse_vtt(vtt_content)
    if not plain.strip():
        raise PermanentNoTranscript("Subtitle file was empty")
    _record_success()
    return plain, segments


# ---------------------------------------------------------------------------
# youtube-transcript-api fetcher (fallback / no-cookie path)
# ---------------------------------------------------------------------------
#
# Proxy precedence (highest first):
#   1. WEBSHARE_PROXY_USERNAME + WEBSHARE_PROXY_PASSWORD  (rotating residential
#      proxies; native youtube-transcript-api support, ideal for caption fetches)
#   2. HTTPS_PROXY / HTTP_PROXY env vars (any generic proxy — also picked up
#      automatically by yt-dlp + requests + urllib)
#   3. None — direct connection
#
# Sign up free at https://www.webshare.io for 10 free datacenter proxies, OR
# point HTTPS_PROXY at any rotating residential proxy you already use.

def _build_ytt_client() -> YouTubeTranscriptApi:
    ws_user = os.environ.get("WEBSHARE_PROXY_USERNAME", "").strip()
    ws_pass = os.environ.get("WEBSHARE_PROXY_PASSWORD", "").strip()
    if ws_user and ws_pass:
        try:
            from youtube_transcript_api.proxies import WebshareProxyConfig
            print(f"    🛡 youtube-transcript-api: using Webshare rotating residential proxy")
            return YouTubeTranscriptApi(
                proxy_config=WebshareProxyConfig(
                    proxy_username=ws_user,
                    proxy_password=ws_pass,
                )
            )
        except ImportError:
            print(f"    ⚠ Webshare creds set but WebshareProxyConfig unavailable — install youtube-transcript-api>=0.6.2")

    https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if https_proxy:
        try:
            from youtube_transcript_api.proxies import GenericProxyConfig
            print(f"    🛡 youtube-transcript-api: using HTTPS_PROXY")
            return YouTubeTranscriptApi(
                proxy_config=GenericProxyConfig(
                    http_url=os.environ.get("HTTP_PROXY", https_proxy),
                    https_url=https_proxy,
                )
            )
        except ImportError:
            # Older library version — env vars are still picked up via requests
            pass

    return YouTubeTranscriptApi()


_ytt = _build_ytt_client()


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
        _record_success()
        return plain, segments

    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable) as e:
        raise PermanentNoTranscript(str(e))

    except Exception as e:
        msg = str(e)
        if is_permanent_error(msg):
            raise PermanentNoTranscript(msg)
        if _is_rate_limit_error(msg):
            _record_rate_limit()
            print(f"    ⚠ youtube-transcript-api rate-limited: {msg[:160]}")
        else:
            print(f"    youtube-transcript-api error: {str(e)[:200]}")
        return None


# ---------------------------------------------------------------------------
# AssemblyAI audio fallback — used when YouTube has no captions
# ---------------------------------------------------------------------------

def _transcribe_via_assemblyai(video_url: str) -> tuple[str, list] | None:
    """Download audio via yt-dlp, transcribe via AssemblyAI. Returns (text, segments)."""
    if not ASSEMBLYAI_API_KEY:
        return None
    try:
        import yt_dlp
        import assemblyai as aai
    except ImportError:
        print("    ✗ assemblyai or yt-dlp not installed — skipping audio fallback")
        return None

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "audio.m4a")
            ydl_opts = {
                "format": "bestaudio[ext=m4a]/bestaudio/best",
                "outtmpl": audio_path,
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
            }
            if YOUTUBE_BROWSER:
                ydl_opts["cookiesfrombrowser"] = (YOUTUBE_BROWSER,)
            elif _resolve_cookie_path():
                ydl_opts["cookiefile"] = _resolve_cookie_path()

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([video_url])

            # yt-dlp may append an extension — find the actual file
            files = [f for f in os.listdir(tmpdir) if f.startswith("audio")]
            if not files:
                print("    ✗ yt-dlp produced no audio file")
                return None
            actual_path = os.path.join(tmpdir, files[0])

            print(f"    → Transcribing audio via AssemblyAI ({os.path.getsize(actual_path) // 1024} KB)…")
            aai.settings.api_key = ASSEMBLYAI_API_KEY
            config = aai.TranscriptionConfig(punctuate=True, format_text=True, language_detection=True)
            transcript = aai.Transcriber(config=config).transcribe(actual_path)

            if transcript.status == aai.TranscriptStatus.error:
                print(f"    ✗ AssemblyAI error: {transcript.error}")
                return None

            text = transcript.text or ""
            segments = []
            if transcript.words:
                for w in transcript.words:
                    segments.append({
                        "text": w.text,
                        "start": w.start / 1000.0,
                        "duration": (w.end - w.start) / 1000.0,
                    })
            print(f"    ✓ AssemblyAI transcript ({len(text)} chars)")
            return text, segments

    except Exception as e:
        print(f"    ✗ Audio fallback failed: {str(e)[:120]}")
        return None


# ---------------------------------------------------------------------------
# Unified public transcript getter
# ---------------------------------------------------------------------------

def get_youtube_transcript(video_id: str) -> tuple[str, list] | None:
    """
    Always try youtube-transcript-api first — it uses the /api/timedtext
    endpoint which is a completely separate rate-limit bucket from the media
    CDN that yt-dlp downloads subtitles from. When YouTube blocks yt-dlp's
    VTT download path (as happens under sustained IP pressure), timedtext
    often stays accessible because it is a lightweight metadata endpoint.

    Fall-through logic:
      ytt succeeds              → return result
      ytt rate-limited (None)   → return None (mark failed, retry later)
      ytt PermanentNoTranscript → try yt-dlp (finds auto-subs ytt cannot)
    """
    try:
        result = _get_transcript_ytt(video_id)
        if result:
            return result
        # None = retryable network/429 — don't pile on with yt-dlp
        return None
    except PermanentNoTranscript:
        pass  # ytt confirmed no caption track — yt-dlp may find auto-generated ones

    # yt-dlp fallback: only reached when ytt finds no caption track at all
    if YOUTUBE_BROWSER or _resolve_cookie_path():
        return _get_transcript_ytdlp(video_id)

    raise PermanentNoTranscript(f"No transcript available for {video_id}")


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

    if YOUTUBE_BROWSER:
        fetcher = f"yt-dlp+{YOUTUBE_BROWSER}"
    elif _resolve_cookie_path():
        fetcher = "yt-dlp+cookiefile"
    else:
        fetcher = "youtube-transcript-api"
    print(f"    Fetching transcript for {vid_id} via {fetcher}…")

    # Adaptive pre-request delay — escalates after each rate-limit
    _adaptive_pre_request_delay()

    try:
        result = get_youtube_transcript(vid_id)
    except PermanentNoTranscript as e:
        print(f"    ✗ No YouTube captions: {str(e)[:80]}")
        # Try audio fallback before giving up
        audio_result = _transcribe_via_assemblyai(url)
        if audio_result:
            text, segments = audio_result
            if segments:
                last = segments[-1]
                total_seconds = (last.get("start") or 0) + (last.get("duration") or 0)
                if total_seconds < MIN_VIDEO_DURATION_SECONDS:
                    print(f"    · Skipped short ({int(total_seconds)}s < {MIN_VIDEO_DURATION_SECONDS}s)")
                    return None, "skipped_short", []
            return text, "fetched", segments
        if video_id:
            db.mark_video_permanent_failure(video_id)
        return None, "no_transcript", []

    if result:
        text, segments = result
        # Duration filter — skip filler shorts / under-5-min videos
        if segments:
            last = segments[-1]
            total_seconds = (last.get("start") or 0) + (last.get("duration") or 0)
            if total_seconds < MIN_VIDEO_DURATION_SECONDS:
                print(f"    · Skipped short ({int(total_seconds)}s < {MIN_VIDEO_DURATION_SECONDS}s)")
                return None, "skipped_short", []
        print(f"    ✓ Transcript ({len(text)} chars, {len(segments)} segments)")
        return text, "fetched", segments

    # Retryable — status stays 'failed' so it will be retried next run
    print(f"    ✗ Transcript fetch failed (retryable — IP block or network)")
    return None, "failed", []
