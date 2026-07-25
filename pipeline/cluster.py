"""
Embeds stories via Google gemini-embedding-001 (direct REST API, bypasses
SDK namespace issues). Embeddings feed semantic/hybrid search
(supabase/migrations/search_setup.sql).

Story clustering (grouping same-event stories from multiple sources into
one card, plus the cross-source synthesis LLM call) was deliberately
disabled — it crammed each source's coverage into a small, heavily-truncated
card and cost an extra Gemini call per multi-source event. Every story now
renders as its own full card. Do not reintroduce cluster_id assignment here
without discussing it first.
"""
from __future__ import annotations

import logging
import random
import time

import requests
import db
from config import GOOGLE_API_KEY

_log = logging.getLogger(__name__)

EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIM = 3072
_EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/{EMBEDDING_MODEL}:embedContent"


def get_embedding(text: str, max_retries: int = 3) -> list:
    """Get embedding vector via direct REST call to Google's v1beta API.
    Retries with exponential backoff on transient errors (429/5xx/timeout)."""
    payload = {
        "model": EMBEDDING_MODEL,
        "content": {
            "parts": [{"text": text[:8000]}]
        }
    }
    for attempt in range(max_retries + 1):
        try:
            resp = requests.post(
                _EMBED_URL,
                params={"key": GOOGLE_API_KEY},
                json=payload,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["embedding"]["values"]
        except requests.RequestException as e:
            status = getattr(e.response, "status_code", None)
            is_retryable = isinstance(e, (requests.Timeout, requests.ConnectionError)) or status in (
                429, 500, 502, 503, 504
            )
            if is_retryable and attempt < max_retries:
                wait = min(4 * (2 ** attempt) + random.uniform(0, 2), 60)
                _log.warning(f"Embedding request retryable error (attempt {attempt+1}): {str(e)[:80]}. Waiting {wait:.0f}s…")
                time.sleep(wait)
                continue
            raise


def embed_and_cluster_story(
    story_id: str,
    headline: str,
    summary: str,
    category: str,
) -> None:
    """Generate an embedding for a story and store it — used by
    semantic/hybrid search. Clustering assignment was removed (see module
    docstring); category is accepted for call-site compatibility but unused."""
    text_to_embed = f"{headline}. {summary}"
    print(f"    Embedding: {text_to_embed[:60]}…")

    embedding = get_embedding(text_to_embed)

    db.get_db().table("stories").update({
        "embedding": embedding
    }).eq("id", story_id).execute()
