# SPEC — Catch-up view, storylines and short cards
**Written:** 3 October 2026, from an interview with Ash (two interactive mockups using real Flydubai data).
**Status:** approved design. Frontend foundations (tokens, primitives, reader split) built 9 Oct 2026 (roadmap session 3); **the redesign (step C: shell, short cards, five-tab nav, Sections) built 9 Oct 2026 (roadmap session 4)**: see CLAUDE.md "Redesign (session 4)". **Phase 1 (short cards) shipped 9 Oct 2026**; **phase 2 (storylines pipeline) shipped 9 Oct 2026** (roadmap sessions 1 and 2): see CLAUDE.md "Catch-up build — phase 1" and "phase 2" for the evidence, the deliberate deviations from this spec (RPC gets `p_exclude_id`; the backfill preview shortlists in Python; round-ups are excluded deterministically; recaps carry an optional `differ` list) and the prompt lessons. **Phases 3–4 (catch-up UI, verify + deploy) shipped 10 Oct 2026 (roadmap sessions 5 and 6)**: see CLAUDE.md "Catch-up view (phases 3 + 4)" for what was built, the decisions where this spec was read one way or another (one switch for all tabs; a 7-day window of unread; "40 unread" = the All chip; IGR first rather than the 2:1 mix) and the evidence.

## Problem
When Ash skips a day or more, 100–160 stories pile up (160 in the 5 days to 3 Oct). Cards are long (overview + 5 timestamped sections), and one event arrives as many near-duplicate cards: the Flydubai pilot attack produced **15+ reports from IGR and Vantage in 3 days** (three were near-identical interviews with Israel's ambassador). Clearing the backlog is impractical.

## What Ash chose
| Decision | Choice |
|---|---|
| Card default (everywhere: Reader, Archive, Search) | Short version only; **More · N timestamped sections** reveals the full sections |
| Short version | ~120 words: 1–2 sentence lead + 3–5 key-point bullets. Generated for every new video; **backfill the last 14 days** |
| Developing stories | **Storyline card**: "Developing · N reports · date range", title, recap (*So far* by date + *New on <latest date>*), **See all N reports**, **Mark all read** |
| Grouping | **Across sources** (IGR + Vantage on the same event = one storyline) |
| Which categories | **News only** (india_global, tech_ai). Prophetic never forms storylines |
| When storylines show | **Only in catch-up view**. Pipeline maintains storylines all the time; the UI shows them only in catch-up |
| Catch-up trigger | **Automatic + button**: auto-on when last visit ≥ 24 h ago **or** ≥ 40 unread; a header button toggles it any time; banner "Away 3 days · 160 new · catch-up view" with a **Normal feed** link |
| Where | **In each tab** (Today, India and Global, …), not a separate screen |
| Stories not in a storyline (catch-up only) | **Headline list** grouped by day (Today / Thu 2 Oct …), each day with **Mark day read**; tapping a row expands its short card inline |
| Reading a storyline | **Reading the recap marks all its reports read** (same dwell rule as cards, held in place until refresh), plus the explicit **Mark all read** |
| Recap generation | **In the pipeline** (4×/day), so it's ready on open |

## Evidence that shaped the design (3 Oct, real data, read-only)
- **Embeddings alone can't define a storyline.** Same-event Flydubai stories have pairwise cosine 0.63–0.90 (median 0.77); unrelated pairs reach ~0.81 (p99 of Flydubai-vs-others). A fixed threshold either misses most of a storyline (0.85, the audit's F061 suggestion) or chains unrelated stories (~0.70). → Use embeddings to **shortlist** (≥ 0.70) and a Gemini Flash call to **confirm**.
- Keyword matching also fails: "Indian captain thwarts 9/11-style attack on Dubai–Tel Aviv flight" has no "Flydubai" in its headline but is the same event (cosine 0.86–0.90 to the set).
- Reports disagree on figures (14,000 vs 17,000 ft; 140 vs 174 lives). Recaps must say so rather than pick one.
- Embeddings: `stories.embedding vector(3072)` of `"{headline}. {summary}"` (`pipeline/cluster.py`), compared with `<=>`. 3072 dims → no ivfflat/hnsw; 7-day windows are ~200 rows, so a seq scan is fine. DB is on the 500 MB free tier (embeddings ~12 KB/row) — new tables here are tiny.

## Data model (new migration in `supabase/migrations/`, Ash runs it)
- `stories.short jsonb null` — `{ "lead": text, "key_points": [text, …] }`.
- `storylines` — `id uuid pk`, `category text`, `title text`, `recap jsonb` (`{ "so_far": [{ "date": "2026-09-30", "text": … }], "latest": { "date": …, "text": … }, "differ": ["people on board: 174 vs 180"] }`; `differ` is optional: disputed figures the day entries had no room for), `story_count int`, `recap_story_count int` (count the recap was built from), `first_report_at timestamptz`, `last_report_at timestamptz`, `recap_updated_at timestamptz`, `created_at`. RLS: authenticated read; writes via service role only (match `rls_core_tables.sql`).
- `stories.storyline_id uuid null references storylines(id)` + index. A story is in at most one storyline.
- RPC `match_recent_stories(query_embedding vector(3072), p_category text, p_since timestamptz, p_min_sim float, p_limit int)` → `id, storyline_id, headline, similarity`.
- **Don't** reuse the old `clusters` table, `cluster_id` columns, `ClusteredCard`, or any removed clustering code (removed July 2026 for good reasons — see CLAUDE.md "Feature 3").

## Pipeline
1. **Short version in the main summary call** (`pipeline/summarise.py`). Add required `short: { lead, key_points[3–5] }` to `BULLET_SCHEMA` (both prompts; prophetic gets it too, since cards are short everywhere). Prompt: ~120 words total, lead 1–2 sentences, English, names and figures exact. Callers read explicit keys, but check the insert path writes `short`.
2. **Storyline assignment** (news categories, after a story is embedded). Shortlist: `match_recent_stories(..., since = now − 7 days, min_sim = 0.70, limit = 8)`. If no candidates → no storyline. Else one Flash JSON call (thinking 0): new story's headline + short lead vs candidates (existing storyline title + its latest headline, or an unassigned story's headline) → `{ "match": storyline_id | story_id | null, "title": "…" }`. Matching an unassigned story creates a storyline holding both. Round-up videos (one headline, many topics) should normally get `null` — say so in the prompt.
3. **Recap refresh** for each storyline touched this run with `story_count ≥ 3`: one Flash JSON call over members in date order (date, source, headline, short) → `{ title, so_far: [{date, text}], latest: {date, text} }`. Rules: one line per earlier day, *latest* = newest day's developments, flag conflicting figures, no repetition across sources.
4. Storylines go inactive 7 days after `last_report_at` (filter by date; no cleanup job needed).
5. **Backfill script** `pipeline/backfill_catchup.py` (one-off, `--dry-run` default): (a) `short` for the last 14 days' stories from existing `summary` + `bullets` text — no transcript re-fetch; (b) storyline assignment for the last 7 days in chronological order; (c) recaps. **Show Ash the cost estimate and the dry-run groupings before any Gemini call.**
6. Track all new calls in `llm.py`'s usage totals (they appear in `pipeline_runs`).

## Frontend
> **Since roadmap session 3 (9 Oct 2026), "`ReaderClient`" in this section means:** state and derivation in `lib/reader/*` (`ReaderProvider`; `useFeedView` holds ranking/filtering; `useReadState` holds `readIds`/`heldIds`/`markManyRead`), markup in `components/reader/*`, the screen itself `app/(app)/reader/ReaderClient.tsx` (a thin view). Reuse `components/ui/*` (`StoryRow`, `Chip`, `Sheet`, `Snackbar`, `StateMessage`) for catch-up and `lib/categories.ts` for category names/colours.

- **`StoryCard` + `ShortBody`** (were `SoloCard`; `components/story/`): show `short` (lead + bullets) when present, else fall back to `summary`. Sections hidden behind **More · N timestamped sections** (expand/collapse, `aria-expanded`). Read-time estimate should use what's shown by default.
- **Catch-up state** (`ReaderClient`): computed on mount from `prevVisit` (F012, already in the code) and unread count; header button toggles; manual choice lasts until the app is reopened. Banner with reason + **Normal feed**.
- **Catch-up queries**: tabs currently load the newest 100 (category) / 60 in the last 24 h (Today). In catch-up, load unread **since the last visit, capped at 7 days** (Today = all categories). Expect ~150–300 rows.
- **Per tab in catch-up**: storylines first (≥ 3 reports and ≥ 1 unread in this tab's pool; newest `last_report_at` first), then the headline list grouped by local day, IGR-led within each day (reuse `interleaveLead` from `lib/ranking.ts`). Today's IGR boost and India's IGR + Vantage block apply only in the normal feed.
- **Storyline card**: amber "Developing" style like the Vantage pill; recap; See all N reports → headline rows (tap = short card); Mark all read. Dwell on the card → `markManyRead(memberIds)` with hold, like dwell-read cards (`useDwellVisibility`). Reuse the F005 rollback behaviour.
- **Mark day read** → `markManyRead` for that day's singles. (Fixed in session 5: a bulk insert containing one already-read row used to fail as a whole with 23505; `markManyRead` now looks up which rows exist and inserts the rest, because this feature leans on bulk marking.)

## Cost (estimate — re-check Flash pricing first; ~$0.30/M in, $2.50/M out, thinking 0)
- Short version: +~180 output tokens per story, ~30 stories/day → **~£0.30/month**.
- Assignment: ~1.2k in / 60 out per news story → **~£0.35/month**.
- Recaps: ~2k in / 350 out each, ~8/day → **~£0.30/month**.
- **Ongoing ≈ +£1/month** on top of ~£2.50. **Backfill one-off ≈ £0.25–0.35** (I told Ash ~£0.10 in the interview; this is the corrected figure). *4 Oct, measured:* the 14-day window holds 326 stories (not ~420), so the short-version backfill is ≈ $0.28 / £0.21; the short version alone adds ≈ £0.30–0.35/month.

## Build plan (each phase shippable; commit per phase; deploy only with Ash's approval)
1. **Short cards** — schema + prompts + `SoloCard` + backfill (a). Test on one IGR, one Career 247 (Hindi) and one prophetic transcript, cost stated first. **Built 4 Oct** (branch `catchup-phase1`); the backfill is written but not run — it needs Ash to apply `supabase/migrations/stories_short.sql` first. The prompt ended up with hard word caps (35/20) and a 140-word ceiling in code, not just "~120 words": the first wording overshot and slipped on attributions.
2. **Storylines pipeline** — migration + RPC + assignment + recap + backfill (b, c), with `--dry-run` printing proposed groupings for the last 7 days. Ash eyeballs: all Flydubai reports (incl. "9/11-style" headlines) should be one storyline; round-ups should stay out.
3. **Catch-up UI** — trigger, banner, button, storyline card, headline list, read rules.
4. **Verify + deploy.** Localhost can't be signed into (Supabase redirect allowlist sends magic links to the live URL) — either Ash adds `http://localhost:3001/**` to Supabase Auth → URL Configuration → Redirect URLs, or verify on live after deploy. Simulate a gap by setting `localStorage.newsbrief_lastVisit` 3 days back; simulate failed writes with the in-page `fetch` wrapper used on 2 Oct (see CLAUDE.md "Audit fix batch").

**Models:** run the build session on **Sonnet** (pick it in the model selector); escalate to Opus only if Sonnet fails on the assignment/recap logic. Any subagent: set `model: sonnet` explicitly.

## Out of scope (noticed, not part of this)
- Round-up videos get a headline about one item while their sections cover others (e.g. "Indian markets face worst losing streak…" on 1 Oct, whose sections are about Flydubai and the UPSC centenary).
- ~~Dwell timer (120 s) may feel long on short cards~~ (9 Oct: 40 s on a short card, 120 s once its sections are open).
- ~~PWA doesn't refresh on resume~~ (built in roadmap session 7: refresh after 10 min away, a fresh start after 24 h).

## Session 8 (feature backlog): interview answers, 10 October 2026
Asked before building (roadmap rule 4); the build followed them. See CLAUDE.md "Feature backlog (roadmap session 8)" for what was built and the decisions made on top.
| Question | Ash's answer |
|---|---|
| What should Listen do? | **Per card + "Listen to the brief"**: a Listen action on every card, and a control on Today / Sections that plays the unread list in order with a mini player (pause, next, stop); screen kept awake while it plays (phones stop browser speech when they lock). |
| After a card has been read aloud | **Leave it unread.** Listening is a preview; sends no signal. |
| Where does the Saved list live? | **The Archive gets a Saved view** (By day \| Saved). No sixth tab (five bottom tabs is a standing decision). Save is on the card (⋯ menu, opened card). |
| What should Share send? | **The summary in Share** (headline, channel, short version, link) **plus "Copy for Gemini"** (a cross-check instruction on top) for one paste. |
Also from the roadmap: Saved stories are exempt from "Mark all" (bulk marks leave them unread).
