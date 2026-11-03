"""Offline checks for the "Gemini prepaid credit used up" alarm and the wider summary-recovery pass (3 Nov 2026).

From 27 Oct to 3 Nov 2026 every Gemini call was refused with 402 RESOURCE_EXHAUSTED "Your prepayment credits are
depleted". llm.py treated it as retryable, so each run retried ~33 videos 5 times, saved nothing and still finished
green ('partial'), and the recovery pass only looked back 72 h, so 91 transcripts fell out of it. Checked here:
  - the refusal is recognised (google-genai code, requests status, the message under another code) and never retried;
    after the first one, no Gemini or embedding request is made again in the process;
  - run_once stops, records status 'failed' with the fixed marker the app reads, pings the healthcheck down and returns
    False (main exits 1), including when a fail-soft step swallowed the refusal; a normal run is unchanged;
  - the recovery pass looks back 168 h by default, the dispatch inputs widen it, and it sees old orphans the previous
    query missed; the workflow wires the inputs.

No network, no Supabase, no Gemini: stubs and fakes only, and a socket tripwire guards the rest.

Run from this folder:   ./venv/bin/python test_credit_alarm.py
Exits non-zero if any check fails."""
import io, os, socket, sys
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

# Hermetic (see test_fresh_captions.py): pin everything .env could fill, then block the network.
for k, v in {"GOOGLE_API_KEY": "SECRETKEY123", "YOUTUBE_API_KEY": "test", "SUPABASE_URL": "http://localhost.invalid",
             "SUPABASE_SERVICE_ROLE_KEY": "test", "APIFY_TOKEN": "", "ASSEMBLYAI_API_KEY": "",
             "YOUTUBE_BROWSER": "", "YOUTUBE_COOKIES_FILE": "", "HEALTHCHECK_URL": ""}.items():
    os.environ[k] = v
for k in ("PIPELINE_SKIP_IF_RECENT_HOURS", "PIPELINE_TRIGGER_SOURCE", "PIPELINE_RECOVER_HOURS", "PIPELINE_RECOVER_LIMIT"):
    os.environ.pop(k, None)

def _no_network(*a, **kw):
    raise RuntimeError("network access attempted in an offline test")
socket.socket.connect = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

sys.path.insert(0, os.getcwd())
import requests
import llm
import cluster
import db
import run_pipeline as rp

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")

def quiet(fn, *a, **kw):
    """Run fn with stdout captured; returns (result, exception, output)."""
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            return fn(*a, **kw), None, buf.getvalue()
    except BaseException as e:   # SystemExit too
        return None, e, buf.getvalue()

sleeps = []
import time as _time
_time.sleep = lambda s: sleeps.append(s)   # llm/cluster back-off never really waits

# ---------------------------------------------------------------- recognising the refusal
class GenaiError(Exception):
    """The shape google-genai raises: str() starts with the code, .code is an int."""
    def __init__(self, code, text):
        super().__init__(f"{code} {text}")
        self.code = code

DEPLETED = GenaiError(402, "RESOURCE_EXHAUSTED. {'error': {'code': 402, 'message': 'Your prepayment credits are depleted. Please go to AI Studio'}}")
RATE = GenaiError(429, "RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'Resource has been exhausted (e.g. check quota).'}}")

def http_error(status, url="https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=SECRETKEY123"):
    r = requests.Response(); r.status_code = status; r.url = url; r.reason = "Payment Required" if status == 402 else "Error"
    try: r.raise_for_status()
    except requests.HTTPError as e: return e
    raise AssertionError("raise_for_status did not raise")

check("402 from google-genai is a credit error", llm.is_credit_error(DEPLETED))
check("402 from requests (embeddings) is a credit error", llm.is_credit_error(http_error(402)))
check("the depletion message under 429 is a credit error",
      llm.is_credit_error(GenaiError(429, "RESOURCE_EXHAUSTED. Your prepayment credits are depleted.")))
check("an ordinary 429 quota error is not", not llm.is_credit_error(RATE))
check("a 503 is not", not llm.is_credit_error(GenaiError(503, "UNAVAILABLE")))
check("a requests 429 is not", not llm.is_credit_error(http_error(429)))
check("a message that merely contains 402 is not", not llm.is_credit_error(ValueError("video 4021 had 402 words")))
check("the stored note carries the marker the app reads", llm.CREDIT_DEPLETED_NOTE.startswith(llm.CREDIT_DEPLETED_MARKER + ":"))
check("the stored note is fixed text (no URL, no key)", "key=" not in llm.CREDIT_DEPLETED_NOTE and "http" not in llm.CREDIT_DEPLETED_NOTE)

# ---------------------------------------------------------------- llm._generate
class FakeModels:
    def __init__(self, script): self.script = list(script); self.calls = 0
    def generate_content(self, **kw):
        self.calls += 1
        step = self.script.pop(0) if self.script else "ok"
        if isinstance(step, BaseException): raise step
        class U: prompt_token_count = 10; candidates_token_count = 5; thoughts_token_count = 0
        class R: text = '{"a": 1}'; usage_metadata = U()
        return R()
class FakeClient:
    def __init__(self, script): self.models = FakeModels(script)

def fresh(script):
    llm.reset_credit_state(); llm.reset_usage(); sleeps.clear()
    llm._client = FakeClient(script)
    return llm._client.models

m = fresh([DEPLETED])
_, err, _ = quiet(llm._generate, model="gemini-2.5-flash", contents="x")
check("_generate: a 402 raises CreditsExhausted", isinstance(err, llm.CreditsExhausted), repr(err))
check("_generate: ...after exactly one request (no retries)", m.calls == 1, m.calls)
check("_generate: ...without sleeping", sleeps == [], sleeps)
check("_generate: ...and counts one failure", llm.get_usage()["failures"] == 1, llm.get_usage())
check("credits_exhausted() is set", llm.credits_exhausted())
_, err2, _ = quiet(llm._generate, model="gemini-2.5-flash", contents="y")
check("_generate: later calls raise too", isinstance(err2, llm.CreditsExhausted))
check("_generate: ...and send no request", m.calls == 1, m.calls)
check("_generate: ...and aren't counted as calls", llm.get_usage()["calls"] == 1, llm.get_usage())

m = fresh([DEPLETED])
_, err, _ = quiet(llm.flash_json, contents="x", system_instruction="s", response_schema={"type": "object"})
check("flash_json passes the refusal up (does not turn it into None)", isinstance(err, llm.CreditsExhausted), repr(err))

m = fresh([RATE, "ok"])
out, err, _ = quiet(llm._generate, model="gemini-2.5-flash", contents="x")
check("_generate: an ordinary 429 is still retried and then succeeds", err is None and out == '{"a": 1}' and m.calls == 2, (out, err, m.calls))
check("_generate: ...with a back-off sleep", len(sleeps) == 1)
check("_generate: ...and the credit flag stays clear", not llm.credits_exhausted())

m = fresh([GenaiError(400, "INVALID_ARGUMENT")])
out, err, _ = quiet(llm._generate, model="gemini-2.5-flash", contents="x")
check("_generate: a 400 still returns None (unchanged)", out is None and err is None and not llm.credits_exhausted(), (out, err))

llm.reset_credit_state()
check("reset_credit_state clears the flag", not llm.credits_exhausted())

# ---------------------------------------------------------------- cluster.get_embedding
posts = []
def fake_post_factory(statuses):
    statuses = list(statuses)
    def fake_post(url, params=None, json=None, timeout=None):
        posts.append(url)
        st = statuses.pop(0) if statuses else 200
        r = requests.Response(); r.status_code = st
        r.url = f"{url}?key={params.get('key')}"; r.reason = "Payment Required" if st == 402 else "OK"
        r._content = b'{"embedding": {"values": [0.1, 0.2]}}'
        return r
    return fake_post

llm.reset_credit_state(); posts.clear(); sleeps.clear()
cluster.requests.post = fake_post_factory([402])
_, err, _ = quiet(cluster.get_embedding, "text")
check("get_embedding: a 402 raises CreditsExhausted", isinstance(err, llm.CreditsExhausted), repr(err))
check("get_embedding: ...after one request, no back-off", len(posts) == 1 and sleeps == [], (posts, sleeps))
check("get_embedding: ...and the exception doesn't carry the API key", "SECRETKEY123" not in str(err))
check("get_embedding: the refusal sets the shared flag", llm.credits_exhausted())
_, err, _ = quiet(cluster.get_embedding, "more")
check("get_embedding: once refused, no further request is sent", isinstance(err, llm.CreditsExhausted) and len(posts) == 1, len(posts))

llm.reset_credit_state(); posts.clear(); sleeps.clear()
cluster.requests.post = fake_post_factory([503, 200])
out, err, _ = quiet(cluster.get_embedding, "text")
check("get_embedding: a 503 is still retried, then returns the vector", err is None and out == [0.1, 0.2] and len(posts) == 2, (out, err, len(posts)))

# ---------------------------------------------------------------- db.get_videos_missing_stories
NOW = datetime.now(timezone.utc)

class RecQuery:
    def __init__(self, client, table): self.client, self.table, self.ops = client, table, []
    @property
    def not_(self):   # a property in postgrest-py, as in .not_.is_(...)
        self.ops.append(("not_", (), {})); return self
    def __getattr__(self, name):
        def op(*a, **kw):
            self.ops.append((name, a, kw)); return self
        return op
    def execute(self):
        self.client.log.append((self.table, self.ops))
        class R: pass
        r = R(); r.data = self.client.answer(self.table, self.ops); return r
class RecClient:
    def __init__(self, videos, storied):
        self.videos, self.storied, self.log = videos, set(storied), []
    def table(self, name): return RecQuery(self, name)
    def answer(self, table, ops):
        d = {n: a for n, a, kw in ops}
        if table == "videos" and d.get("select") == ("id",):
            cutoff = d["gte"][1]
            rows = [v for v in self.videos if v["fetched_at"] >= cutoff]
            if "not_" in d and d.get("is_") == ("transcript_text", "null"):
                rows = [v for v in rows if v["transcript_text"] is not None]
            rows.sort(key=lambda v: v["fetched_at"], reverse=True)
            return [{"id": v["id"]} for v in rows[: d["limit"][0]]]
        if table == "stories":
            return [{"video_id": i} for i in d["in_"][1] if i in self.storied]
        if table == "videos":
            ids = set(d["in_"][1])
            return [dict(v) for v in self.videos if v["id"] in ids]   # unordered on purpose
        raise AssertionError(f"unexpected query {table} {ops}")

# 200 fetched videos in the last ~5 days, all summarised except the 5 OLDEST (the case the old limit*3 query missed),
# plus one orphan 10 days old (outside the default window) and one orphan whose transcript was archived.
videos = [{"id": f"v{n:03d}", "title": f"t{n}", "url": "u", "published_at": "p", "source_id": "s",
           "transcript_text": "words " * 50, "fetched_at": (NOW - timedelta(minutes=35 * n)).isoformat()} for n in range(200)]
old_orphans = {f"v{n:03d}" for n in range(195, 200)}
videos.append({"id": "v_old", "title": "old", "url": "u", "published_at": "p", "source_id": "s",
               "transcript_text": "words", "fetched_at": (NOW - timedelta(days=10)).isoformat()})
videos.append({"id": "v_arch", "title": "archived", "url": "u", "published_at": "p", "source_id": "s",
               "transcript_text": None, "fetched_at": (NOW - timedelta(hours=1, minutes=1)).isoformat()})
storied = {v["id"] for v in videos if v["id"] not in old_orphans | {"v_old", "v_arch"}}
rc = RecClient(videos, storied)
db.get_db = lambda: rc
got = db.get_videos_missing_stories()
ids = [v["id"] for v in got]
check("recovery query: finds orphans older than the newest 90 fetched (the old blind spot)", set(ids) == old_orphans, ids)
check("recovery query: newest first", ids == sorted(old_orphans, reverse=False) and ids == ["v195", "v196", "v197", "v198", "v199"], ids)
check("recovery query: skips a row whose transcript was archived", "v_arch" not in ids)
check("recovery query: default window is 7 days (10-day-old orphan left out)", "v_old" not in ids)
first = rc.log[0]
check("recovery query: the window scan selects ids only (no transcripts)", first[0] == "videos" and dict((n, a) for n, a, kw in first[1])["select"] == ("id",))
cutoff = datetime.fromisoformat(dict((n, a) for n, a, kw in first[1])["gte"][1])
check("recovery query: cutoff is 168 h back", abs((NOW - cutoff) - timedelta(hours=168)) < timedelta(minutes=1), NOW - cutoff)
story_calls = [ops for t, ops in rc.log if t == "stories"]
check("recovery query: stories checked in chunks of <=100 ids (200 in the window → 2)", len(story_calls) == 2 and all(len(dict((n, a) for n, a, kw in ops)["in_"][1]) <= 100 for ops in story_calls), len(story_calls))
check("recovery query: only reads", not any(n in ("insert", "update", "delete", "upsert", "rpc") for t, ops in rc.log for n, a, kw in ops))
rc.log.clear()
got = db.get_videos_missing_stories(limit=2, lookback_hours=24 * 12)
check("recovery query: limit and a wider window are honoured", [v["id"] for v in got] == ["v195", "v196"], [v["id"] for v in got])
rc.log.clear()
rc.storied = {v["id"] for v in videos}
check("recovery query: nothing stranded → [] and no transcript load", db.get_videos_missing_stories() == [] and len([1 for t, ops in rc.log if t == "videos"]) == 1)

# ---------------------------------------------------------------- run_pipeline._env_int and the recovery settings
for val, want in (("", 30), ("72", 72), ("500", 200), ("0", 1), ("abc", 30), ("70.0", 70)):
    os.environ["PIPELINE_RECOVER_LIMIT"] = val
    check(f"_env_int({val!r})", rp._env_int("PIPELINE_RECOVER_LIMIT", 30, 1, 200) == want, rp._env_int("PIPELINE_RECOVER_LIMIT", 30, 1, 200))
os.environ.pop("PIPELINE_RECOVER_LIMIT")

seen = []
def fake_missing(limit=30, lookback_hours=168):
    seen.append((limit, lookback_hours)); return []
real_missing = db.get_videos_missing_stories
db.get_videos_missing_stories = fake_missing
quiet(rp.recover_missing_stories, {"stories_created": 0}, {})
check("recover_missing_stories: defaults 30 videos / 168 h", seen[-1] == (30, 168), seen)
os.environ["PIPELINE_RECOVER_HOURS"] = "200"; os.environ["PIPELINE_RECOVER_LIMIT"] = "70"
quiet(rp.recover_missing_stories, {"stories_created": 0}, {})
check("recover_missing_stories: dispatch overrides reach the query", seen[-1] == (70, 200), seen)
os.environ.pop("PIPELINE_RECOVER_HOURS"); os.environ.pop("PIPELINE_RECOVER_LIMIT")

# The recovery loop passes the refusal up; stories made before it still count.
orphans = [{"id": f"o{n}", "title": f"orphan {n}", "transcript_text": "x", "source_id": "s"} for n in range(4)]
db.get_videos_missing_stories = lambda limit=30, lookback_hours=168: list(orphans)
db.get_topic_keywords = lambda: []
inserted, summ_calls = [], []
db.insert_story = lambda rec: inserted.append(rec) or f"story-{len(inserted)}"
rp.cluster.embed_and_cluster_story = lambda **kw: None
def summarise_then_refuse(**kw):
    summ_calls.append(kw["title"])
    if len(summ_calls) == 2: raise llm.credit_refused(DEPLETED)
    return {"headline": "H", "summary": "S", "bullets": [], "short": None}
rp.summarise.summarise_video = summarise_then_refuse
llm.reset_credit_state()
stats = {"stories_created": 0}
_, err, _ = quiet(rp.recover_missing_stories, stats, {})
check("recover_missing_stories: the refusal is raised, not swallowed per video", isinstance(err, llm.CreditsExhausted), repr(err))
check("recover_missing_stories: ...and it stops at the refused video", summ_calls == ["orphan 0", "orphan 1"], summ_calls)
check("recover_missing_stories: the story saved before it is counted", stats["stories_created"] == 1 and len(inserted) == 1, stats)
db.get_videos_missing_stories = real_missing

# ---------------------------------------------------------------- run_once end to end (fakes)
class AnyQuery:
    def __getattr__(self, name): return lambda *a, **kw: self
    def execute(self):
        class R: data = []
        return R()
class AnyClient:
    def table(self, name): return AnyQuery()
    def rpc(self, *a, **kw): return AnyQuery()

state = {}
def reset_run(script):
    """script: what happens in each step. Returns nothing; fills `state`."""
    state.clear(); state.update(finished=None, pings=[], daily=[], summarised=0)
    llm.reset_credit_state(); llm.reset_usage()
    db.get_db = lambda: AnyClient()
    db.start_pipeline_run = lambda trigger_source="schedule": "run-1"
    db.finish_pipeline_run = lambda run_id, status, stats: state.__setitem__("finished", (status, dict(stats)))
    db.get_active_sources = lambda: [{"id": "s", "category": "india_global"}]
    rp.fetch_sources.fetch_all_sources = lambda: (script.get("items", []), {"sources_checked": 1, "videos_found": len(script.get("items", []))})
    rp.process_transcripts_and_summarise = script.get("process", lambda items, stats, source_map, **kw: stats)
    rp._failed_videos_to_retry = lambda: []
    rp.recover_missing_stories = script.get("recover", lambda stats, source_map: stats)
    rp.storylines.refresh_recaps_live = script.get("recaps", lambda: None)
    rp.get_transcripts.get_fetcher_mix = lambda: {}
    rp.archive_transcripts.archive_old_transcripts = lambda: state["daily"].append("archive")
    rp.update_weights.run = lambda: state["daily"].append("weights")
    db.expire_stale_failures = lambda: state["daily"].append("expire") or 0
    rp._ping_healthcheck = lambda success=True: state["pings"].append(success)

def make_story(items, stats, source_map, **kw):
    stats["stories_created"] += 1; return stats

def refuse_in_process(items, stats, source_map, **kw):
    stats["stories_created"] += 1          # one story saved, then the credit runs out
    raise llm.credit_refused(DEPLETED)

recover_calls = []
reset_run({"items": [{"title": "a"}], "process": refuse_in_process,
           "recover": lambda stats, sm: recover_calls.append(1) or stats})
out, err, log = quiet(rp.run_once)
check("run_once: a refusal mid-run returns False", out is False and err is None, (out, err))
check("run_once: ...records the run as failed", state["finished"] and state["finished"][0] == "failed", state["finished"])
check("run_once: ...with the marker note in error_log", state["finished"] and state["finished"][1].get("error_log") == [llm.CREDIT_DEPLETED_NOTE], state["finished"])
check("run_once: ...keeping the count of stories saved before it", state["finished"] and state["finished"][1]["stories_created"] == 1)
check("run_once: ...pings the healthcheck down, never up", state["pings"] == [False], state["pings"])
check("run_once: ...skips the later steps (no recovery pass)", recover_calls == [], recover_calls)
check("run_once: ...skips the daily jobs (transcripts stay for recovery)", state["daily"] == [], state["daily"])
check("run_once: ...says so in the log", "prepaid credit is used up" in log and "Top up in Google AI Studio" in log)

def recaps_swallow():
    try: raise llm.credit_refused(DEPLETED)
    except Exception: pass                 # what refresh_recaps_live / assign_after_embed do (fail-soft)
reset_run({"items": [{"title": "a"}], "process": make_story, "recaps": recaps_swallow})
out, err, _ = quiet(rp.run_once)
check("run_once: a refusal a fail-soft step swallowed still fails the run", out is False and state["finished"][0] == "failed", (out, state["finished"]))
check("run_once: ...with the marker note", state["finished"][1].get("error_log") == [llm.CREDIT_DEPLETED_NOTE])

reset_run({"items": [{"title": "a"}], "process": make_story})
out, err, _ = quiet(rp.run_once)
check("run_once: a normal run returns None (exit 0)", out is None and err is None, (out, err))
check("run_once: ...and finishes 'success' with no error_log", state["finished"][0] == "success" and "error_log" not in state["finished"][1], state["finished"])
check("run_once: ...and pings the healthcheck up", state["pings"] == [True], state["pings"])

reset_run({"items": []})
out, err, _ = quiet(rp.run_once)
check("run_once: a run with nothing new is still 'partial', exit 0 (unchanged)", out is None and state["finished"][0] == "partial", (out, state["finished"]))

def crash(items, stats, source_map, **kw): raise RuntimeError("supabase is down")
reset_run({"items": [{"title": "a"}], "process": crash})
out, err, _ = quiet(rp.run_once)
check("run_once: any other crash keeps the old behaviour (failed, its message, no exit 1)",
      out is None and state["finished"][0] == "failed" and state["finished"][1]["error_log"] == ["supabase is down"], (out, state["finished"]))

reset_run({"items": [{"title": "a"}], "process": refuse_in_process})
out, err, _ = quiet(rp.run_once)
reset_run({"items": [{"title": "a"}], "process": make_story})
out, err, _ = quiet(rp.run_once)
check("run_once: the next run starts with the flag cleared (a top-up between runs is seen)", out is None and state["finished"][0] == "success", (out, state["finished"]))

# ---------------------------------------------------------------- main() exit code
rp._code_version_banner = lambda: None
sys_argv = sys.argv
sys.argv = ["run_pipeline.py", "--once"]
rp.run_once = lambda: False
_, err, _ = quiet(rp.main)
check("main: exits 1 when the credit is used up", isinstance(err, SystemExit) and err.code == 1, repr(err))
rp.run_once = lambda: None
_, err, _ = quiet(rp.main)
check("main: exits normally otherwise", err is None, repr(err))
sys.argv = sys_argv

# ---------------------------------------------------------------- the workflow wires the inputs; the scheduler doesn't send them
root = os.path.dirname(os.getcwd())
wf = open(os.path.join(root, ".github", "workflows", "news-pipeline.yml")).read()
check("workflow: recover_hours / recover_limit dispatch inputs exist", "recover_hours:" in wf and "recover_limit:" in wf)
check("workflow: they reach the run as PIPELINE_RECOVER_*",
      "PIPELINE_RECOVER_HOURS: ${{ inputs.recover_hours }}" in wf and "PIPELINE_RECOVER_LIMIT: ${{ inputs.recover_limit }}" in wf)
check("workflow: inputs default to blank", wf.count('default: ""') >= 2)
sched = open(os.path.join(root, "netlify", "functions", "pipeline-schedule.mts")).read()
check("Netlify scheduler sends no recovery overrides", "recover_" not in sched)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
