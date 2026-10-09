# News Brief — Ingestion Pipeline

**Production runs in the cloud**, not on your Mac: GitHub Actions cron (`.github/workflows/news-pipeline.yml`) runs this pipeline 4×/day (03:17/09:17/15:17/21:17 UTC). Ash's Mac is retired from pipeline duty — the sections below are for local development and testing only.

---

## What you need first (one-time, for local dev)

You'll need API keys from 4 services (plus one optional). Gemini is paid-tier: Google's terms require it for UK users, so there is no free-tier path.

### 1. Apify (primary transcript source)
1. Go to https://apify.com — sign up, no card needed
2. Settings → API tokens → copy your token
3. This is the **primary** transcript path in production (~$0.001/video, covered by Apify's recurring free credit) — it runs from Apify's own infrastructure, so it isn't blocked by YouTube's bot-detection the way a home IP or a GitHub-hosted runner IP would be. If unset locally, the pipeline uses the free local fetcher chain (yt-dlp → timedtext → AssemblyAI), which only works from a home IP. **On GitHub Actions that chain is skipped** (YouTube blocks GitHub's IPs; every transcript in recent runs came from Apify): a failed Apify fetch just stays retryable for the next run. Set `TRANSCRIPT_LOCAL_FALLBACK_IN_CI=1` to try the chain there anyway.

### 2. Google AI Studio (Gemini — summaries, storylines, search embeddings)
1. Go to https://aistudio.google.com/apikey
2. Sign in with your Google account → Create API key
3. Copy the key — starts with `AIza...`
4. Billing must be on (paid tier). Everything runs on `gemini-2.5-flash`; see `CLAUDE.md` "Gemini cost cut" for what it costs.

### 3. YouTube Data API v3 (free)
1. Go to https://console.cloud.google.com
2. Create a new project called "NewsApp"
3. Enable APIs & Services → YouTube Data API v3
4. Credentials → Create Credentials → API Key
5. Copy the key

### 4. Supabase Service Role Key
1. Go to https://supabase.com/dashboard/project/mvrmcptahvwmfvnwlvyd
2. Settings → API
3. Copy the `service_role` key (NOT the anon key — this one bypasses security for the pipeline)

### 5. AssemblyAI (optional, last-resort fallback)
Only used (from a home IP, never on GitHub Actions) if both Apify and the free local fetchers fail to get a transcript for a fresh video.
1. Go to https://www.assemblyai.com
2. Sign up → copy your API key
3. Free tier gives you 100 hours/month

---

## Setup (one-time, ~15 minutes)

```bash
# 1. Make sure Python 3.11+ is installed
python3 --version

# 2. Go to the pipeline folder
cd "/path/to/newsapp/pipeline"

# 3. Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Create your .env file
cp .env.example .env
```

Now open `.env` and paste in your API keys.

---

## Running the pipeline locally

```bash
cd "/path/to/newsapp/pipeline"
source venv/bin/activate

# Run once (to test)
python run_pipeline.py --once
```

When running, you'll see output like (condensed from a real run):
```
📰 News Brief Pipeline
   started_at: 2026-10-08 20:42:24
   code_sha:   323bd39
   Supabase:   connected
   Mode: run once

============================================================
📰 Pipeline run starting at 20:42:24 08/10/2026
============================================================

[1/4] Fetching sources…
→ Checking India Global Review (india_global, lookback=24h)
  ✓ 28 new items
  → 49 new items total

[2/4] Extracting transcripts…
  → AMBANI IS KING OF INDIA?? ELON MUSK TARGETS PM MODI AND AMBA…
    Fetching transcript for RQQbRaGuRY8 via apify…
    ✓ Transcript (13294 chars, 344 segments)
  → FRANCE PROPHECY FULFILLED…
    · Skipped short at discovery (116s < 120s)

  Summarising 25 items with Gemini (gemini-2.5-flash)…
  Embedding 25 stories…

[5/5] Retrying 1 previously failed transcripts…
  Transcript sources this run: {'apify': 26}

============================================================
✅ Done! 25 stories created
   LLM: 25 calls · Flash 67,029 tokens (in 46,437 / out 20,592 / thinking 0) · Pro 0 tokens (thinking 0) · 0 failures
============================================================
```
(The step numbers are the script's own and not consistent: "[5/5]" is the retry pass. Storyline assignment and recaps log after the embeddings.)

There's no need to run this continuously or keep it scheduled locally — production scheduling is handled by GitHub Actions (see the top of this file). `python run_pipeline.py --once` is for testing a change before it ships, not for standing up a competing pipeline instance.

---

## Troubleshooting

**"No transcript available"** — checked in order: Apify (if `APIFY_TOKEN` set) → yt-dlp (cookie-free android client) → YouTube timedtext → AssemblyAI (if configured). **On GitHub Actions only Apify runs** (the log says "Local fetchers … skipped on CI"). A fetch that fails for a passing reason (a premiere that hasn't aired, a live stream, a private video, an Apify hiccup) stays `failed` and is retried every run for 14 days, so a premiere is picked up after it airs. Apify's own verdict "this video has no captions" is permanent (`no_transcript`).

**"YouTube API error: quota exceeded"** — YouTube Data API has 10,000 units/day free. Each source check reads the channel's uploads playlist, **1–4 units** (one page of 50 videos per unit, up to 4 pages), plus about 1 unit per 50 videos for their durations; the cron runs 4×/day, so 9 sources cost a few hundred units a day. The expensive call is resolving a `HANDLE:@name` source to a channel ID (`search.list`, **100 units**); it happens once and the ID is saved. Repeated resolution failures (a handle that never resolves) are the real quota risk; a few hundred units of normal use are not.

**Apify errors** — "credit exhausted" falls through to the local fetcher chain automatically; that's expected behavior, not a bug. A hard HTTP error or malformed response is worth checking on Apify's dashboard directly.

**Pipeline stops without error** — check your internet connection. The pipeline needs to reach YouTube, Apify, Google (Gemini), and Supabase.

**Stories not appearing in the app** — check the reader header's pipeline health indicator ("Checked Xh ago" / stale / "Pipeline down"), and query the `pipeline_runs` table in Supabase directly for per-run detail.

**Local yt-dlp fallback failing** — YouTube rate-limits home IPs too ("HTTP Error 429"). Set `YOUTUBE_BROWSER=chrome` (or `firefox`, `safari`, `edge`) in `.env` to pull fresh cookies from an installed browser at run time, or `YOUTUBE_COOKIES_FILE=/path/to/cookies.txt` (Netscape format). The android player client must run *without* cookies, so these only help the web-family clients (`YOUTUBE_PLAYER_CLIENTS`). This only affects the local fallback chain, never the Apify primary path.

**A channel in another language gets no transcript** — Apify is asked for `en` then `hi` captions (`APIFY_CAPTION_LANGUAGES` in `.env`, comma-separated bare ISO codes). Add the channel's code (for example `en,hi,ta`); the first match wins, so English channels are unaffected.

---

## Prophetic sources — FILL THESE IN

The database has 5 placeholder slots for your Prophetic sources.
Tell Claude which YouTube channels you want and they'll be updated automatically.
