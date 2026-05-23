"""
Nightly personal-ranking weight update.

Aggregates last-24h engagement signals into per-user source and topic weights.
Called automatically from run_pipeline.py once per day at the 06:xx run.

Signal → weight delta mapping:
  dwell_long   → topic + 0.05   (user read at depth — boosted interest)
  dwell_short  → topic − 0.02   (user skipped fast — slight negative)
  like         → topic + 0.10   (explicit positive signal)
  dislike      → topic − 0.10   (explicit negative signal)
  mute_topic   → topic → 0.30   (hard floor — persistent low-rank)

Source weights are adjusted in real-time from the frontend (adjust_source_weight RPC)
so this script only handles topic weights.

This script uses the service-role key so it can write to source_weights and
topic_weights even though they have RLS. It aggregates across ALL users.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import db

# Delta values per signal type
_TOPIC_DELTAS = {
    "dwell_long":  +0.05,
    "dwell_short": -0.02,
    "like":        +0.10,
    "dislike":     -0.10,
}
_MUTE_TOPIC_WEIGHT = 0.30   # hard floor when explicitly muted
_LOOK_BACK_HOURS   = 24


def run():
    """Run the weight update. Called by run_pipeline.py once per day."""
    print(f"\n[Weights] Updating user preference weights from last {_LOOK_BACK_HOURS}h engagement…")
    client = db.get_db()

    since = (datetime.now(timezone.utc) - timedelta(hours=_LOOK_BACK_HOURS)).isoformat()

    # Fetch engagement events with a story attached
    result = client.table("engagement") \
        .select("user_id, story_id, signal, created_at") \
        .gte("created_at", since) \
        .not_.is_("story_id", "null") \
        .execute()

    events = result.data
    if not events:
        print("  [Weights] No engagement events in last 24h — skipping")
        return

    # Collect story IDs we need
    story_ids = list(set(e["story_id"] for e in events))

    # Fetch matched_topics + source_id for those stories (small batch)
    stories_res = client.table("stories") \
        .select("id, source_id, matched_topics") \
        .in_("id", story_ids) \
        .execute()
    story_map: dict[str, dict] = {s["id"]: s for s in stories_res.data}

    print(f"  [Weights] Processing {len(events)} events across {len(story_ids)} stories")

    # Accumulate deltas: (user_id, keyword) → total delta
    topic_deltas: dict[tuple[str, str], float] = {}
    # Muted pairs: (user_id, keyword) → hard-set to floor
    muted_pairs: set[tuple[str, str]] = set()

    for event in events:
        user_id = event["user_id"]
        story   = story_map.get(event["story_id"])
        signal  = event["signal"]
        if not story:
            continue

        topics = story.get("matched_topics") or []
        if not topics:
            continue

        if signal == "mute_topic":
            for t in topics:
                muted_pairs.add((user_id, t))
            continue

        delta = _TOPIC_DELTAS.get(signal, 0.0)
        if delta == 0.0:
            continue

        for t in topics:
            key = (user_id, t)
            topic_deltas[key] = topic_deltas.get(key, 0.0) + delta

    # Apply topic weight deltas via RPC
    applied = 0
    for (user_id, keyword), delta in topic_deltas.items():
        try:
            client.rpc("adjust_topic_weight", {
                "p_user_id": user_id,
                "p_kw":      keyword,
                "p_delta":   delta,
            }).execute()
            applied += 1
        except Exception as e:
            print(f"  [Weights] ✗ adjust_topic_weight({keyword}): {e}")

    # Hard-set muted topic weights to floor
    muted = 0
    for user_id, keyword in muted_pairs:
        try:
            client.table("topic_weights").upsert({
                "user_id":    user_id,
                "kw":         keyword,
                "weight":     _MUTE_TOPIC_WEIGHT,
                "updated_at": "now()",
            }, on_conflict="user_id,kw").execute()
            muted += 1
        except Exception as e:
            print(f"  [Weights] ✗ mute_topic_weight({keyword}): {e}")

    print(f"  [Weights] ✓ {applied} topic adjustments, {muted} mutes applied")


if __name__ == "__main__":
    run()
