"""
One-off backfill for the catch-up feature (SPEC.md, "Pipeline" step 5).

Step (a): generate `stories.short` for recent stories from their existing
overview + sections. No transcript re-fetch. (Storyline assignment and
recaps — steps (b) and (c) — arrive with phase 2.)

A dry run is the DEFAULT. It makes no Gemini calls and writes nothing: it
counts the stories that need a short version and prints the expected cost.
Pass --apply to make the calls and write the results.

Usage:
    python backfill_catchup.py                     # dry run, last 14 days
    python backfill_catchup.py --apply --limit 5   # real calls, newest 5 only
    python backfill_catchup.py --apply             # everything still missing

Resumable: only stories whose `short` is still null are touched.
Needs supabase/migrations/stories_short.sql applied (--apply checks).
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))

import db
import llm
import summarise

# gemini-2.5-flash, paid tier, standard — $ per 1M tokens, from
# ai.google.dev/gemini-api/docs/pricing (checked 4 Oct 2026). Thinking would
# bill at the output rate, but it is off for these calls.
PRICE_IN_PER_M  = 0.30
PRICE_OUT_PER_M = 2.50
USD_TO_GBP      = 0.75   # rough — only used for the headline figure
CHARS_PER_TOKEN = 4      # English prose; errs slightly high
EST_OUT_TOKENS  = 200    # lead + 3-5 one-sentence points + JSON overhead (measured ~198 on 4 Oct)

PAGE = 500
MAX_CONSECUTIVE_FAILURES = 5   # stop spending if Gemini (or the DB) is down


def short_column_exists(client) -> bool:
    try:
        client.table("stories").select("short").limit(1).execute()
        return True
    except Exception as e:
        if "short" in str(e):
            return False
        raise


def fetch_candidates(client, since_iso: str, only_missing: bool, limit: int | None) -> list[dict]:
    """Newest first, so an interrupted run has already done the stories most
    likely to be read."""
    rows: list[dict] = []
    start = 0
    while True:
        q = (client.table("stories")
             .select("id, category, headline, summary, bullets, created_at, sources(name)")
             .gte("created_at", since_iso))
        if only_missing:
            q = q.is_("short", "null")
        res = q.order("created_at", desc=True).range(start, start + PAGE - 1).execute()
        rows += res.data
        if len(res.data) < PAGE or (limit and len(rows) >= limit):
            break
        start += PAGE
    return rows[:limit] if limit else rows


def cost_usd(in_tokens: int, out_tokens: int) -> float:
    return in_tokens / 1e6 * PRICE_IN_PER_M + out_tokens / 1e6 * PRICE_OUT_PER_M


def estimate(rows: list[dict]) -> tuple[int, int, float]:
    """Token and cost estimate from the exact prompts that would be sent."""
    in_tok = 0
    for r in rows:
        system, contents = summarise.short_prompt(
            r["headline"], r["summary"], r["bullets"], r["category"]
        )
        in_tok += (len(system) + len(contents)) // CHARS_PER_TOKEN
    out_tok = EST_OUT_TOKENS * len(rows)
    return in_tok, out_tok, cost_usd(in_tok, out_tok)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="make the Gemini calls and write results (default: dry run)")
    ap.add_argument("--days", type=int, default=14, help="how far back to look (default 14)")
    ap.add_argument("--limit", type=int, default=None, help="only the newest N candidates")
    ap.add_argument("--max-usd", type=float, default=0.75,
                    help="refuse to --apply if the estimate exceeds this (default 0.75)")
    args = ap.parse_args()

    client = db.get_db()
    has_col = short_column_exists(client)
    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).isoformat()
    rows = fetch_candidates(client, since, only_missing=has_col, limit=args.limit)
    in_tok, out_tok, usd = estimate(rows)

    print(f"Stories from the last {args.days} days needing a short version: {len(rows)}")
    if not has_col:
        print("  ! stories.short does not exist yet — run supabase/migrations/stories_short.sql."
              " Counting every story in the window.")
    print("  by category:", dict(Counter(r["category"] for r in rows)))
    print(f"Estimated Gemini 2.5 Flash cost: ~${usd:.2f} (~£{usd * USD_TO_GBP:.2f})")
    print(f"  input  ≈ {in_tok:>9,} tokens × ${PRICE_IN_PER_M}/M")
    print(f"  output ≈ {out_tok:>9,} tokens × ${PRICE_OUT_PER_M}/M  (thinking off)")

    if not args.apply:
        print("\nDry run — no Gemini calls made, nothing written. Re-run with --apply to proceed.")
        return 0

    if not has_col:
        print("\nRefusing to --apply: the stories.short column is missing.")
        return 1
    if usd > args.max_usd:
        print(f"\nRefusing to --apply: estimate ${usd:.2f} exceeds --max-usd {args.max_usd}.")
        return 1
    if not rows:
        print("\nNothing to do.")
        return 0

    llm.reset_usage()
    written = failed = consecutive = 0
    for i, r in enumerate(rows, 1):
        name = (r.get("sources") or {}).get("name", "?")
        label = f"  [{i:>3}/{len(rows)}] {name} · {r['headline'][:60]}"
        short = summarise.generate_short(r["headline"], r["summary"], r["bullets"], r["category"])
        if short is None:
            failed += 1
            consecutive += 1
            print(f"{label}  ✗ no usable short version")
        else:
            try:
                # `is null` guard: never overwrite a short the pipeline wrote meanwhile.
                client.table("stories").update({"short": short}).eq("id", r["id"]).is_("short", "null").execute()
                written += 1
                consecutive = 0
                print(f"{label}  ✓")
            except Exception as e:
                failed += 1
                consecutive += 1
                print(f"{label}  ✗ write failed: {str(e)[:100]}")
        if consecutive >= MAX_CONSECUTIVE_FAILURES:
            print(f"\nStopping: {MAX_CONSECUTIVE_FAILURES} failures in a row.")
            break

    u = llm.get_usage()
    actual = cost_usd(u["flash_input_tokens"], u["flash_output_tokens"] + u["flash_thinking_tokens"])
    print(f"\nWritten {written} · failed {failed} · calls {u['calls']}")
    print(f"Actual: {u['flash_input_tokens']:,} in / {u['flash_output_tokens']:,} out / "
          f"{u['flash_thinking_tokens']:,} thinking → ~${actual:.2f} (~£{actual * USD_TO_GBP:.2f})")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
