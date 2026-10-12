"""Offline checks for the backup-cron guard in run_pipeline.run_once (roadmap session 11).

GitHub's own cron is now only a BACKUP for the Netlify Scheduled Function. The workflow sets
PIPELINE_SKIP_IF_RECENT_HOURS=3 for the `schedule` event ONLY; run_once then exits cleanly (no pipeline_runs
row, no paid call) if a run started in the last 3 hours. Manual and Netlify-dispatched runs never set it.
Also checks that the trigger source still reaches pipeline_runs and that the older "a manual run covered
this window" skip still works.

No network, no Supabase, no Apify, no Gemini: the database is a fake and a socket tripwire guards the rest.

Run from this folder:   ./venv/bin/python test_scheduling.py
Exits non-zero if any check fails."""
import io, os, socket, sys
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

# Hermetic (see test_fresh_captions.py): pin everything .env could fill, then block the network.
for k, v in {"GOOGLE_API_KEY": "test", "YOUTUBE_API_KEY": "test", "SUPABASE_URL": "http://localhost.invalid",
             "SUPABASE_SERVICE_ROLE_KEY": "test", "APIFY_TOKEN": "test", "ASSEMBLYAI_API_KEY": "",
             "YOUTUBE_BROWSER": "", "YOUTUBE_COOKIES_FILE": "", "HEALTHCHECK_URL": ""}.items():
    os.environ[k] = v
for k in ("PIPELINE_SKIP_IF_RECENT_HOURS", "PIPELINE_TRIGGER_SOURCE"):
    os.environ.pop(k, None)

def _no_network(*a, **kw):
    raise RuntimeError("network access attempted in an offline test")
socket.socket.connect = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

sys.path.insert(0, os.getcwd())
import db
import run_pipeline as rp

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")

NOW = datetime.now(timezone.utc)
def ago(**kw): return (NOW - timedelta(**kw)).isoformat()

# ---------------------------------------------------------------- fakes
class Reached(Exception):
    """Raised by the fake start_pipeline_run: the guard let the run through."""

state = {"runs": [], "manual_rows": [], "queries": 0, "started_with": None, "pings": [], "recent_raises": False, "manual_raises": False}

def fake_recent_runs(since_iso, limit=10):
    state["queries"] += 1
    if state["recent_raises"]: raise RuntimeError("supabase is down")
    rows = [r for r in state["runs"] if r["started_at"] >= since_iso]   # the real query filters on started_at >= since
    return sorted(rows, key=lambda r: r["started_at"], reverse=True)[:limit]

class FakeQuery:
    """db.get_db().table('pipeline_runs')...execute().data for the manual-trigger skip."""
    def __getattr__(self, name): return lambda *a, **kw: self
    def execute(self):
        if state["manual_raises"]: raise RuntimeError("supabase is down")
        class R: data = state["manual_rows"]
        return R()
class FakeClient:
    def table(self, name): return FakeQuery()

def fake_start(trigger_source="schedule"):
    state["started_with"] = trigger_source
    raise Reached()

db.get_recent_runs = fake_recent_runs
db.get_db = lambda: FakeClient()
db.start_pipeline_run = fake_start
rp._ping_healthcheck = lambda success=True: state["pings"].append(success)

def reset(runs=(), manual=(), skip_hours=None, source=None, recent_raises=False, manual_raises=False):
    state.update(runs=list(runs), manual_rows=list(manual), queries=0, started_with=None, pings=[],
                 recent_raises=recent_raises, manual_raises=manual_raises)
    for k in ("PIPELINE_SKIP_IF_RECENT_HOURS", "PIPELINE_TRIGGER_SOURCE"):
        os.environ.pop(k, None)
    if skip_hours is not None: os.environ["PIPELINE_SKIP_IF_RECENT_HOURS"] = skip_hours
    if source is not None: os.environ["PIPELINE_TRIGGER_SOURCE"] = source

def run_once():
    """Returns (reached_start, log). reached_start False means run_once returned early (skipped)."""
    buf = io.StringIO()
    reached = False
    with redirect_stdout(buf):
        try: rp.run_once()
        except Reached: reached = True
    return reached, buf.getvalue()

def run(status, **ago_kw): return {"started_at": ago(**ago_kw), "status": status}

# ---------------------------------------------------------------- the guard: the three cases the brief names
reset(runs=[run("success", hours=1)], skip_hours="3", source="schedule")
reached, log = run_once()
check("run 1 h ago: the backup run SKIPS (returns before start_pipeline_run)", not reached and state["started_with"] is None, log)
check("... with a clear log line", "Skipping backup scheduled run" in log and "success" in log, log)
check("... no pipeline_runs row is written (start_pipeline_run never called)", state["started_with"] is None)
check("... and the healthcheck gets a SUCCESS ping (a skip is healthy)", state["pings"] == [True], state["pings"])

reset(runs=[run("success", hours=4)], skip_hours="3", source="schedule")
reached, log = run_once()
check("run 4 h ago: the backup run goes ahead", reached and state["started_with"] == "schedule", (reached, log))

reset(skip_hours="3", source="schedule", recent_raises=True)
reached, log = run_once()
check("query failure: runs anyway (fails open)", reached and "Recent-run guard error" in log, log)

reset(runs=[], skip_hours="3", source="schedule")
reached, log = run_once()
check("no runs at all: goes ahead", reached)

# ---------------------------------------------------------------- manual and Netlify-dispatched runs are never guarded
reset(runs=[run("success", minutes=10)], source="manual")
reached, log = run_once()
check("manual run 10 min after another: NOT skipped, guard not even queried", reached and state["queries"] == 0 and state["started_with"] == "manual", (reached, state))

reset(runs=[run("success", minutes=10)], skip_hours="", source="schedule")   # what the workflow gives a Netlify-dispatched run
reached, log = run_once()
check("Netlify-dispatched run (source=schedule, guard variable empty): NOT guarded", reached and state["queries"] == 0 and state["started_with"] == "schedule", (reached, state))

for bad in ("abc", "0", "-2"):
    reset(runs=[run("success", minutes=10)], skip_hours=bad, source="schedule")
    reached, _ = run_once()
    check(f"PIPELINE_SKIP_IF_RECENT_HOURS={bad!r}: guard off, run goes ahead", reached and state["queries"] == 0)

# ---------------------------------------------------------------- which rows count
reset(runs=[run("failed", hours=1)], skip_hours="3", source="schedule")
reached, _ = run_once()
check("a FAILED run 1 h ago does not suppress the backup (a crash is when it should run)", reached)

reset(runs=[run("partial", hours=2)], skip_hours="3", source="schedule")
reached, _ = run_once()
check("a partial run 2 h ago counts", not reached)

reset(runs=[run("running", minutes=20)], skip_hours="3", source="schedule")
reached, _ = run_once()
check("a run still in progress (started 20 min ago) counts", not reached)

reset(runs=[run("running", hours=2)], skip_hours="3", source="schedule")
reached, _ = run_once()
check("a 'running' row 2 h old is a dead run (the workflow times out at 45 min): does not count", reached)

reset(runs=[run("failed", minutes=30), run("success", hours=2, minutes=30)], skip_hours="3", source="schedule")
reached, _ = run_once()
check("failed 30 min ago but a success 2.5 h ago: the success counts", not reached)

reset(runs=[run("success", hours=2, minutes=59)], skip_hours="3", source="schedule")
check("2 h 59 min ago: inside the window", not run_once()[0])
reset(runs=[run("success", hours=3, minutes=1)], skip_hours="3", source="schedule")
check("3 h 01 min ago: outside the window", run_once()[0])

# ---------------------------------------------------------------- the older manual-run skip still works, and the source reaches pipeline_runs
reset(manual=[{"started_at": ago(hours=2)}], source="schedule")
reached, log = run_once()
check("scheduled run 2 h after a successful manual one: still skipped (Ash's 5 h rule)", not reached and "manual trigger covered this window" in log, log)
reset(manual=[{"started_at": ago(hours=2)}], source="manual")
reached, _ = run_once()
check("a manual run is never skipped by that rule", reached and state["started_with"] == "manual")
reset(source="schedule", manual_raises=True)
reached, log = run_once()
check("manual-skip check failing: runs anyway", reached and "Skip-check error" in log)
reset()
reached, _ = run_once()
check("PIPELINE_TRIGGER_SOURCE unset defaults to schedule (pre-session-11 behaviour)", reached and state["started_with"] == "schedule")

# both rules together: the backup run passes the 3 h guard (no run in 3 h) but a manual run 4 h ago still covers it
reset(runs=[], manual=[{"started_at": ago(hours=4)}], skip_hours="3", source="schedule")
reached, log = run_once()
check("backup run: guard passes (nothing in 3 h) then the manual-run rule still skips it", not reached and "manual trigger covered" in log)

# ---------------------------------------------------------------- helper functions on their own
check("_skip_if_recent_hours: '3' -> 3.0", (os.environ.update(PIPELINE_SKIP_IF_RECENT_HOURS="3"), rp._skip_if_recent_hours())[1] == 3.0)
check("_skip_if_recent_hours: ' 1.5 ' -> 1.5", (os.environ.update(PIPELINE_SKIP_IF_RECENT_HOURS=" 1.5 "), rp._skip_if_recent_hours())[1] == 1.5)
os.environ.pop("PIPELINE_SKIP_IF_RECENT_HOURS")
check("_run_covers_window: a row with an unparseable started_at and status running is not counted",
      rp._run_covers_window({"status": "running", "started_at": "garbage"}, NOW) is False)

# ---------------------------------------------------------------- the real query helper asks for the right thing
class RecQuery:
    def __init__(self): self.calls = []
    def __getattr__(self, name):
        def f(*a, **kw): self.calls.append((name, a, kw)); return self
        return f
    def execute(self):
        class R: data = [{"started_at": "x", "status": "success"}]
        return R()
class RecClient:
    def __init__(self): self.q = RecQuery()
    def table(self, name): self.q.calls.append(("table", (name,), {})); return self.q
real_get_recent = None
import importlib
importlib.reload(db)   # restores the real db.get_recent_runs (the fakes above replaced it)
rc = RecClient(); db.get_db = lambda: rc
out = db.get_recent_runs("2026-01-01T00:00:00+00:00")
names = [c[0] for c in rc.q.calls]
check("db.get_recent_runs: reads pipeline_runs, started_at >= since, newest first, limited",
      names == ["table", "select", "gte", "order", "limit"] and rc.q.calls[0][1] == ("pipeline_runs",) and rc.q.calls[2][1] == ("started_at", "2026-01-01T00:00:00+00:00")
      and rc.q.calls[3][2].get("desc") is True and out[0]["status"] == "success", rc.q.calls)
check("db.get_recent_runs: only reads (no insert/update/delete/upsert/rpc)", not ({"insert", "update", "delete", "upsert", "rpc"} & set(names)), names)

# ---------------------------------------------------------------- the workflow wires the variables the code reads
wf = open(os.path.join(os.path.dirname(os.getcwd()), ".github", "workflows", "news-pipeline.yml")).read()
check("workflow: PIPELINE_SKIP_IF_RECENT_HOURS is set for the schedule event only", "PIPELINE_SKIP_IF_RECENT_HOURS: ${{ github.event_name == 'schedule' && '3' || '' }}" in wf)
check("workflow: PIPELINE_TRIGGER_SOURCE reads the dispatch input", "(inputs.source || 'manual')" in wf)
check("workflow: GitHub cron is the :47 backup", '- cron: "47 3,9,15,21 * * *"' in wf)
check("workflow: the concurrency group is kept", "group: news-pipeline" in wf and "cancel-in-progress: false" in wf)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
