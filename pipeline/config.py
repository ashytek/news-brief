"""
Central config — reads from .env in this directory.
Copy .env.example to .env and fill in your keys.
"""

import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

GOOGLE_API_KEY        = os.environ["GOOGLE_API_KEY"]          # Google AI Studio key (starts with AIza...)
YOUTUBE_API_KEY       = os.environ["YOUTUBE_API_KEY"]
ASSEMBLYAI_API_KEY    = os.environ.get("ASSEMBLYAI_API_KEY", "")

# Apify — managed YouTube transcript API (primary transcript path when set).
# Free plan includes $5 usage credit/month which covers our volume entirely.
# Sign up at https://apify.com (no card needed) → Settings → API tokens.
APIFY_TOKEN           = os.environ.get("APIFY_TOKEN", "")
APIFY_TRANSCRIPT_ACTOR = os.environ.get(
    "APIFY_TRANSCRIPT_ACTOR",
    "codepoetry~youtube-transcript-ai-scraper",   # ~$0.001/native transcript
)
# ANTHROPIC_API_KEY is no longer required — Gemini is the primary LLM.
# To re-add Claude as a fallback: pip install anthropic, uncomment below, restore key in .env
# ANTHROPIC_API_KEY   = os.environ["ANTHROPIC_API_KEY"]
# Optional: browser name to extract YouTube cookies from at runtime (recommended).
# Supported values: chrome, firefox, safari, edge, brave, opera, chromium
# This reads fresh cookies directly from the browser — no file management needed.
YOUTUBE_BROWSER       = os.environ.get("YOUTUBE_BROWSER", "")

# Optional: path to a Netscape-format cookies.txt (fallback if YOUTUBE_BROWSER not set).
YOUTUBE_COOKIES_FILE  = os.environ.get("YOUTUBE_COOKIES_FILE", "")
SUPABASE_URL          = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# How many hours back to look for new videos
LOOKBACK_HOURS = 4

# Cosine similarity threshold to merge stories into a cluster.
# 0.72 was over-aggressive (e.g. "India-NZ FTA" merged with unrelated
# "Butter Chicken Tsunami" remark). 0.78 keeps tight near-duplicates
# clustered while letting different events stay solo.
CLUSTER_THRESHOLD = 0.78

# Videos shorter than this are treated as filler/shorts and skipped entirely
# Vantage segments can run 2-8 min — 2 min floor catches them all while
# still filtering out genuine 30-60s Shorts
MIN_VIDEO_DURATION_SECONDS = 120

# Max bullet points per story (8 gives good depth for segment-style channels like Vantage)
MAX_BULLETS = 8
# Prophetic broadcasts can run 60–120 min and pack many distinct declarations,
# visions, and warnings — needs a much higher cap to give comprehensive coverage.
MAX_BULLETS_PROPHETIC = 25
# Soft target: at minimum, force one bullet per N seconds of video so coverage
# scales with video length and the model can't front-load only the first section.
PROPHETIC_BULLETS_PER_SECONDS = 300  # 1 bullet per 5 min minimum

# Gemini models — primary LLM, free tier, zero cost at current volumes
# Check https://ai.google.dev/gemini-api/docs/models for latest stable model strings
GEMINI_FLASH_MODEL = "gemini-2.5-flash"  # general news summarisation + cluster synthesis
GEMINI_PRO_MODEL   = "gemini-2.5-pro"   # prophetic extraction (1M context + thinking mode)

# Optional: Healthchecks.io ping URL for dead-man's switch monitoring
# Get a free URL at https://healthchecks.io → New Check → paste URL into .env
HEALTHCHECK_URL = os.environ.get("HEALTHCHECK_URL", "")
