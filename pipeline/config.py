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

# Cosine similarity threshold to merge stories into a cluster
CLUSTER_THRESHOLD = 0.72

# Videos shorter than this are treated as filler/shorts and skipped entirely
# Vantage segments run 3-8 min — set to 3 min to capture them all
MIN_VIDEO_DURATION_SECONDS = 180

# Max bullet points per story (8 gives good depth for segment-style channels like Vantage)
MAX_BULLETS = 8

# Gemini models — primary LLM, free tier, zero cost at current volumes
# Check https://ai.google.dev/gemini-api/docs/models for latest stable model strings
GEMINI_FLASH_MODEL = "gemini-2.5-flash"  # general news summarisation + cluster synthesis
GEMINI_PRO_MODEL   = "gemini-2.5-pro"   # prophetic extraction (1M context + thinking mode)

# Optional: Healthchecks.io ping URL for dead-man's switch monitoring
# Get a free URL at https://healthchecks.io → New Check → paste URL into .env
HEALTHCHECK_URL = os.environ.get("HEALTHCHECK_URL", "")
