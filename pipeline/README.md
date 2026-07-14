# News Brief — Ingestion Pipeline

**Production runs in the cloud**, not on your Mac: GitHub Actions cron (`.github/workflows/news-pipeline.yml`) runs this pipeline 4×/day (03:17/09:17/15:17/21:17 UTC). Ash's Mac is retired from pipeline duty — the sections below are for local development and testing only.

---

## What you need first (one-time, for local dev)

You'll need API keys from 5 services. All have free tiers that cover local testing usage.

### 1. Apify (primary transcript source)
1. Go to https://apify.com — sign up, no card needed
2. Settings → API tokens → copy your token
3. This is the **primary** transcript path in production (~$0.001/video, covered by Apify's recurring free credit) — it runs from Apify's own infrastructure, so it isn't blocked by YouTube's bot-detection the way a home IP or a GitHub-hosted runner IP would be. If unset locally, the pipeline falls through to the free local fetcher chain (yt-dlp → timedtext → AssemblyAI), which is more failure-prone from home/CI IPs.

### 2. Anthropic (Claude — summarization)
1. Go to https://console.anthropic.com
2. Sign up → API Keys → Create Key
3. Copy the key — starts with `sk-ant-...`

### 3. Google AI Studio (embeddings — free)
1. Go to https://aistudio.google.com/apikey
2. Sign in with your Google account → Create API key
3. Copy the key — starts with `AIza...`
4. No billing required — free tier covers your entire usage

### 4. YouTube Data API v3 (free)
1. Go to https://console.cloud.google.com
2. Create a new project called "NewsApp"
3. Enable APIs & Services → YouTube Data API v3
4. Credentials → Create Credentials → API Key
5. Copy the key

### 5. Supabase Service Role Key
1. Go to https://supabase.com/dashboard/project/mvrmcptahvwmfvnwlvyd
2. Settings → API
3. Copy the `service_role` key (NOT the anon key — this one bypasses security for the pipeline)

### 6. AssemblyAI (optional, last-resort fallback)
Only used if both Apify and the free local fetchers fail to get a transcript.
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

When running, you'll see output like:
```
📰 Pipeline run starting at 09:15:22 13/04/2026
[1/4] Fetching sources…
  → Checking WION (india_global)
    ✓ 3 new items
[2/4] Extracting transcripts…
  → [video title]…
    ✓ Transcript via apify
[3/4] Summarising 4 items with Claude…
    ✓ Story saved
[4/4] Embedding and clustering 4 stories…
    → Solo story (no matching cluster)
✅ Done! 4 stories created, 1 clustered
```

There's no need to run this continuously or keep it scheduled locally — production scheduling is handled by GitHub Actions (see the top of this file). `python run_pipeline.py --once` is for testing a change before it ships, not for standing up a competing pipeline instance.

---

## Troubleshooting

**"No transcript available"** — checked in order: Apify (if `APIFY_TOKEN` set) → yt-dlp → YouTube timedtext → AssemblyAI (if configured). If all fail, it's usually a genuinely transcript-less video (live stream, very new upload, or region-locked).

**"YouTube API error: quota exceeded"** — YouTube Data API has 10,000 units/day free, ~100 units per source check. Production runs 4×/day; at 20 sources that's roughly 8,000 units/day — headroom is thinner than it looks, so don't casually add sources or increase run frequency without checking quota math first.

**Apify errors** — "credit exhausted" falls through to the local fetcher chain automatically; that's expected behavior, not a bug. A hard HTTP error or malformed response is worth checking on Apify's dashboard directly.

**Pipeline stops without error** — check your internet connection. The pipeline needs to reach YouTube, Apify, Google, Anthropic, and Supabase.

**Stories not appearing in the app** — check the reader header's pipeline health indicator ("Checked Xh ago" / stale / "Pipeline down"), and query the `pipeline_runs` table in Supabase directly for per-run detail.

**Local yt-dlp fallback failing** — `cookies.txt` in this folder may be stale; YouTube periodically invalidates scraping cookies. This only affects the local fallback chain, not the Apify primary path.

---

## Prophetic sources — FILL THESE IN

The database has 5 placeholder slots for your Prophetic sources.
Tell Claude which YouTube channels you want and they'll be updated automatically.
