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

# yt-dlp player-client selection. As of late 2025 YouTube serves a degraded
# player response to the default `web` client unless a PoToken is attached —
# the symptom is "Requested format is not available" / "No video formats found"
# on videos that plainly have captions. The `android` client uses a separate
# innertube API that still returns formats + auto-captions without a PoToken.
#
# CRITICAL: the android client must run WITHOUT cookies. Attaching a browser
# session cookie re-triggers the PoToken format block (verified empirically:
# android+cookies → "Requested format is not available"; android+no-cookies →
# works). So cookies are attached ONLY for the web-family fallback clients.
#
# Default is android-only because it handles essentially everything; add
# web_safari via env only if you need age-/members-gated content (it currently
# gets PoToken-blocked too, so it rarely helps).
# Override: YOUTUBE_PLAYER_CLIENTS="android,web_safari"
_PLAYER_CLIENTS = [
    c.strip() for c in
    os.environ.get("YOUTUBE_PLAYER_CLIENTS", "android").split(",")
    if c.strip()
]

# Web-family clients that benefit from (and need) cookie auth. The innertube
# clients (android/ios/tv) must stay cookie-free — see note above.
_COOKIE_CLIENTS = {"web", "web_safari", "web_embedded", "web_music", "mweb"}

# AssemblyAI audio-fallback cost guardrail. Audio download (via the android
# client → googlevideo CDN) is endpoint-independent from timedtext, so it works
# even when captions are 429'd — but it costs ~$0.002/min ($0.12/audio-hour).
# Cap how many we'll pay for per pipeline run so a fully-blocked day can't run
# up an unbounded bill. The pipeline runs ~4×/day, so per-day spend ≈
# 4 × cap × avg_cost. Set MAX_AUDIO_FALLBACK_PER_RUN=0 to disable audio entirely.
MAX_AUDIO_FALLBACK_PER_RUN = int(os.environ.get("MAX_AUDIO_FALLBACK_PER_RUN", "6"))

# Module-level in-run state. The launchd pipeline is a long-lived process that
# loops via `schedule`, so this does NOT auto-reset between runs — run_pipeline
# calls reset_run_state() at the start of each cycle.
_rate_limit_streak = 0
_last_rate_limit_at: float = 0.0
_audio_fallback_count = 0


def reset_run_state():
    """Reset per-run counters. Called by run_pipeline at the start of each cycle."""
    global _rate_limit_streak, _last_rate_limit_at, _audio_fallback_count
    _rate_limit_streak = 0
    _last_rate_limit_at = 0.0
    _audio_fallback_count = 0


def _is_rate_limit_error(msg: str) -> bool:
    """Distinguish 429-style rate limits / bot-checks from other retryable errors.

    Includes PoToken block phrases: if even the android client gets a degraded
    response, YouTube is throttling this IP and we should back off — not retry
    instantly and not mark the video permanent.
    """
    m = msg.lower()
    if any(p in m for p in POTOKEN_BLOCK_PHRASES):
        return True
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
    "drm protected",                      # genuinely undownloadable (e.g. movies)
    # DO NOT add "requested format is not available" / "no video formats found"
    # here. Those are NOT permanent — they are the signature of YouTube's
    # PoToken bot-check serving a degraded player response to the web client.
    # The android player client (see _PLAYER_CLIENTS) bypasses them, so a video
    # that hits these phrases should stay 'failed' and be retried, never killed.
)

# Phrases that mean "the web client got PoToken-blocked" — retryable, and a
# signal to escalate to the android client / back off, but never permanent.
POTOKEN_BLOCK_PHRASES = (
    "requested format is not available",
    "no video formats found",
    "sign in to confirm",                 # "...you're not a bot"
    "content isn't available",
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
    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")

    last_permanent: PermanentNoTranscript | None = None

    # Try each configured player client in order. android (cookie-free) leads
    # and handles the vast majority; web-family clients run with cookies only
    # if explicitly configured, as a fallback for gated content.
    for client in _PLAYER_CLIENTS:
        use_cookies = client in _COOKIE_CLIENTS
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
                # One client per attempt — mixing clients lets yt-dlp silently
                # fall back to the PoToken-blocked web client.
                "extractor_args":    {"youtube": {"player_client": [client]}},
            }
            # Cookies ONLY for web-family clients. Attaching them to android
            # re-triggers the PoToken block (see _PLAYER_CLIENTS note).
            if use_cookies:
                if YOUTUBE_BROWSER:
                    ydl_opts["cookiesfrombrowser"] = (YOUTUBE_BROWSER, None, None, None)
                elif cookie_path:
                    ydl_opts["cookiefile"] = cookie_path
            if proxy_url:
                ydl_opts["proxy"] = proxy_url

            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
            except Exception as e:
                msg = str(e)
                if is_permanent_error(msg):
                    # Trust this verdict but let a later client try too.
                    last_permanent = PermanentNoTranscript(msg)
                    continue
                if _is_rate_limit_error(msg):
                    _record_rate_limit()
                    print(f"    ⚠ yt-dlp[{client}] blocked/rate-limited: {msg[:130]}")
                else:
                    print(f"    yt-dlp[{client}] error: {msg[:160]}")
                continue

            vtt_files = glob.glob(os.path.join(tmpdir, "*.vtt"))
            if not vtt_files:
                last_permanent = PermanentNoTranscript("No subtitles available for this video")
                continue

            with open(vtt_files[0], encoding="utf-8") as f:
                vtt_content = f.read()

            plain, segments = _parse_vtt(vtt_content)
            if not plain.strip():
                last_permanent = PermanentNoTranscript("Subtitle file was empty")
                continue
            _record_success()
            return plain, segments

    # All configured clients exhausted.
    if last_permanent is not None:
        raise last_permanent
    return None  # every client hit a retryable error — retry next run


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
            # Use the first configured player client (android) — cookie-free,
            # same PoToken-bypass reasoning as the subtitle path. Without this
            # the audio download fails identically with "No video formats found".
            primary_client = _PLAYER_CLIENTS[0] if _PLAYER_CLIENTS else "android"
            ydl_opts = {
                "format": "bestaudio[ext=m4a]/bestaudio/best",
                "outtmpl": audio_path,
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "extractor_args": {"youtube": {"player_client": [primary_client]}},
            }
            # Cookies only if the primary client is a web-family client.
            if primary_client in _COOKIE_CLIENTS:
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
    Try yt-dlp with the android player client FIRST, then youtube-transcript-api.

    Why this order (reversed from the original design): the two paths hit
    DIFFERENT YouTube endpoints with INDEPENDENT block states.
      • youtube-transcript-api → /api/timedtext — gets 429'd hard and fast
        once this IP fetches a handful of transcripts.
      • yt-dlp + android client → the android innertube API — bypasses the
        PoToken bot-check that breaks the web client, and stays accessible
        when timedtext is already blocked (verified empirically).
    The old code tried timedtext first and, when it got rate-limited (None),
    returned immediately WITHOUT ever trying yt-dlp — so the working path was
    unreachable exactly when we needed it. Now yt-dlp+android leads.

    Fall-through logic:
      ytdlp succeeds                → return result
      ytdlp PermanentNoTranscript   → confirm with ytt (it may see a caption
                                       track yt-dlp's client doesn't); if ytt
                                       also says permanent → raise.
      ytdlp None (rate-limit/error) → try ytt as a secondary path.
    """
    have_auth = bool(YOUTUBE_BROWSER or _resolve_cookie_path())

    if have_auth:
        try:
            result = _get_transcript_ytdlp(video_id)
            if result:
                return result
            # None = retryable error — fall through to ytt as a second chance
        except PermanentNoTranscript as ytdlp_perm:
            # yt-dlp's android client found no caption track. Double-check with
            # ytt before declaring permanent — occasionally timedtext exposes a
            # track the android caption list omitted.
            try:
                result = _get_transcript_ytt(video_id)
                if result:
                    return result
            except PermanentNoTranscript:
                raise ytdlp_perm  # both agree: genuinely no transcript
            # ytt was rate-limited (None) — can't confirm. Trust yt-dlp's verdict.
            raise ytdlp_perm
        # yt-dlp returned None (retryable). Try ytt before giving up.
        return _get_transcript_ytt(video_id)

    # No cookies/browser configured → timedtext is the only option.
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
        # Genuinely no caption track → audio fallback before giving up.
        audio = _try_audio_fallback(url, reason="no captions")
        if audio is not None:
            return audio
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

    # Retryable failure (captions 429'd / network). The android client proved
    # the video IS reachable, so the audio CDN (separate endpoint from the
    # 429'd timedtext) can still get us a transcript. Spend an AssemblyAI call
    # IF the video is fresh (worth the cost now) and we're under the per-run cap.
    if _should_try_audio_on_block(video):
        audio = _try_audio_fallback(url, reason="captions rate-limited")
        if audio is not None:
            return audio

    # Otherwise leave as 'failed' so it retries for free on the next run.
    print(f"    ✗ Transcript fetch failed (retryable — IP block or network)")
    return None, "failed", []


def _should_try_audio_on_block(video: dict) -> bool:
    """Whether to spend a paid audio transcription when captions are 429'd.

    Only for FRESH videos (published within 48h) — old ones can wait for a free
    retry. Bounded by the per-run cap inside _try_audio_fallback.
    """
    if MAX_AUDIO_FALLBACK_PER_RUN <= 0 or not ASSEMBLYAI_API_KEY:
        return False
    pub = video.get("published_at")
    if not pub:
        return False
    try:
        from datetime import datetime, timezone
        pub_dt = datetime.fromisoformat(str(pub).replace("Z", "+00:00"))
        age_h = (datetime.now(timezone.utc) - pub_dt).total_seconds() / 3600
        return age_h <= 48
    except Exception:
        return False


def _try_audio_fallback(url: str, reason: str) -> tuple | None:
    """Run the AssemblyAI audio fallback if under the per-run budget cap.

    Returns a fetch_transcript-style (text, status, segments) tuple on success
    (status 'fetched' or 'skipped_short'), or None if skipped/failed so the
    caller can decide the final status.
    """
    global _audio_fallback_count
    if MAX_AUDIO_FALLBACK_PER_RUN <= 0 or not ASSEMBLYAI_API_KEY:
        return None
    if _audio_fallback_count >= MAX_AUDIO_FALLBACK_PER_RUN:
        print(f"    · Audio fallback skipped — per-run cap reached "
              f"({MAX_AUDIO_FALLBACK_PER_RUN})")
        return None

    _audio_fallback_count += 1
    print(f"    → Audio fallback ({reason}) "
          f"[{_audio_fallback_count}/{MAX_AUDIO_FALLBACK_PER_RUN}]…")
    audio_result = _transcribe_via_assemblyai(url)
    if not audio_result:
        return None

    text, segments = audio_result
    if segments:
        last = segments[-1]
        total_seconds = (last.get("start") or 0) + (last.get("duration") or 0)
        if total_seconds < MIN_VIDEO_DURATION_SECONDS:
            print(f"    · Skipped short ({int(total_seconds)}s < {MIN_VIDEO_DURATION_SECONDS}s)")
            return None, "skipped_short", []
    return text, "fetched", segments
