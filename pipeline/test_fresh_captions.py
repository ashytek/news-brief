"""Offline checks for fresh videos that have no captions YET (roadmap session 11).

Apify answers NO_CAPTIONS_AVAILABLE; YouTube often adds auto-captions some hours after upload. A video
younger than NO_CAPTIONS_RETRY_HOURS (48) must stay retryable ('failed' in the database), must not count
towards the per-batch 3-failure abort, must cost at most one Apify fetch per run, and must be summarised
normally once a later retry finds captions. An older video is permanent as before. A still-live Vantage
stream is parked exactly as before. Also covers the retry-pass selection (_failed_videos_to_retry).

No network, no Gemini, no Supabase, no Apify: everything that would touch the outside world is replaced.

Run from this folder:   ./venv/bin/python test_fresh_captions.py
Exits non-zero if any check fails."""
import io, os, socket, sys, time
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

# Hermetic: config.py loads pipeline/.env when it exists (real keys, a real YOUTUBE_BROWSER). An env var that
# is already set, even to "", wins over .env, so pin every one this suite could touch BEFORE anything imports
# config. Then block the network outright, so a test that forgot a stub fails loudly instead of calling out.
for k, v in {"GOOGLE_API_KEY": "test", "YOUTUBE_API_KEY": "test", "SUPABASE_URL": "http://localhost.invalid",
             "SUPABASE_SERVICE_ROLE_KEY": "test", "APIFY_TOKEN": "test", "ASSEMBLYAI_API_KEY": "",
             "YOUTUBE_BROWSER": "", "YOUTUBE_COOKIES_FILE": "", "HEALTHCHECK_URL": ""}.items():
    os.environ[k] = v
for k in ("CI", "TRANSCRIPT_LOCAL_FALLBACK_IN_CI", "NO_CAPTIONS_RETRY_HOURS"):
    os.environ.pop(k, None)
os.environ["GITHUB_ACTIONS"] = "true"   # production shape: Apify only, no local chain, no audio

def _no_network(*a, **kw):
    raise RuntimeError("network access attempted in an offline test")
socket.socket.connect = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

sys.path.insert(0, os.getcwd())
import db
import fetch_sources
import cluster
import summarise
import get_transcripts as gt
import run_pipeline as rp

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")

def quiet(fn, *a, **kw):
    buf = io.StringIO()
    with redirect_stdout(buf):
        out = fn(*a, **kw)
    return out, buf.getvalue()

time.sleep = lambda s: None   # fetch_transcript pauses 1 s per Apify call

# ---------------------------------------------------------------- fakes
NOW = datetime.now(timezone.utc)
def ago(h): return (NOW - timedelta(hours=h)).isoformat()
LONG = ("hello world " * 20, [{"text": "hello world", "start": 0, "duration": 300}])   # past the 120 s short floor

REAL_APIFY = gt._get_transcript_apify
apify_mode = {}     # youtube id -> 'nocap' | 'none' | 'ok' | 'perm'
apify_calls = []    # one entry per Apify fetch
def fake_apify(vid):
    apify_calls.append(vid)
    mode = apify_mode.get(vid, "none")
    if mode == "nocap": raise gt.NoCaptionsAvailable("Apify: NO_CAPTIONS_AVAILABLE")
    if mode == "perm": raise gt.PermanentNoTranscript("Apify: members only")
    if mode == "ok": return LONG
    return None
gt._get_transcript_apify = fake_apify
gt.APIFY_TOKEN = "tok"
gt.ASSEMBLYAI_API_KEY = ""
gt.YOUTUBE_BROWSER = ""
gt._resolve_cookie_path = lambda: None
def _local_fetcher_called(vid):
    raise AssertionError("a local fetcher (yt-dlp / youtube-transcript-api) was called")
gt._get_transcript_ytdlp = _local_fetcher_called
gt._get_transcript_ytt = _local_fetcher_called

videos = {}         # database rows by id
perm_marked = []
failed_limits = []
stories = []
class FakeTable:
    def __init__(self): self._set = None; self._id = None
    def update(self, d): self._set = d; return self
    def eq(self, col, val): self._id = val; return self
    def execute(self):
        if self._set is not None and self._id in videos: videos[self._id].update(self._set)
        class R: data = []
        return R()
class FakeClient:
    def table(self, name): return FakeTable()
def fake_upsert(rec):
    vid = "row-" + rec["external_id"]
    videos[vid] = {**rec, "id": vid}
    return vid
def fake_failed(limit=50, max_age_days=14):
    failed_limits.append(limit)
    rows = [v for v in videos.values() if v["transcript_status"] == "failed"]
    rows.sort(key=lambda v: v["published_at"], reverse=True)
    return rows[:limit]
def fake_perm(vid):
    perm_marked.append(vid)
    videos[vid]["transcript_status"] = "no_transcript"

db.get_db = lambda: FakeClient()
db.upsert_video = fake_upsert
db.get_failed_videos = fake_failed
db.mark_video_permanent_failure = fake_perm
db.get_topic_keywords = lambda: []
db.get_stories_missing_embeddings = lambda limit=50: []
db.insert_story = lambda rec: (stories.append(rec), "story-%d" % len(stories))[1]
db.tag_story_topics = lambda *a: None
fetch_sources.annotate_durations = lambda items: None
cluster.embed_and_cluster_story = lambda **kw: None
summarise.summarise_video = lambda **kw: {"headline": "H " + kw["title"], "summary": "s", "bullets": [], "short": "x"}

SOURCES = {"s1": {"name": "India Global Review", "category": "india_global"},
           "v1": {"name": "Firstpost Vantage", "category": "india_global"}}

def vid_id(n): return "vid%08d" % n    # 11 chars, as YouTube ids are
def item(n, hours_old, source="s1", **extra):
    return {"source_id": source, "external_id": vid_id(n), "title": f"video {n}",
            "url": f"https://www.youtube.com/watch?v={vid_id(n)}",
            "published_at": ago(hours_old), "transcript_status": "pending", "thumbnail_url": None, **extra}
def row_status(n): return videos["row-" + vid_id(n)]["transcript_status"]
def retry_items(): return [rp._retry_item(v) for v in rp._failed_videos_to_retry()]

def fresh_state():
    apify_mode.clear(); apify_calls.clear(); videos.clear(); perm_marked.clear(); stories.clear(); failed_limits.clear()
    gt.reset_run_state()
    return {"transcripts_fetched": 0, "stories_created": 0}

def process(items, stats=None):
    stats = stats or {"transcripts_fetched": 0, "stories_created": 0}
    return quiet(rp.process_transcripts_and_summarise, items, stats, SOURCES)

# ---------------------------------------------------------------- Apify's own answers
class FakeResp:
    status_code = 200; text = ""
    def __init__(self, payload): self._p = payload
    def json(self): return self._p
real_post = gt.requests.post
try:
    gt._get_transcript_apify = REAL_APIFY
    gt.requests.post = lambda *a, **kw: FakeResp([{"error_code": "NO_CAPTIONS_AVAILABLE"}])
    try: quiet(gt._get_transcript_apify, "abcdefghijk"); exc = None
    except gt.PermanentNoTranscript as e: exc = e
    check("Apify NO_CAPTIONS_AVAILABLE raises NoCaptionsAvailable", isinstance(exc, gt.NoCaptionsAvailable), exc)
    check("... which is still a PermanentNoTranscript for every other caller", isinstance(exc, gt.PermanentNoTranscript))
    gt.requests.post = lambda *a, **kw: FakeResp([{"transcript_text": "  ", "transcript_json": []}])
    try: quiet(gt._get_transcript_apify, "abcdefghijk"); exc = None
    except gt.PermanentNoTranscript as e: exc = e
    check("an EMPTY transcript stays a plain permanent verdict (not retried)", exc is not None and not isinstance(exc, gt.NoCaptionsAvailable), exc)
finally:
    gt.requests.post = real_post
    gt._get_transcript_apify = fake_apify

# ---------------------------------------------------------------- fetch_transcript: age decides
def fetch(n, hours_old, **extra):
    v = {"url": f"https://www.youtube.com/watch?v={vid_id(n)}", "title": "t", "video_id": "row-%s" % vid_id(n),
         "transcript_status": "failed", "published_at": ago(hours_old), "duration_seconds": 600, **extra}
    videos.setdefault(v["video_id"], {"id": v["video_id"], "transcript_status": "failed"})
    return quiet(gt.fetch_transcript, v)

fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, log = fetch(1, 3)
check("3 h old + no captions: waiting_captions, not a database status", out == (None, "waiting_captions", []), out)
check("... and NOT marked permanent", perm_marked == [], perm_marked)
check("... with a clear log line", "No captions yet, published 3h ago: will retry" in log, log)
check("... and remembered for this run", gt.already_tried_waiting(f"https://www.youtube.com/watch?v={vid_id(1)}"))

fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 47.5)
check("47.5 h old: still waiting", out[1] == "waiting_captions" and perm_marked == [], (out, perm_marked))
fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, log = fetch(1, 48.5)
check("48.5 h old: permanent, as before", out == (None, "no_transcript", []) and perm_marked == ["row-" + vid_id(1)], (out, perm_marked))
check("... and not remembered as waiting", not gt.already_tried_waiting(f"https://www.youtube.com/watch?v={vid_id(1)}"))

fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 3, published_at=None, created_at=ago(5))
check("published_at missing: first-seen time (created_at) is used", out[1] == "waiting_captions", out)
fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 3, published_at="not a date", created_at=ago(60))
check("published_at unusable: created_at used (60 h -> permanent)", out[1] == "no_transcript", out)
fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 3, published_at=None, created_at=None)
check("neither timestamp: permanent, as before", out[1] == "no_transcript" and perm_marked, out)
fresh_state(); apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 3, published_at=(NOW - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"))
check("a 'Z' timestamp (as the YouTube API sends it) parses", out[1] == "waiting_captions", out)

fresh_state(); apify_mode[vid_id(1)] = "perm"
out, _ = fetch(1, 3)
check("another permanent verdict (members only) on a FRESH video is still permanent", out[1] == "no_transcript" and perm_marked, out)

fresh_state(); apify_mode[vid_id(1)] = "ok"
out, _ = fetch(1, 3)
check("captions present: fetched as usual", out[1] == "fetched" and out[0].startswith("hello world"), out)

# the retry that finally finds captions, then one more that never does
fresh_state(); apify_mode[vid_id(1)] = "nocap"
fetch(1, 3)
check("waiting video, run 1: one Apify fetch", apify_calls == [vid_id(1)], apify_calls)
gt.reset_run_state(); apify_mode[vid_id(1)] = "ok"
out, _ = fetch(1, 9)
check("run 2, captions have appeared: fetched", out[1] == "fetched", out)

# home IP: the audio fallback still gets the first shot, then the wait applies
fresh_state(); os.environ.pop("GITHUB_ACTIONS"); gt.ASSEMBLYAI_API_KEY = "key"
gt._transcribe_via_assemblyai = lambda url: ("audio text " * 30, [{"text": "x", "start": 0, "duration": 200}])
apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 3)
check("home IP: audio fallback wins over waiting", out[1] == "fetched" and "audio" in out[0], out)
gt._transcribe_via_assemblyai = lambda url: None
fresh_state(); gt.ASSEMBLYAI_API_KEY = "key"; apify_mode[vid_id(1)] = "nocap"
out, _ = fetch(1, 3)
check("home IP, audio failed: waits", out[1] == "waiting_captions", out)
os.environ["GITHUB_ACTIONS"] = "true"; gt.ASSEMBLYAI_API_KEY = ""

# ---------------------------------------------------------------- the batch loop: no abort, stored as failed
stats = fresh_state()
for n in range(1, 6): apify_mode[vid_id(n)] = "nocap"
_, log = process([item(n, 2 + n) for n in range(1, 6)])
check("5 fresh no-caption videos in a row: ALL are handled (the 3-failure abort did not fire)",
      len(apify_calls) == 5 and "consecutive failures" not in log, (len(apify_calls), log))
check("... each is stored as 'failed' (retryable), none as no_transcript",
      all(row_status(n) == "failed" for n in range(1, 6)) and perm_marked == [], [row_status(n) for n in range(1, 6)])
check("... and the run says how many are waiting", "5 fresh video(s) waiting for captions" in log, log)

# control: real fetch failures still abort after 3 in a row
stats = fresh_state()
for n in range(1, 6): apify_mode[vid_id(n)] = "none"
_, log = process([item(n, 2 + n) for n in range(1, 6)])
check("control: 3 real fetch failures in a row still abort the batch", "3 consecutive failures" in log and len(apify_calls) == 3, (len(apify_calls), log))
check("control: the items after the abort are persisted as failed for the retry queue", all(row_status(n) == "failed" for n in (4, 5)), [videos.get('row-' + vid_id(n)) for n in (4, 5)])

# a waiting video between failures resets the streak (it proves Apify answered)
stats = fresh_state()
modes = ["none", "none", "nocap", "none", "none", "ok"]
for n, m in enumerate(modes, 1): apify_mode[vid_id(n)] = m
_, log = process([item(n, 2 + n) for n in range(1, 7)])
check("2 failures, 1 waiting, 2 failures: no abort, the last video is fetched", "consecutive failures" not in log and len(apify_calls) == 6, (len(apify_calls), log))

# ---------------------------------------------------------------- at most one fetch per video per run
stats = fresh_state()
apify_mode[vid_id(1)] = "nocap"
process([item(1, 2)])
rows = rp._failed_videos_to_retry()
check("run 1: video fetched once in the new-items pass", apify_calls == [vid_id(1)], apify_calls)
check("run 1: the retry pass does NOT pick it up again (same run)", rows == [], rows)
_, _ = process([rp._retry_item(v) for v in rows])
check("run 1: still exactly one Apify fetch", apify_calls == [vid_id(1)], apify_calls)

gt.reset_run_state()   # run 2 (6 h later)
videos["row-" + vid_id(1)]["published_at"] = ago(8)
rows = rp._failed_videos_to_retry()
check("run 2: the retry pass picks it up", [v["external_id"] for v in rows] == [vid_id(1)], rows)
process([rp._retry_item(v) for v in rows])
check("run 2: one more fetch, still waiting", apify_calls == [vid_id(1)] * 2 and row_status(1) == "failed", (apify_calls, row_status(1)))

apify_mode[vid_id(1)] = "ok"; gt.reset_run_state()   # run 3: captions have appeared
videos["row-" + vid_id(1)]["published_at"] = ago(14)
stats, log = process([rp._retry_item(v) for v in rp._failed_videos_to_retry()])
check("run 3, captions arrived: fetched, summarised, story inserted",
      row_status(1) == "fetched" and len(stories) == 1 and stories[0]["video_id"] == "row-" + vid_id(1), (row_status(1), stories))
check("... and the log says the retry worked", "Retry succeeded" in log, log)
check("... no further retries for it", rp._failed_videos_to_retry() == [])

stats = fresh_state()   # a video that never gets captions: permanent once 48 h old
apify_mode[vid_id(2)] = "nocap"
process([item(2, 40)])
check("40 h old at first sight: waiting", row_status(2) == "failed")
gt.reset_run_state(); videos["row-" + vid_id(2)]["published_at"] = ago(46)
process([rp._retry_item(v) for v in rp._failed_videos_to_retry()])
check("46 h: still waiting", row_status(2) == "failed" and perm_marked == [])
gt.reset_run_state(); videos["row-" + vid_id(2)]["published_at"] = ago(52)
process([rp._retry_item(v) for v in rp._failed_videos_to_retry()])
check("52 h: permanent, and not retried again", row_status(2) == "no_transcript" and rp._failed_videos_to_retry() == [], row_status(2))
check("... 3 Apify fetches in total for that video (one per run)", apify_calls == [vid_id(2)] * 3, apify_calls)

# ---------------------------------------------------------------- the retry pass: order, limit, no crowding
stats = fresh_state()
for n in range(1, 31):   # 30 failed videos, n=1 newest
    videos["row-" + vid_id(n)] = {"id": "row-" + vid_id(n), "source_id": "s1", "external_id": vid_id(n), "title": f"v{n}",
                                  "url": f"https://www.youtube.com/watch?v={vid_id(n)}", "published_at": ago(n),
                                  "transcript_status": "failed", "created_at": ago(n)}
rows = rp._failed_videos_to_retry()
check("retry pass: at most RETRY_PASS_LIMIT (25), newest first",
      len(rows) == rp.RETRY_PASS_LIMIT == 25 and [v["external_id"] for v in rows] == [vid_id(n) for n in range(1, 26)], [v["external_id"] for v in rows][:3])
check("retry pass: asks the database for at least 50 (so skipped rows don't shrink the batch)", failed_limits and failed_limits[-1] >= 50, failed_limits)
gt._waiting_this_run.update({vid_id(2), vid_id(3), vid_id(4)})   # fetched earlier in this run
rows = rp._failed_videos_to_retry()
check("retry pass: the 3 waiting this run are skipped and replaced by older ones",
      len(rows) == 25 and not ({vid_id(2), vid_id(3), vid_id(4)} & {v["external_id"] for v in rows}) and rows[-1]["external_id"] == vid_id(28), [v["external_id"] for v in rows][-2:])
check("retry item carries created_at (the age fallback)", rp._retry_item(rows[0])["created_at"] is not None)

# new items are never behind the waiting backlog: they are processed before the retry pass in run_once,
# and the retry pass is the only place a backlog is read. Prove the order the code relies on.
src = open("run_pipeline.py").read()
check("run_once: new items are processed before the retry pass",
      src.index("process_transcripts_and_summarise(new_items") < src.index("_failed_videos_to_retry()", src.index("def run_once")))

# ---------------------------------------------------------------- Vantage live streams: unchanged
stats = fresh_state()
live = item(7, 1, source="v1", duration_seconds=0)
_, log = process([live])
check("live Vantage stream: parked as failed WITHOUT an Apify fetch", row_status(7) == "failed" and apify_calls == [] and "Deferred live Vantage stream" in log, (row_status(7), apify_calls))

stats = fresh_state()
for n in (7, 8, 9, 10): apify_mode[vid_id(n)] = "none"
items = [item(7, 1, source="v1", duration_seconds=0), item(8, 1, source="v1", duration_seconds=0),
         item(9, 1, source="v1", duration_seconds=0), item(10, 1, source="v1", duration_seconds=0)]
_, log = process(items)
check("four live Vantage streams in a row: none counts towards the abort, none is fetched", "consecutive failures" not in log and apify_calls == [], (apify_calls, log))

stats = fresh_state(); apify_mode[vid_id(11)] = "nocap"
_, log = process([item(11, 2, source="v1", duration_seconds=480)])
check("a finished Vantage segment (8 min) with no captions yet: waits like any other", row_status(11) == "failed" and apify_calls == [vid_id(11)], (row_status(11), apify_calls))

stats = fresh_state(); apify_mode[vid_id(12)] = "nocap"
_, log = process([item(12, 2, source="v1", duration_seconds=3700)])
check("a long (>20 min) Vantage episode is still skipped before any fetch", row_status(12) == "skipped_filter" and apify_calls == [], (row_status(12), apify_calls))

# ---------------------------------------------------------------- the one-off reset script
import reset_fresh_no_captions as rs

class ResetQuery:
    """Just enough of the Supabase query builder for reset_fresh_no_captions: select/eq/gte/order/update/execute."""
    def __init__(self, store, log): self.store, self.log = store, log; self.filters = []; self.upd = None
    def select(self, cols): return self
    def update(self, d): self.upd = d; return self
    def eq(self, col, val): self.filters.append(("eq", col, val)); return self
    def gte(self, col, val): self.filters.append(("gte", col, val)); return self
    def order(self, *a, **kw): self.desc = kw.get("desc"); return self
    def execute(self):
        rows = [r for r in self.store if all((r[c] == v) if op == "eq" else (str(r[c]) >= v) for op, c, v in self.filters)]
        if getattr(self, "desc", False): rows = sorted(rows, key=lambda r: r["published_at"], reverse=True)
        if self.upd is not None:
            self.log.append((self.upd, [r["id"] for r in rows]))
            for r in rows: r.update(self.upd)
        class R: pass
        out = R(); out.data = [dict(r) for r in rows]
        return out
class ResetClient:
    def __init__(self, rows): self.rows, self.updates = rows, []
    def table(self, name):
        assert name == "videos", name
        return ResetQuery(self.rows, self.updates)

def vrow(rid, yt, hours_old, status="no_transcript", text=None, marked_h_ago=None, url=None, src="India Global Review"):
    return {"id": rid, "external_id": yt, "title": "title " + rid, "url": url or f"https://www.youtube.com/watch?v={yt}",
            "published_at": ago(hours_old), "created_at": ago(hours_old), "fetched_at": ago(marked_h_ago if marked_h_ago is not None else hours_old - 1),
            "transcript_status": status, "transcript_text": text, "sources": {"name": src, "source_type": "youtube_channel"}}
S9 = rs.SESSION9_CI_CUTOFF
rows = [
    vrow("a", "aaaaaaaaaaa", 5, marked_h_ago=4),                               # fresh, marked after the cutoff only if NOW is after it
    vrow("b", "bbbbbbbbbbb", 30),
    vrow("c", "ccccccccccc", 60),
    vrow("d", "ddddddddddd", 80),                                              # outside 72 h
    vrow("e", "eeeeeeeeeee", 5, status="failed"),                              # already retryable
    vrow("f", "fffffffffff", 5, status="fetched", text="a transcript"),        # fine
    vrow("g", "ggggggggggg", 5, text="somehow has text"),                      # has text: leave
    vrow("h", "hhhhhhhhhhh", 5, url="https://example.com/article"),            # not YouTube
    vrow("i", "iiiiiiiiiii", 5, status="skipped_short"),                       # a different outcome
]
client = ResetClient(rows)
out, log = quiet(rs.main, [], client, NOW)
check("dry run: exit code 0", out == 0)
check("dry run: lists exactly the three no-caption candidates in the last 72 h, newest first",
      [l.split()[0] for l in log.splitlines() if l.startswith("  ") and "pub " in l] == ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"], log)
check("dry run: says it is a dry run", "DRY RUN" in log and "nothing was changed" in log, log)
check("dry run: makes NO update at all", client.updates == [] and all(r["transcript_status"] == v for r, v in zip(rows, ["no_transcript"]*4 + ["failed", "fetched", "no_transcript", "no_transcript", "skipped_short"])), client.updates)
check("dry run: the table shows id, source, published, marked, status and title",
      "India Global Review" in log and "status=no_transcript" in log and "title a" in log and "pub 20" in log, log)

out, log = quiet(rs.main, ["--only", "bbbbbbbbbbb"], ResetClient([dict(r) for r in rows]), NOW)
check("--only restricts the list", log.count("pub ") == 1 and "bbbbbbbbbbb" in log, log)
out, log = quiet(rs.main, ["--hours", "48"], ResetClient([dict(r) for r in rows]), NOW)
check("--hours 48 drops the 60 h old one", log.count("pub ") == 2 and "ccccccccccc" not in log, log)

# confidence follows the marked-at time against the session-9 cutoff
old_marked = vrow("o", "ooooooooooo", 5, marked_h_ago=(NOW - (S9 - timedelta(hours=1))).total_seconds() / 3600)
new_marked = vrow("n", "nnnnnnnnnnn", 5, marked_h_ago=(NOW - (S9 + timedelta(hours=1))).total_seconds() / 3600)
c = {x["yt_id"]: x["confidence"] for x in rs.find_candidates(ResetClient([old_marked, new_marked]), NOW, 72)}
check("marked before the session-9 cutoff: 'unsure'; after: 'likely'", c == {"ooooooooooo": "unsure", "nnnnnnnnnnn": "likely"}, c)

# --apply
rows2 = [dict(r) for r in rows]
client2 = ResetClient(rows2)
out, log = quiet(rs.main, ["--apply"], client2, NOW)
check("--apply: sets exactly the three candidates to 'failed'", {r["id"] for r in rows2 if r["transcript_status"] == "failed"} == {"a", "b", "c", "e"}
      and [r["transcript_status"] for r in rows2 if r["id"] in "dfghi"] == ["no_transcript", "fetched", "no_transcript", "no_transcript", "skipped_short"], [(r["id"], r["transcript_status"]) for r in rows2])
check("--apply: one update per candidate, each guarded by status = no_transcript", len(client2.updates) == 3 and all(u[0] == {"transcript_status": "failed"} for u in client2.updates))
check("--apply: reports the count", "APPLIED: 3 of 3" in log, log)
check("--apply: only the status column is written (no text, no timestamps)", all(list(u[0].keys()) == ["transcript_status"] for u in client2.updates))
out, log = quiet(rs.main, ["--apply"], client2, NOW)
check("running --apply again is a no-op", "Nothing to do" in log and len(client2.updates) == 3, log)

# a row that changed between the list and the update is left alone
rows3 = [vrow("a", "aaaaaaaaaaa", 5), vrow("b", "bbbbbbbbbbb", 30)]
client3 = ResetClient(rows3)
cands = rs.find_candidates(client3, NOW, 72)
rows3[0]["transcript_status"] = "fetched"      # another process rescued it
changed = rs.apply_reset(client3, cands)
check("a row rescued in the meantime is not overwritten", changed == 1 and rows3[0]["transcript_status"] == "fetched" and rows3[1]["transcript_status"] == "failed", rows3)

# ---------------------------------------------------------------- the workflow / config wiring
import config
check("NO_CAPTIONS_RETRY_HOURS defaults to 48", config.NO_CAPTIONS_RETRY_HOURS == 48.0, config.NO_CAPTIONS_RETRY_HOURS)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
