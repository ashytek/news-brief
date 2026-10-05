"""
One-off backfill for the catch-up feature (SPEC.md, "Pipeline" step 5).

  (a) short version   — `stories.short` for recent stories, from their existing
                        overview + sections. No transcript re-fetch.
  (b) storylines      — group the last 7 days of news stories into storylines.
  (c) recaps          — one running recap per storyline with 3+ reports.

Every mode is a DRY RUN unless it says otherwise. The default (no flags) makes
no Gemini calls and writes nothing: it prints what (a) and (b) would cost.

Usage:
    # (a) short versions — last 14 days
    python backfill_catchup.py                     # dry run + (b) estimate
    python backfill_catchup.py --apply --limit 5   # real calls, newest 5 only
    python backfill_catchup.py --apply             # everything still missing

    # (b) storylines — Gemini calls but NO database writes until you apply
    python backfill_catchup.py --storylines-preview [--find "fly ?dubai"]
                                                   # groupings -> storylines_preview.json
    python backfill_catchup.py --storylines-apply storylines_preview.json
                                                   # writes exactly those groupings; no Gemini

    # (c) recaps — needs (b) applied; the cron does this on its next run anyway
    python backfill_catchup.py --recaps            # list + cost, no Gemini
    python backfill_catchup.py --recaps --apply    # real calls, writes

Suggested order: (a), then (b), then (c). (b) works before (a) (it falls back to
each story's overview), but the short lead gives the model a cleaner gist.
(a) is resumable (only stories whose `short` is still null are touched).
(a) needs supabase/migrations/stories_short.sql; --storylines-apply and --recaps
need supabase/migrations/storylines.sql. The preview needs neither.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))

import db
import llm
import storylines
import summarise

# gemini-2.5-flash, paid tier, standard — $ per 1M tokens, from
# ai.google.dev/gemini-api/docs/pricing (checked 4 Oct 2026). Thinking would
# bill at the output rate, but it is off for these calls.
PRICE_IN_PER_M  = 0.30
PRICE_OUT_PER_M = 2.50
USD_TO_GBP      = 0.75   # rough — only used for the headline figure
CHARS_PER_TOKEN = 4      # English prose; errs slightly high
EST_OUT_TOKENS  = 200    # lead + 3-5 one-sentence points + JSON overhead (measured ~198 on 4 Oct)
EST_ASSIGN_OUT  = 15     # {"match": "B", "title": "…"}; measured 12.4 avg on the 5 Oct preview (SPEC guessed 60)
EST_RECAP_OUT   = 400    # title + so_far lines + latest (SPEC.md says ~350)

PAGE = 500
POOL_PAGE = 40           # embeddings are ~55 KB of JSON each — keep pages small
MAX_CONSECUTIVE_FAILURES = 5   # stop spending if Gemini (or the DB) is down
NEAR_MISS_SIM = 0.85     # unassigned stories this close to a candidate are worth a look


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


def money(usd: float) -> str:
    return f"~${usd:.2f} (~£{usd * USD_TO_GBP:.2f})"


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


# ---------------------------------------------------------------------------
# (a) short versions
# ---------------------------------------------------------------------------

def short_step(args) -> int:
    days = args.days or 14
    client = db.get_db()
    has_col = short_column_exists(client)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = fetch_candidates(client, since, only_missing=has_col, limit=args.limit)
    in_tok, out_tok, usd = estimate(rows)

    print(f"Stories from the last {days} days needing a short version: {len(rows)}")
    if not has_col:
        print("  ! stories.short does not exist yet — run supabase/migrations/stories_short.sql."
              " Counting every story in the window.")
    print("  by category:", dict(Counter(r["category"] for r in rows)))
    print(f"Estimated Gemini 2.5 Flash cost: {money(usd)}")
    print(f"  input  ≈ {in_tok:>9,} tokens × ${PRICE_IN_PER_M}/M")
    print(f"  output ≈ {out_tok:>9,} tokens × ${PRICE_OUT_PER_M}/M  (thinking off)")

    if not args.apply:
        print("\n── (b) storylines, last 7 days (no Gemini calls made to produce this) ──")
        storylines_estimate(client, args.days or storylines.WINDOW_DAYS)
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

    report_usage(written, failed)
    return 0 if failed == 0 else 2


def report_usage(written: int, failed: int) -> None:
    u = llm.get_usage()
    actual = cost_usd(u["flash_input_tokens"], u["flash_output_tokens"] + u["flash_thinking_tokens"])
    print(f"\nWritten {written} · failed {failed} · calls {u['calls']}")
    print(f"Actual: {u['flash_input_tokens']:,} in / {u['flash_output_tokens']:,} out / "
          f"{u['flash_thinking_tokens']:,} thinking → {money(actual)}")


# ---------------------------------------------------------------------------
# (b) storylines
# ---------------------------------------------------------------------------

def load_pool(client, since_iso: str) -> list[dict]:
    """News stories since `since_iso` that have an embedding, oldest first, with
    their vectors. Tolerates a database where `short` / `storyline_id` do not
    exist yet (the preview runs before the migrations)."""
    def build(cols):
        rows, start = [], 0
        while True:
            res = (client.table("stories").select(cols)
                   .in_("category", list(storylines.NEWS_CATEGORIES))
                   .gte("created_at", since_iso).not_.is_("embedding", "null")
                   .order("created_at").range(start, start + POOL_PAGE - 1).execute())
            rows += res.data
            if len(res.data) < POOL_PAGE:
                return rows
            start += POOL_PAGE
    return storylines.fetch_stories(build, extra=["embedding"])


def load_existing_storylines(client) -> dict[str, dict]:
    """Storylines already in the database ({} before the migration), so a
    backfill after the cron has made some does not trample them."""
    try:
        rows = client.table("storylines").select("id, title, category, story_count").execute().data
    except Exception as e:
        if storylines._is_missing(e):
            return {}
        raise
    return {r["id"]: {"id": r["id"], "title": r["title"], "category": r["category"],
                      "count": r["story_count"]} for r in rows}


def make_replay(client, days: int) -> tuple[storylines.MemoryBackend, list[dict]]:
    """A MemoryBackend holding the stories that are already assigned, plus the
    unassigned ones to replay in time order."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pool = load_pool(client, since)
    backend = storylines.MemoryBackend([s for s in pool if s.get("storyline_id")])
    backend.storylines = load_existing_storylines(client)
    todo = [s for s in pool if not s.get("storyline_id")]   # already oldest first
    return backend, todo


def storylines_estimate(client, days: int) -> tuple[int, float]:
    """How many Gemini confirm calls the preview will make, and what they cost.
    The call count is exact: a story has a candidate (>= 0.70) or not whatever
    has been grouped. Tokens are an upper bound (grouping only merges entries)."""
    backend, todo = make_replay(client, days)
    engine = storylines.Engine(backend)
    already = len(backend.stories)
    calls = in_chars = 0
    for s in todo:
        entries = backend.candidates(s)
        if entries:
            contents, _ = engine.build_prompt(s, entries)
            in_chars += len(storylines.ASSIGN_SYSTEM) + len(contents)
            calls += 1
        backend.add(s)
    in_tok, out_tok = in_chars // CHARS_PER_TOKEN, EST_ASSIGN_OUT * calls
    usd = cost_usd(in_tok, out_tok)
    print(f"News stories to place: {len(todo)} · by category: {dict(Counter(s['category'] for s in todo))}"
          + (f" · {already} already in a storyline" if already else ""))
    print(f"  with at least one candidate (cosine >= {storylines.MIN_SIM}): {calls}"
          f"  → {calls} Flash calls; the other {len(todo) - calls} need none")
    print(f"Estimated Gemini 2.5 Flash cost: {money(usd)}")
    print(f"  input  ≈ {in_tok:>9,} tokens × ${PRICE_IN_PER_M}/M")
    print(f"  output ≈ {out_tok:>9,} tokens × ${PRICE_OUT_PER_M}/M  (thinking off)")
    print("  (recaps, step c, come after this and cost a little more; see --recaps)")
    return calls, usd


def day_str(iso: str) -> str:
    return storylines._day_label(storylines._dt(iso))


def storylines_preview(args) -> int:
    client = db.get_db()
    days = args.days or storylines.WINDOW_DAYS
    backend, todo = make_replay(client, days)
    calls, usd = storylines_estimate(client, days)
    if usd > args.max_usd:
        print(f"\nRefusing: estimate ${usd:.2f} exceeds --max-usd {args.max_usd}.")
        return 1
    if not todo:
        print("\nNothing to place.")
        return 0

    print(f"\nReplaying {len(todo)} stories oldest-first — Gemini calls, NO database writes…")
    llm.reset_usage()
    engine = storylines.Engine(backend)
    stopped = False
    for i, s in enumerate(todo, 1):
        rec = engine.process(s)
        if rec["action"] != "none" or rec["candidates"]:
            print(f"  [{i:>3}/{len(todo)}] {rec['action']:<6} {s['source']:<20} {s['headline'][:70]}")
        if engine.llm_failures >= MAX_CONSECUTIVE_FAILURES:
            print(f"\nStopping: {engine.llm_failures} Gemini failures in a row.")
            stopped = True
            break

    snapshot = backend.snapshot()
    new = [e for e in snapshot if e["key"].startswith("S") and e["key"][1:].isdigit()]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "days": days,
        "complete": not stopped,
        "decisions": [d for d in engine.decisions if d["action"] in ("join", "create")],
        "storylines": new,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)

    print_groupings(snapshot, engine.decisions, args.find)
    u = llm.get_usage()
    actual = cost_usd(u["flash_input_tokens"], u["flash_output_tokens"] + u["flash_thinking_tokens"])
    print(f"\nGemini: {u['calls']} calls · {u['failures']} failures · "
          f"{u['flash_input_tokens']:,} in / {u['flash_output_tokens']:,} out → {money(actual)}"
          f"  (estimate was {money(usd)})")
    print(f"Saved {args.out}" + ("" if not stopped else "  (INCOMPLETE — do not apply)"))
    print(f"To write exactly these groupings (no Gemini): --storylines-apply {args.out}")
    return 2 if stopped else 0


def print_groupings(snapshot: list[dict], decisions: list[dict], find: str | None) -> None:
    multi = [e for e in snapshot if len(e["members"]) >= 2]
    print(f"\n{'=' * 72}\nSTORYLINES FOUND: {len(multi)} "
          f"({sum(len(e['members']) for e in multi)} reports)  ·  "
          f"with 3+ reports (these get a recap): {sum(1 for e in multi if len(e['members']) >= 3)}")
    for e in multi:
        print(f"\n● {e['title']}  [{e['key']} · {len(e['members'])} reports · {e['category']}]")
        for m in e["members"]:
            print(f"    {day_str(m['when'])} · {m['source']:<18} {m['headline'][:80]}")

    near = sorted((d for d in decisions if d["action"] == "none" and (d["best_sim"] or 0) >= NEAR_MISS_SIM),
                  key=lambda d: -d["best_sim"])
    if near:
        print(f"\nNear misses — left alone although a candidate scored >= {NEAR_MISS_SIM} (worth a look):")
        for d in near[:15]:
            print(f"    {d['best_sim']:.2f}  {day_str(d['when'])} · {d['headline'][:80]}")

    if find:
        pat = re.compile(find, re.I)
        by_story = {m["id"]: e for e in snapshot for m in e["members"]}
        hits = [d for d in decisions if pat.search(d["headline"])]
        print(f"\nStories matching /{find}/ ({len(hits)}), and where they landed:")
        for d in hits:
            e = by_story.get(d["story"])
            where = f"{e['key']} “{e['title'][:40]}”" if e and len(e["members"]) >= 2 else "no storyline"
            print(f"    {day_str(d['when'])} · {d['headline'][:60]:<60} → {where}")


def storylines_apply(args) -> int:
    with open(args.storylines_apply) as f:
        plan = json.load(f)
    if not plan.get("complete"):
        print("Refusing: that preview stopped early. Re-run --storylines-preview.")
        return 1
    decisions = plan["decisions"]
    client = db.get_db()
    backend = storylines.DbBackend(client)
    try:
        client.table("storylines").select("id").limit(1).execute()
        client.table("stories").select("storyline_id").limit(1).execute()
    except Exception as e:
        if storylines._is_missing(e):
            print("Refusing: run supabase/migrations/storylines.sql first.")
            return 1
        raise

    ids = {d["story"] for d in decisions} | {d["other"] for d in decisions if d.get("other")}
    taken = set()
    for i in range(0, len(ids), 100):
        chunk = list(ids)[i:i + 100]
        taken |= {r["id"] for r in client.table("stories").select("id, storyline_id").in_("id", chunk)
                  .not_.is_("storyline_id", "null").execute().data}
    existing = set(load_existing_storylines(client))
    print(f"Applying {len(decisions)} decisions ({len(taken)} stories already in a storyline are skipped)…")

    keymap: dict[str, str] = {}
    made = joined = skipped = 0
    for d in decisions:
        members = [d["story"]] + ([d["other"]] if d.get("other") else [])
        if any(m in taken for m in members):
            skipped += 1
            continue
        stubs = [{"id": m} for m in members]
        if d["action"] == "create":
            keymap[d["target"]] = backend.create_storyline(d["category"], d["title"])
            backend.assign(stubs, keymap[d["target"]])
            made += 1
        else:
            sid = keymap.get(d["target"]) or (d["target"] if d["target"] in existing else None)
            if sid is None:
                skipped += 1      # its storyline was skipped above
                continue
            backend.assign(stubs, sid)
            joined += 1
    print(f"Created {made} storylines · {joined} reports joined · {skipped} decisions skipped.")
    print("Next: --recaps (or let the next scheduled run do it).")
    return 0


# ---------------------------------------------------------------------------
# (c) recaps
# ---------------------------------------------------------------------------

def recaps_step(args) -> int:
    backend = storylines.DbBackend(db.get_db())
    try:
        targets = backend.recap_targets()
    except storylines.NotMigrated:
        print("Refusing: run supabase/migrations/storylines.sql first.")
        return 1
    in_chars = 0
    for sl in targets:
        system, contents = storylines.recap_prompt(sl["title"], backend.members(sl["id"]))
        in_chars += len(system) + len(contents)
    in_tok, out_tok = in_chars // CHARS_PER_TOKEN, EST_RECAP_OUT * len(targets)
    usd = cost_usd(in_tok, out_tok)
    print(f"Storylines (3+ reports, active) whose recap is missing or stale: {len(targets)}")
    for sl in targets:
        print(f"    {sl['story_count']:>2} reports · {sl['title'][:70]}")
    print(f"Estimated Gemini 2.5 Flash cost: {money(usd)}")
    print(f"  input  ≈ {in_tok:>9,} tokens × ${PRICE_IN_PER_M}/M")
    print(f"  output ≈ {out_tok:>9,} tokens × ${PRICE_OUT_PER_M}/M  (thinking off)")
    if not args.apply:
        print("\nDry run — no Gemini calls made, nothing written. Re-run with --recaps --apply to proceed.")
        return 0
    if usd > args.max_usd:
        print(f"\nRefusing to --apply: estimate ${usd:.2f} exceeds --max-usd {args.max_usd}.")
        return 1
    if not targets:
        print("\nNothing to do.")
        return 0
    llm.reset_usage()
    stats = storylines.refresh_recaps(backend)
    report_usage(stats["refreshed"], stats["failed"])
    return 0 if stats["failed"] == 0 else 2


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="(a) and --recaps: make the Gemini calls and write results (default: dry run)")
    ap.add_argument("--days", type=int, default=None,
                    help="how far back to look (default: 14 for short versions, 7 for storylines)")
    ap.add_argument("--limit", type=int, default=None, help="(a) only: the newest N candidates")
    ap.add_argument("--max-usd", type=float, default=0.75,
                    help="refuse to make Gemini calls if the estimate exceeds this (default 0.75)")
    ap.add_argument("--storylines-preview", action="store_true",
                    help="(b) place the last 7 days of news into storylines with Gemini calls but NO "
                         "database writes; saves the groupings for --storylines-apply")
    ap.add_argument("--out", default="storylines_preview.json", help="where --storylines-preview saves")
    ap.add_argument("--find", metavar="REGEX",
                    help="with --storylines-preview: show where stories whose headline matches landed")
    ap.add_argument("--storylines-apply", metavar="FILE",
                    help="(b) write the groupings saved by --storylines-preview (no Gemini calls)")
    ap.add_argument("--recaps", action="store_true",
                    help="(c) list storylines needing a recap and the cost; with --apply, write them")
    args = ap.parse_args()

    if args.storylines_apply:
        return storylines_apply(args)
    if args.storylines_preview:
        return storylines_preview(args)
    if args.recaps:
        return recaps_step(args)
    return short_step(args)


if __name__ == "__main__":
    sys.exit(main())
