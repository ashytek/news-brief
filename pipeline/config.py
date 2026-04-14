"""
Central config — reads from .env in this directory.
Copy .env.example to .env and fill in your keys.
"""

import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

ANTHROPIC_API_KEY     = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_API_KEY        = os.environ["GOOGLE_API_KEY"]          # Google AI Studio key — replaces OpenAI
YOUTUBE_API_KEY       = os.environ["YOUTUBE_API_KEY"]
ASSEMBLYAI_API_KEY    = os.environ.get("ASSEMBLYAI_API_KEY", "")
# Optional: path to a Netscape-format cookies.txt exported from your browser.
# Helps bypass YouTube IP rate-limiting. See pipeline/README.md for how to export.
YOUTUBE_COOKIES_FILE  = os.environ.get("YOUTUBE_COOKIES_FILE", "")
SUPABASE_URL          = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# How many hours back to look for new videos
LOOKBACK_HOURS = 4

# Cosine similarity threshold to merge stories into a cluster
CLUSTER_THRESHOLD = 0.78

# Max bullet points per story
MAX_BULLETS = 6

# Claude models
HAIKU_MODEL  = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"
