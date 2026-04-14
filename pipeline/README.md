# News Brief — Local Pipeline

This runs on your home machine and feeds stories into the app.
It should take you about 15 minutes to set up, once.

---

## What you need first (one-time)

You'll need API keys from 4 services. All have free tiers that cover your usage.

### 1. Anthropic (Claude)
1. Go to https://console.anthropic.com
2. Sign up → API Keys → Create Key
3. Copy the key — starts with `sk-ant-...`

### 2. Google AI Studio (embeddings — free)
1. Go to https://aistudio.google.com/apikey
2. Sign in with your Google account → Create API key
3. Copy the key — starts with `AIza...`
4. No billing required — free tier covers your entire usage

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

### 5. AssemblyAI (optional fallback)
Only needed if YouTube transcripts are unavailable for some videos.
1. Go to https://www.assemblyai.com
2. Sign up → copy your API key
3. Free tier gives you 100 hours/month

---

## Setup (one-time, ~15 minutes)

Open Terminal on your Mac and run these commands one by one:

```bash
# 1. Make sure Python 3.11+ is installed
python3 --version

# 2. Go to the pipeline folder
cd "/path/to/News App/pipeline"

# 3. Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Create your .env file
cp .env.example .env
```

Now open `.env` in any text editor and paste in your API keys.

---

## Running the pipeline

```bash
# Make sure you're in the pipeline folder with venv active
cd "/path/to/News App/pipeline"
source venv/bin/activate

# Run once (to test)
python run_pipeline.py --once

# Run in background, every 90 minutes
python run_pipeline.py
```

When running, you'll see output like:
```
📰 Pipeline run starting at 09:15:22 13/04/2026
[1/4] Fetching sources…
  → Checking WION (india_global)
    ✓ 3 new items
  → Checking Two Minute Papers (tech_ai)
    ✓ 1 new item
[2/4] Extracting transcripts…
  → [video title]…
    ✓ Transcript via youtube-transcript-api
[3/4] Summarising 4 items with Claude…
    ✓ Story saved
[4/4] Embedding and clustering 4 stories…
    → Solo story (no matching cluster)
✅ Done! 4 stories created, 1 clustered
```

---

## Keep it running automatically (optional, later)

On a Mac, you can use launchd to run it on startup.
Or just leave Terminal open when you're home — it'll run every 90 min.

---

## Troubleshooting

**"No transcript available"** — YouTube sometimes blocks transcripts for live streams or very new videos. AssemblyAI fallback will handle it if configured.

**"YouTube API error: quota exceeded"** — YouTube Data API has 10,000 units/day free. Each source check costs ~100 units. With 20 sources at 16 runs/day = 32,000 units — you may need to reduce run frequency or increase quota in Google Cloud Console (free to request).

**Pipeline stops without error** — Check your internet connection. The pipeline needs to reach YouTube, OpenAI, Anthropic, and Supabase.

**Stories not appearing in the app** — Check the Sources page in the app to see pipeline run logs and source health indicators.

---

## Prophetic sources — FILL THESE IN

The database has 5 placeholder slots for your Prophetic sources.
Tell Claude (in the Cowork app) which YouTube channels you want and they'll be updated automatically.
