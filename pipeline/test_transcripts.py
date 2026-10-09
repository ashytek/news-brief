"""Offline checks for the transcript fetch chain in get_transcripts.py: what is skipped on GitHub Actions
(CI), what still runs on a home IP, the order of the local chain, the audio-fallback gates, the permanent
verdicts, and the Apify caption languages. No network, no Gemini, no database, no yt-dlp (everything that
would touch the outside world is replaced).

Run from this folder:   ./venv/bin/python test_transcripts.py
Exits non-zero if any check fails. Added in roadmap session 9 (9 Oct 2026) for F002/F010/F046."""
import importlib, io, os, sys
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

# config.py reads these at import; none is used here
for k in ("GOOGLE_API_KEY", "YOUTUBE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ.setdefault(k, "test")
for k in ("CI", "GITHUB_ACTIONS", "TRANSCRIPT_LOCAL_FALLBACK_IN_CI", "APIFY_CAPTION_LANGUAGES", "YOUTUBE_BROWSER", "YOUTUBE_COOKIES_FILE"):
    os.environ.pop(k, None)

sys.path.insert(0, os.getcwd())
import get_transcripts as gt

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")

REAL_APIFY = gt._get_transcript_apify      # reset() swaps the module's fetchers for fakes; keep the real one
RESULT = ("hello world", [{"text": "hello world", "start": 0, "duration": 300}])   # > the 120 s short-video floor
calls = []

def reset(*, ci=False, apify="tok", apify_result=None, apify_raises=False, ytdlp="none", ytt="none", assembly="key", browser="", cookie=None):
    """Put the module in a known state. ytdlp / ytt: 'ok' | 'none' | 'perm'."""
    calls.clear()
    for k in ("CI", "GITHUB_ACTIONS", "TRANSCRIPT_LOCAL_FALLBACK_IN_CI"):
        os.environ.pop(k, None)
    if ci: os.environ["GITHUB_ACTIONS"] = "true"
    gt.APIFY_TOKEN = apify
    gt.ASSEMBLYAI_API_KEY = assembly
    gt.YOUTUBE_BROWSER = browser
    gt._resolve_cookie_path = lambda: cookie
    gt.reset_run_state()

    def apify_fn(vid):
        calls.append("apify")
        if apify_raises: raise gt.PermanentNoTranscript("Apify: NO_CAPTIONS_AVAILABLE")
        return apify_result
    def mk(name, mode):
        def fn(vid):
            calls.append(name)
            if mode == "ok": return RESULT
            if mode == "perm": raise gt.PermanentNoTranscript(name + " says none")
            return None
        return fn
    gt._get_transcript_apify = apify_fn
    gt._get_transcript_ytdlp = mk("ytdlp", ytdlp)
    gt._get_transcript_ytt = mk("ytt", ytt)
    gt._transcribe_via_assemblyai = lambda url: (calls.append("audio") or ("audio text", [{"text": "x", "start": 0, "duration": 200}]))

def run(fn, *a, **kw):
    buf = io.StringIO()
    with redirect_stdout(buf):
        try: out = fn(*a, **kw)
        except gt.PermanentNoTranscript as e: out = e
    return out, buf.getvalue()

# ---------------------------------------------------------------- _on_ci / _local_chain_enabled
reset()
check("not CI by default", not gt._on_ci())
os.environ["CI"] = "true"; check("CI=true is CI", gt._on_ci())
os.environ.pop("CI"); os.environ["GITHUB_ACTIONS"] = "true"; check("GITHUB_ACTIONS=true is CI", gt._on_ci())
os.environ["GITHUB_ACTIONS"] = "false"; check("GITHUB_ACTIONS=false is not CI", not gt._on_ci())

reset(ci=True);                         check("CI + Apify + no cookies: local chain OFF", not gt._local_chain_enabled())
reset(ci=True, browser="chrome");       check("CI + a browser profile: local chain on", gt._local_chain_enabled())
reset(ci=True, cookie="/tmp/c.txt");    check("CI + a cookie file: local chain on", gt._local_chain_enabled())
reset(ci=True); os.environ["TRANSCRIPT_LOCAL_FALLBACK_IN_CI"] = "1"
check("CI + override env: local chain on", gt._local_chain_enabled())
reset(ci=True, apify="");               check("CI without Apify: local chain is all there is, on", gt._local_chain_enabled())
reset(ci=False);                        check("home IP + Apify: local chain on", gt._local_chain_enabled())

# ---------------------------------------------------------------- on CI: Apify is the whole story
reset(ci=True, apify_result=RESULT)
out, _ = run(gt.get_youtube_transcript, "vid1")
check("CI: Apify success is returned", out == RESULT and calls == ["apify"], calls)

reset(ci=True, apify_result=None, ytdlp="ok", ytt="ok")
out, log = run(gt.get_youtube_transcript, "vid1")
check("CI: Apify None -> None, no yt-dlp, no youtube-transcript-api", out is None and calls == ["apify"], calls)
check("CI: says why, once", log.count("Local fetchers") == 1, log)
out, log = run(gt.get_youtube_transcript, "vid2"); out, log3 = run(gt.get_youtube_transcript, "vid3")
check("CI: the note is printed once per run, not per video", "Local fetchers" not in log and "Local fetchers" not in log3, (log, log3))
gt.reset_run_state(); out, log = run(gt.get_youtube_transcript, "vid4")
check("CI: a new run prints it again", log.count("Local fetchers") == 1)

reset(ci=True, apify_raises=True, ytdlp="ok", ytt="ok")
out, _ = run(gt.get_youtube_transcript, "vid1")
check("CI: Apify's permanent verdict still propagates", isinstance(out, gt.PermanentNoTranscript) and calls == ["apify"], calls)

reset(ci=True, apify_result=None, ytdlp="ok"); os.environ["TRANSCRIPT_LOCAL_FALLBACK_IN_CI"] = "1"
out, _ = run(gt.get_youtube_transcript, "vid1")
check("CI + override: the local chain runs (yt-dlp first)", out == RESULT and calls == ["apify", "ytdlp"], calls)

# ---------------------------------------------------------------- a home IP: the documented chain, in order
reset(ci=False, apify_result=None, ytdlp="none", ytt="ok")
out, _ = run(gt.get_youtube_transcript, "v")
check("home IP: Apify None -> yt-dlp -> ytt", out == RESULT and calls == ["apify", "ytdlp", "ytt"], calls)

reset(ci=False, apify="", ytdlp="ok")
out, _ = run(gt.get_youtube_transcript, "v")
check("no Apify, no cookies: yt-dlp (cookie-free android) is tried FIRST (was dead code, F010)", out == RESULT and calls == ["ytdlp"], calls)

reset(ci=False, apify="", ytdlp="none", ytt="ok")
out, _ = run(gt.get_youtube_transcript, "v")
check("no Apify: yt-dlp None -> ytt", out == RESULT and calls == ["ytdlp", "ytt"], calls)

reset(ci=False, apify="", ytdlp="perm", ytt="ok")
out, _ = run(gt.get_youtube_transcript, "v")
check("yt-dlp permanent but ytt finds a track: ytt wins", out == RESULT and calls == ["ytdlp", "ytt"], calls)

reset(ci=False, apify="", ytdlp="perm", ytt="perm")
out, _ = run(gt.get_youtube_transcript, "v")
check("both permanent: raises", isinstance(out, gt.PermanentNoTranscript), out)

reset(ci=False, apify="", ytdlp="perm", ytt="none")
out, _ = run(gt.get_youtube_transcript, "v")
check("yt-dlp permanent, ytt rate-limited: trust yt-dlp's verdict", isinstance(out, gt.PermanentNoTranscript), out)

# ---------------------------------------------------------------- the audio fallback gates
fresh = {"published_at": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()}
old = {"published_at": (datetime.now(timezone.utc) - timedelta(hours=90)).isoformat()}
reset(ci=True);  check("CI: no audio attempt on a fresh blocked video", gt._should_try_audio_on_block(fresh) is False)
reset(ci=False); check("home IP: audio attempt for a fresh blocked video", gt._should_try_audio_on_block(fresh) is True)
reset(ci=False); check("home IP: not for an old one", gt._should_try_audio_on_block(old) is False)
reset(ci=False, assembly=""); check("no AssemblyAI key: never", gt._should_try_audio_on_block(fresh) is False)

reset(ci=True)
out, log = run(gt._try_audio_fallback, "https://youtu.be/x", "no captions")
check("CI: _try_audio_fallback does nothing (no download, cap untouched)", out is None and calls == [] and gt._audio_fallback_count == 0, (calls, gt._audio_fallback_count))
reset(ci=False)
out, _ = run(gt._try_audio_fallback, "https://youtu.be/x", "no captions")
check("home IP: audio fallback runs and counts toward the cap", out is not None and out[1] == "fetched" and gt._audio_fallback_count == 1, (out, gt._audio_fallback_count))
gt._audio_fallback_count = gt.MAX_AUDIO_FALLBACK_PER_RUN
out, log = run(gt._try_audio_fallback, "https://youtu.be/x", "no captions")
check("home IP: the per-run cap still holds", out is None and "cap reached" in log, log)

# ---------------------------------------------------------------- fetch_transcript end to end (CI)
dbcalls = []
class FakeDb:
    @staticmethod
    def mark_video_permanent_failure(vid): dbcalls.append(vid)
gt.db = FakeDb
video = {"url": "https://www.youtube.com/watch?v=abcdefghijk", "title": "t", "video_id": "uuid-1",
         "transcript_status": "pending", "published_at": fresh["published_at"], "duration_seconds": 600}

reset(ci=True, apify_result=None, ytdlp="ok", ytt="ok"); dbcalls.clear()
out, log = run(gt.fetch_transcript, video)
check("CI end to end: Apify None -> failed (retry next run), no audio, not marked permanent",
      out == (None, "failed", []) and "audio" not in calls and "ytdlp" not in calls and dbcalls == [], (out, calls, dbcalls))

reset(ci=True, apify_raises=True); dbcalls.clear()
out, log = run(gt.fetch_transcript, video)
check("CI end to end: Apify says no captions -> no_transcript and marked permanent, no audio attempt",
      out == (None, "no_transcript", []) and "audio" not in calls and dbcalls == ["uuid-1"], (out, calls, dbcalls))

reset(ci=True, apify_result=RESULT); dbcalls.clear()
out, _ = run(gt.fetch_transcript, video)
check("CI end to end: Apify success is fetched", out[1] == "fetched" and out[0] == "hello world", out)

# ---------------------------------------------------------------- Apify caption languages (F046)
captured = {}
class FakeResp:
    status_code = 200
    text = ""
    def json(self): return [{"transcript_text": "hi there", "transcript_json": [{"text": "hi there", "start": 0, "end": 2}]}]
def fake_post(url, json=None, headers=None, timeout=None):
    captured["payload"] = json
    return FakeResp()

real_post = gt.requests.post
gt.requests.post = fake_post
gt._get_transcript_apify = REAL_APIFY
gt.APIFY_TOKEN = "tok"
try:
    run(gt._get_transcript_apify, "abcdefghijk")
    check("Apify payload carries the default languages (en, hi)", captured["payload"]["languages"] == ["en", "hi"], captured)
    gt.APIFY_CAPTION_LANGUAGES = ["en", "ta"]
    run(gt._get_transcript_apify, "abcdefghijk")
    check("and whatever is configured", captured["payload"]["languages"] == ["en", "ta"], captured)
finally:
    gt.requests.post = real_post

import config as cfg
os.environ["APIFY_CAPTION_LANGUAGES"] = "en, hi ,ta"; importlib.reload(cfg)
check("APIFY_CAPTION_LANGUAGES parses (spaces trimmed)", cfg.APIFY_CAPTION_LANGUAGES == ["en", "hi", "ta"], cfg.APIFY_CAPTION_LANGUAGES)
os.environ["APIFY_CAPTION_LANGUAGES"] = " , "; importlib.reload(cfg)
check("APIFY_CAPTION_LANGUAGES with nothing in it falls back to en, hi", cfg.APIFY_CAPTION_LANGUAGES == ["en", "hi"], cfg.APIFY_CAPTION_LANGUAGES)
os.environ.pop("APIFY_CAPTION_LANGUAGES"); importlib.reload(cfg)
check("unset: en, hi", cfg.APIFY_CAPTION_LANGUAGES == ["en", "hi"], cfg.APIFY_CAPTION_LANGUAGES)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
