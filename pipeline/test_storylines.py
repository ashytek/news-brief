"""Offline checks for storylines.py: recap validation and re-ask, trimming, the round-up guard,
and the engine's join/create path. No network, no Gemini, no database (Gemini and the DB client are stubbed).

Run from this folder:   ./venv/bin/python test_storylines.py
Exits non-zero if any check fails. Added in roadmap session 2 (9 Oct 2026); extend it when touching
storylines.py. The `bugtext`/`bug2` fixtures reproduce the 34,000 clause-trim bug on purpose."""
import copy, json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())
import storylines as sl

PASS = FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")

def story(i, day, source="IGR", headline=None, lead=None, cat="india_global", vec=None, sid=None, hour=12):
    d = datetime(2026, 10, day, hour, tzinfo=timezone.utc)
    return {"id": f"s{i}", "category": cat, "headline": headline or f"Headline {i}",
            "summary": "Summary " * 20, "short": {"lead": lead or f"Lead {i}.", "key_points": ["a", "b", "c"]} if lead != "NONE" else None,
            "source": source, "created_at": d, "when": d, "storyline_id": sid, "vec": vec}

# ---------------------------------------------------------------- tidy_text via clean_title
check("clean_title glues newline-in-word", sl.clean_title("El Ni\n\nño floods") == "El Niño floods", sl.clean_title("El Ni\n\nño floods"))
check("clean_title strips quotes", sl.clean_title('"Flydubai attack"') == "Flydubai attack")
check("clean_title non-str", sl.clean_title(None) == "")

# ---------------------------------------------------------------- round-up detection
check("round-up: plain", sl.is_round_up(story(1, 1, lead="Round-up: three items.")))
check("round-up: lowercase/space", sl.is_round_up(story(1, 1, lead="  round-up: x")))
check("round-up: not round-up", not sl.is_round_up(story(1, 1, lead="Flydubai pilot attacked.")))
check("round-up: word inside lead", not sl.is_round_up(story(1, 1, lead="A round-up of the week")))
check("round-up: no short", not sl.is_round_up(story(1, 1, lead="NONE")))
check("round-up: short not dict", not sl.is_round_up({"short": "Round-up: x"}))

# ---------------------------------------------------------------- build_recap
def m(i, y, mo, d, src="IGR"):
    dt = datetime(y, mo, d, 12, tzinfo=timezone.utc)
    s = story(i, 1); s["when"] = s["created_at"] = dt; s["source"] = src; return s
members = [m(1, 2026, 9, 30), m(2, 2026, 9, 30, "VAN"), m(3, 2026, 10, 1), m(4, 2026, 10, 2), m(5, 2026, 10, 4)]
DAYS = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-04"]
good = {
    "title": "Flydubai pilot attack",
    "so_far": [{"date": "2026-09-30", "text": "A co-pilot attacked the captain."},
               {"date": "2026-10-01", "text": "Reports differ: 174 vs 180 on board."},
               {"date": "2026-10-02", "text": "Modi praised the pilot."}],
    "latest": {"date": "2026-10-04", "text": "Israel will honour the captain."},
    "conflicts": [{"what": "people on board", "figures": ["174", "180"]}],
}
c, p = sl.build_recap(good, members)
check("good: accepted", c is not None and p == [], p)
check("good: shape", c and c["recap"]["latest"] == {"date": "2026-10-04", "text": "Israel will honour the captain."} and len(c["recap"]["so_far"]) == 3)
check("good: title", c and c["title"] == "Flydubai pilot attack")

# newline inside a word in the texts
g = copy.deepcopy(good); g["latest"]["text"] = "El Ni\n\nño returns."; g["so_far"][0]["text"] = "Line one.\nLine two."
c, p = sl.build_recap(g, members)
check("tidy: newline in word", c and c["recap"]["latest"]["text"] == "El Niño returns.", c)
check("tidy: other whitespace", c and c["recap"]["so_far"][0]["text"] == "Line one. Line two.", c)

# dropped day (the 8 Oct failure: days went missing)
g = copy.deepcopy(good); g["so_far"] = g["so_far"][:1]
c, p = sl.build_recap(g, members)
check("dropped days: rejected", c is None and len(p) >= 1)
check("dropped days: names them", any("2026-10-01" in x and "2026-10-02" in x for x in p), p)
g["so_far"] = []
c, p = sl.build_recap(g, members)
check("all days dropped: rejected", c is None and any("2026-09-30" in x for x in p), p)

# latest dated 3 Oct (the 8 Oct relabel bug): must be rejected, NOT relabelled
g = copy.deepcopy(good); g["latest"]["date"] = "2026-10-03"
c, p = sl.build_recap(g, members)
check("wrong latest date: rejected, not relabelled", c is None and any("2026-10-04" in x and "2026-10-03" in x for x in p), (c, p))
g["latest"]["date"] = "4 Oct"
c, p = sl.build_recap(g, members)
check("latest date other format: rejected", c is None and len(p) == 1, p)
g["latest"]["date"] = ""
c, p = sl.build_recap(g, members)
check("latest date empty: rejected", c is None and "nothing" in p[0], p)

# latest empty / raw not a dict
g = copy.deepcopy(good); g["latest"]["text"] = "  "
c, p = sl.build_recap(g, members)
check("latest empty: rejected", c is None and "latest" in p[0], p)
check("None raw", sl.build_recap(None, members)[0] is None)
check("list raw", sl.build_recap([1], members)[0] is None)
check("no members", sl.build_recap(good, [])[0] is None)

# unknown / duplicate / not-earlier so_far dates are dropped, not fatal
g = copy.deepcopy(good)
g["so_far"] += [{"date": "2026-10-04", "text": "newest-day entry in so_far"}, {"date": "2026-08-01", "text": "unknown day"},
                {"date": "2026-10-01", "text": "duplicate day"}, "junk", {"date": "2026-10-02", "text": ""}]
c, p = sl.build_recap(g, members)
check("extras dropped, coverage ok", c is not None and [e["date"] for e in c["recap"]["so_far"]] == DAYS[:3], (c, p))
check("first duplicate wins", c and c["recap"]["so_far"][1]["text"].startswith("Reports differ"))

# order is sorted
g = copy.deepcopy(good); g["so_far"].reverse()
c, p = sl.build_recap(g, members)
check("so_far sorted oldest first", c and [e["date"] for e in c["recap"]["so_far"]] == DAYS[:3])

# caps
long_text = ("The captain was stabbed by the co-pilot during the flight and the aircraft diverted. "
             "Officials in Dubai and Tel Aviv gave different accounts of the altitude and the number on board. "
             "Netanyahu then claimed the pilot tried to crash it into the city.")      # ~46 words
check("fixture is over 35 words", len(long_text.split()) > 35, len(long_text.split()))
long_text = long_text + " Further reports said officials in Delhi and Washington were also assessing the diplomatic fallout from the incident for days."
check("fixture is beyond tolerance (>43 words)", len(long_text.split()) > 43, len(long_text.split()))
g = copy.deepcopy(good); g["so_far"][0]["text"] = long_text
c, p = sl.build_recap(g, members)
check("over-cap so_far: reported", c is None and any("2026-09-30" in x and "35" in x for x in p), p)
c, p = sl.build_recap(g, members, final=True)
t = c["recap"]["so_far"][0]["text"] if c else ""
check("over-cap final: trimmed to cap", c is not None and 0 < len(t.split()) <= 35, t)
check("over-cap final: ends on a sentence", t.endswith("."), t)
check("over-cap final: kept the first sentence", t.startswith("The captain was stabbed"))
one_sentence = " ".join(["word"] * 80) + "."
g = copy.deepcopy(good); g["latest"]["text"] = one_sentence
c, p = sl.build_recap(g, members)
check("over-cap latest: reported", c is None and any("latest" in x and "60" in x for x in p), p)
c, p = sl.build_recap(g, members, final=True)
check("single long sentence: hard cut with ellipsis", c and c["recap"]["latest"]["text"].endswith("…") and len(c["recap"]["latest"]["text"].split()) == 60, c)
# a single long sentence with a comma in the back half closes there, no ellipsis
clause = ("A Flydubai flight from Dubai to Tel Aviv, carrying 174 passengers, experienced a mid-air security scare when an Omani "
          "co-pilot allegedly stabbed an Indian captain, leading to an emergency diversion to Saudi Arabia and then onward.")
check("clause fixture over 35", len(clause.split()) > 35, len(clause.split()))
t = sl._trim_words(clause, 35)
check("clause trim: ends with a period, no ellipsis", t.endswith(".") and "…" not in t and len(t.split()) <= 35, t)
check("clause trim: keeps the main clause", t.startswith("A Flydubai flight") and "allegedly stabbed an Indian captain" in t, t)
# a copy of the pre-fix clause logic, to prove the fixture below really triggers the bug
import re as _re
def _old_trim(text, cap):
    if len(text.split()) <= cap: return text
    head = " ".join(text.split()[:cap])
    for i in range(len(head) - 1, -1, -1):
        if head[i] in ",;" and len(head[:i].split()) >= cap // 2:
            return head[:i].rstrip() + "."
    return head.rstrip(",;:") + "…"
bugtext = ("A Flydubai flight from Dubai to Tel Aviv suddenly lost altitude and plunged from 33,000 or 34,000 feet while the crew "
           "fought off an attacker and the passengers and crew helped to overpower him before the emergency landing in Saudi Arabia that evening")
check("fixture reproduces the old bug", _old_trim(bugtext, 24).endswith(("33.", "34.")), _old_trim(bugtext, 24))
t = sl._trim_words(bugtext, 24)
check("fixed: not cut inside a number", not t.endswith(("33.", "34.")) and len(t.split()) <= 24, t)
check("fixed: falls back to the ellipsis cut here (no real clause comma)", t.endswith("…"), t)
bug2 = ("The student protests spread across the whole country this week and police arrested about 2,000 people according to the ministry while other "
        "outlets put the number far higher and said the protests were spreading further into the suburbs of several major cities")
check("fixture 2 reproduces the old bug", _old_trim(bug2, 22).endswith("2."), _old_trim(bug2, 22))
check("fixed 2: not cut inside a number", not sl._trim_words(bug2, 22).endswith("2."), sl._trim_words(bug2, 22))
# REGRESSION (audit of stored recaps, 9 Oct): the comma in "34,000" was taken for a clause break -> "...from 33,000 or 34."
num = ("A Flydubai flight experienced a security scare and the plane plunged from 33,000 or 34,000 feet down to 14,000 or 17,000 feet "
       "after the incident, according to reports from several outlets (reports differ: 14,000, 17,000 feet).")
t = sl._trim_words(num, 30)
check("trim: never cuts inside a number", not t.rstrip(".…").endswith(("33", "34", "14", "17")) and "34." not in t and "17." not in t, t)
check("trim: result within cap", len(t.split()) <= 30, t)
check("trim: no unclosed bracket", t.count("(") == t.count(")"), t)
check("trim: thousands separators are not clause commas", sl._trim_words("x " * 20 + "from 33,000 feet " + "y " * 15, 30).count(",") <= 1)
tb = sl._trim_words("Officials said the incident happened early in the morning near the border " + "and " * 5 + "(reports differ: 14 vs 17) while more " + "z " * 20, 22)
check("trim: bracket opened after the cut point never survives half-open", tb.count("(") == tb.count(")"), tb)
check("clause trim: comma too early falls back to ellipsis", sl._trim_words("Yes, " + " ".join(["w"] * 60) + ".", 35).endswith("…"))
g = copy.deepcopy(good); g["latest"]["text"] = " ".join(["w"] * 60)   # exactly at cap
check("exactly at cap ok", sl.build_recap(g, members)[0] is not None)

# conflicts
g = copy.deepcopy(good); g["so_far"][1]["text"] = "Reports say 174 on board."
c, p = sl.build_recap(g, members)
check("conflict not stated: rejected", c is None and any("180" in x and "people on board" in x for x in p), p)
g["conflicts"] = [{"what": "altitude", "figures": ["14,000 ft", "17,000 ft"]}]
g["so_far"][1]["text"] = "Altitude reports differ: 14000 ft vs 17,000 feet."
c, p = sl.build_recap(g, members)
check("conflict figures: comma-insensitive match", c is not None, p)
g["conflicts"] = [{"what": "who is blamed", "figures": ["lone wolf", "terror cell"]}]
c, p = sl.build_recap(g, members)
check("non-numeric conflict: no check", c is not None, p)
g["conflicts"] = []
check("empty conflicts ok", sl.build_recap(g, members)[0] is not None)
g.pop("conflicts")
check("missing conflicts key ok", sl.build_recap(g, members)[0] is not None)
g["conflicts"] = ["junk", {"what": "x", "figures": None}]
check("junk conflicts ignored", sl.build_recap(g, members)[0] is not None)
# only the first MAX_CONFLICTS are enforced (the 7 Oct run listed 8, incl. name spellings and codes)
g = copy.deepcopy(good)
g["conflicts"] = [{"what": "people on board", "figures": ["174", "180"]},
                  {"what": "captain name", "figures": ["Smith Mac", "Smith Matcher"]},
                  {"what": "altitude", "figures": ["14,000", "17,000"]},     # 3rd: enforced, absent from text
                  {"what": "emergency code", "figures": ["7700", "7500"]},   # 4th+: ignored
                  {"what": "a fifth", "figures": ["9999"]}]
c, p = sl.build_recap(g, members)
check("conflicts: 3rd enforced", c is None and len(p) == 1 and "altitude" in p[0], p)
g["so_far"][2]["text"] = "Altitude reports differ: 14,000 or 17,000 ft."
c, p = sl.build_recap(g, members)
check("conflicts: 4th and 5th ignored", c is not None, p)
check("MAX_CONFLICTS is 3", sl.MAX_CONFLICTS == 3)

# a trim must not silently remove a flagged figure
g = copy.deepcopy(good); g["so_far"][1]["text"] = ("Many things happened and were reported that day by many outlets in many places. "
    "More things followed in the evening across several cities and countries and agencies, as officials spoke at length today. "
    "Reports differ: 174 vs 180 on board.")
g["so_far"][1]["text"] = g["so_far"][1]["text"]
c, p = sl.build_recap(g, members, final=True)
# members here carry no 174/180, so nothing can be recorded under differ either
check("final: figure not in the reports is not invented into differ", c is not None and "differ" not in c["recap"], (c, p))
c, p = sl.build_recap(g, members)
check("non-final: same answer is still a problem", c is None and any("180" in x for x in p), p)

# differ: the flag survives the word cap when both figures are in the reports
def with_text(base, i, lead):
    out = copy.deepcopy(base); out[i]["short"] = {"lead": lead, "key_points": []}; return out
mem_n = with_text(members, 1, "174 passengers were on board") ; mem_n = with_text(mem_n, 2, "Another outlet says 180 lives and 140 lives")
g = copy.deepcopy(good); g["so_far"][1]["text"] = "Many things happened."
g["conflicts"] = [{"what": "people on board", "figures": ["174", "180"]}, {"what": "lives saved", "figures": ["140", "174"]},
                  {"what": "altitude", "figures": ["15,000", "17,000"]}]      # altitude is NOT in the reports
c, p = sl.build_recap(g, mem_n, final=True)
check("final: unstated sourced conflicts go to differ", c is not None and c["recap"].get("differ") == ["people on board: 174 vs 180", "lives saved: 140 vs 174"], (c, p))
check("final: unsourced altitude not invented", c is not None and not any("altitude" in d for d in c["recap"]["differ"]))
c, p = sl.build_recap(g, mem_n)
check("non-final: unstated conflicts are problems", c is None and len(p) == 3, p)
g["so_far"][1]["text"] = "Reports differ: 174 vs 180 on board, and 140 vs 174 saved, and 15,000 vs 17,000 ft."
c, p = sl.build_recap(g, mem_n)
check("no differ key when everything is in the text", c is not None and "differ" not in c["recap"], (c, p))
g["conflicts"] = [{"what": "x", "figures": ["174"]}]
g["so_far"][1]["text"] = "Many things happened."
c, p = sl.build_recap(g, mem_n, final=True)
check("differ needs two sourced figures", c is not None and "differ" not in c["recap"], c)

# cap tolerance: <=25% over is trimmed on the first pass, not re-asked
check("tolerance constant", sl.CAP_TOLERANCE == 1.25)
t40 = ("Officials said the aircraft landed safely after the incident, and the captain was treated in hospital for stab wounds, "
       "while investigators began questioning the surviving crew members about what had happened in the cockpit earlier that day.")
g = copy.deepcopy(good); g["so_far"][0]["text"] = t40
n40 = len(t40.split())
check("tolerance fixture is 36-43 words", 36 <= n40 <= 43, n40)
c, p = sl.build_recap(g, members)
check("within tolerance: accepted and trimmed", c is not None and len(c["recap"]["so_far"][0]["text"].split()) <= 35, (p, n40))
g["so_far"][0]["text"] = " ".join(["w"] * 44) + "."        # 44 > 35*1.25=43.75
c, p = sl.build_recap(g, members)
check("beyond tolerance: re-ask", c is None and any("44 words" in x for x in p), p)

# single-day story
one_day = [m(1, 2026, 10, 3), m(2, 2026, 10, 3, "VAN"), m(3, 2026, 10, 3, "C247")]
c, p = sl.build_recap({"title": "T", "so_far": [], "latest": {"date": "2026-10-03", "text": "All on one day."}, "conflicts": []}, one_day)
check("single day: ok with empty so_far", c is not None and c["recap"]["so_far"] == [], p)
c, p = sl.build_recap({"title": "T", "so_far": [{"date": "2026-10-03", "text": "x"}], "latest": {"date": "2026-10-03", "text": "y"}}, one_day)
check("single day: so_far entry for same day dropped", c is not None and c["recap"]["so_far"] == [], p)

# Europe/London day boundary: 23:30 UTC on 30 Sep is 00:30 BST on 1 Oct
late = m(9, 2026, 9, 30); late["when"] = datetime(2026, 9, 30, 23, 30, tzinfo=timezone.utc)
check("local day: BST boundary", sl._local_date(late["when"]) == "2026-10-01")

# ---------------------------------------------------------------- recap_prompt
system, contents = sl.recap_prompt("Working title", members)
check("prompt lists days", "so_far, one entry each: 2026-09-30, 2026-10-01, 2026-10-02" in contents and "latest: 2026-10-04" in contents, contents[:300])
check("prompt single-day", "(none: the story spans one day)" in sl.recap_prompt("T", one_day)[1])
check("system mentions conflicts and caps", "conflicts" in system and "never more than 35" in system and "never more than 60" in system)
check("system narrows conflicts to numbers", "at most 3" in system and "spelling variants of names" in system)
check("schema requires conflicts", "conflicts" in sl.RECAP_SCHEMA["required"])

# ---------------------------------------------------------------- make_recap (re-ask flow)
class Stub:
    def __init__(self, *answers): self.answers = list(answers); self.calls = []
    def __call__(self, contents, system):
        self.calls.append(contents)
        return self.answers.pop(0)

bad_days = copy.deepcopy(good); bad_days["so_far"] = bad_days["so_far"][:1]
s = Stub(good)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: first good -> 1 call", c is not None and n == 1 and len(s.calls) == 1 and p == [])

s = Stub(bad_days, good)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: re-ask fixes -> 2 calls", c is not None and n == 2 and len(s.calls) == 2, p)
check("make_recap: feedback names missing days", "2026-10-01" in s.calls[1] and "REJECTED" in s.calls[1])
check("make_recap: feedback carries previous answer", json.dumps(bad_days, ensure_ascii=False) in s.calls[1])
check("make_recap: first call has no feedback", "REJECTED" not in s.calls[0])

wrong_latest = copy.deepcopy(good); wrong_latest["latest"]["date"] = "2026-10-03"
s = Stub(wrong_latest, good)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: wrong latest date re-asked, result dated newest", c and c["recap"]["latest"]["date"] == "2026-10-04" and n == 2)

over = copy.deepcopy(good); over["so_far"][0]["text"] = long_text
s = Stub(over, None)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: re-ask returns nothing, over-cap first answer trimmed", c is not None and n == 2 and len(c["recap"]["so_far"][0]["text"].split()) <= 35, p)

s = Stub(bad_days, None)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: hard problem + failed re-ask -> fail", c is None and n == 2 and p, p)

s = Stub(bad_days, bad_days)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: still bad -> fail, 2 calls max", c is None and n == 2 and len(s.calls) == 2)

# on failure the problems reported are the corrected answer's, not the first one's
other_bad = copy.deepcopy(good); other_bad["latest"]["date"] = "2026-10-03"
s = Stub(bad_days, other_bad)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: failure reports the re-ask's problems", c is None and any("latest is dated 2026-10-03" in x for x in p) and not any("no entry for" in x for x in p), p)
s = Stub(bad_days, None)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: re-ask nothing -> keeps first answer's problems", c is None and any("no entry for" in x for x in p), p)

s = Stub(None)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: no answer -> not re-asked", c is None and n == 1 and len(s.calls) == 1 and p == ["no answer from Gemini"], p)

s = Stub({"title": "x"}, good)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: dict without latest -> re-asked", c is not None and n == 2)

# over-cap first answer, re-ask still over cap -> trimmed (soft problems never fail a recap)
s = Stub(over, over)
c, p, n = sl.make_recap("T", members, ask=s)
check("make_recap: still over cap -> trimmed, accepted", c is not None and len(c["recap"]["so_far"][0]["text"].split()) <= 35)

# ---------------------------------------------------------------- refresh_recaps with a fake backend
class FakeBackend:
    def __init__(self, targets, members_by_id): self.t = targets; self.m = members_by_id; self.saved = {}
    def recap_targets(self): return self.t
    def members(self, sid): return self.m[sid]
    def save_recap(self, sid, title, recap, n): self.saved[sid] = (title, recap, n)

orig = sl._ask_recap
seq = Stub(bad_days, good, good)    # storyline 1 re-asked, storyline 2 first time
sl._ask_recap = lambda contents, system: seq(contents, system)
# make_recap's default arg captured the original function at def time; call via ask= in refresh? check:
fb = FakeBackend([{"id": "a", "title": "A", "story_count": 5}, {"id": "b", "title": "B", "story_count": 5}], {"a": members, "b": members})
import io, contextlib
buf = io.StringIO()
# refresh_recaps calls make_recap(...) with the default ask bound at def time, so patch the default
sl.make_recap.__defaults__ = (lambda contents, system: seq(contents, system),)
with contextlib.redirect_stdout(buf):
    stats = sl.refresh_recaps(fb)
sl.make_recap.__defaults__ = (orig,)
check("refresh: both saved", set(fb.saved) == {"a", "b"} and stats["refreshed"] == 2 and stats["failed"] == 0, stats)
check("refresh: reasked counted", stats["reasked"] == 1, stats)
check("refresh: saved count is story_count", fb.saved["a"][2] == 5)
check("refresh: log says re-asked", "re-asked once" in buf.getvalue(), buf.getvalue())

# circuit breaker: 3 failures in a row stop the run
seq = Stub(*[None] * 10)
sl.make_recap.__defaults__ = (lambda contents, system: seq(contents, system),)
fb = FakeBackend([{"id": str(i), "title": f"T{i}", "story_count": 5} for i in range(6)], {str(i): members for i in range(6)})
with contextlib.redirect_stdout(io.StringIO()):
    stats = sl.refresh_recaps(fb)
sl.make_recap.__defaults__ = (orig,)
check("refresh: stops after 3 failures", stats["failed"] == 3 and stats["refreshed"] == 0 and len(seq.calls) == 3, (stats, len(seq.calls)))

# fewer than MIN_RECAP_STORIES members skipped
seq = Stub(good)
sl.make_recap.__defaults__ = (lambda contents, system: seq(contents, system),)
fb = FakeBackend([{"id": "a", "title": "A", "story_count": 2}], {"a": members[:2]})
with contextlib.redirect_stdout(io.StringIO()):
    stats = sl.refresh_recaps(fb)
sl.make_recap.__defaults__ = (orig,)
check("refresh: <3 members skipped", stats["refreshed"] == 0 and stats["failed"] == 0 and not seq.calls)

# ---------------------------------------------------------------- engine: round-up guard + regression
def unit(v):
    return sl._unit(v)
V1, V2 = unit([1, 0, 0]), unit([0.95, 0.3, 0])         # cosine ~0.95
llm_calls = []
def fake_flash(**kw):
    llm_calls.append(kw)
    return fake_flash.answer
fake_flash.answer = {"match": "A", "title": "Same event"}
real_flash = sl.llm.flash_json
sl.llm.flash_json = fake_flash

# two normal reports -> create
mb = sl.MemoryBackend()
eng = sl.Engine(mb)
a = story(1, 1, vec=V1, headline="Event report one")
b = story(2, 2, vec=V2, headline="Event report two")
r1 = eng.process(a); r2 = eng.process(b)
check("regression: first story none", r1["action"] == "none" and not llm_calls[:0])
check("regression: second creates storyline", r2["action"] == "create" and len(mb.storylines) == 1 and a["storyline_id"] == b["storyline_id"], r2)
check("regression: gemini called once", len(llm_calls) == 1)

# third joins
c3 = story(3, 3, vec=unit([0.9, 0.4, 0]), headline="Event report three")
fake_flash.answer = {"match": "A", "title": ""}
r3 = eng.process(c3)
check("regression: third joins", r3["action"] == "join" and c3["storyline_id"] == a["storyline_id"], r3)

# a round-up arriving: no candidates lookup, no gemini call, stays unassigned
llm_calls.clear()
ru = story(4, 3, vec=V1, lead="Round-up: three unrelated items.", headline="Single-topic-looking headline")
r4 = eng.process(ru)
check("round-up new story: skipped", r4["action"] == "none" and r4.get("skipped") == "round-up" and r4["candidates"] == 0, r4)
check("round-up new story: zero gemini calls", llm_calls == [])
check("round-up new story: not assigned", ru.get("storyline_id") is None)
check("round-up new story: decision recorded", eng.decisions[-1]["story"] == "s4")

# a round-up in the pool never becomes a candidate (even though it is the closest)
mb2 = sl.MemoryBackend([story(10, 1, vec=V1, lead="Round-up: items", headline="Round-up one"),
                        story(11, 1, vec=unit([0.8, 0.5, 0]), headline="Real report")])
cands = mb2.candidates(story(12, 2, vec=V1, headline="New"))
check("round-up never a candidate", [e["id"] for e in cands] == ["s11"], [e["id"] for e in cands])

# round-ups do not eat the 8 candidate slots (filter happens before the cut)
pool = [story(100 + i, 1, vec=unit([1, 0.01 * i, 0]), lead="Round-up: x") for i in range(8)] + \
       [story(200 + i, 1, vec=unit([0.9, 0.3 + 0.01 * i, 0]), headline=f"Real {i}") for i in range(3)]
cands = sl.MemoryBackend(pool).candidates(story(300, 2, vec=V1))
check("round-ups do not crowd out real candidates", len(cands) == 3 and all(e["id"].startswith("s2") for e in cands), [e["id"] for e in cands])

# story with no short (not recognised as round-up) behaves as before
nos = story(5, 4, vec=V1, lead="NONE")
fake_flash.answer = {"match": None, "title": ""}
r5 = eng.process(nos)
check("no-short story still processed", r5["candidates"] >= 1 and r5["action"] == "none")

# gemini failure path unchanged
fake_flash.answer = None
r6 = eng.process(story(6, 4, vec=V1, headline="Another"))
check("gemini None -> error", r6["action"] == "error" and eng.llm_failures == 1)

# ---------------------------------------------------------------- DbBackend with a fake client
class Chain:
    def __init__(self, data): self.data = data
    def select(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return self
class FakeClient:
    def __init__(self, rpc_rows, story_rows, storyline_rows=()):
        self.rpc_rows, self.story_rows, self.sl_rows = rpc_rows, story_rows, storyline_rows; self.rpc_args = None
    def rpc(self, name, args): self.rpc_args = args; return Chain(self.rpc_rows)
    def table(self, name): return Chain(self.story_rows if name == "stories" else list(self.sl_rows))
def row(i, lead, sid=None, d=1):
    return {"id": f"d{i}", "category": "india_global", "headline": f"H{i}", "summary": "s", "short": {"lead": lead, "key_points": []},
            "created_at": f"2026-10-0{d}T12:00:00+00:00", "videos": {"published_at": f"2026-10-0{d}T11:00:00+00:00"},
            "sources": {"name": "IGR"}, "storyline_id": sid}
rpc_rows = [{"id": f"d{i}", "similarity": 0.95 - i * 0.01} for i in range(12)]
story_rows = [row(i, "Round-up: x" if i < 8 else "Real lead") for i in range(12)]
fc = FakeClient(rpc_rows, story_rows)
cands = sl.DbBackend(fc).candidates(story(50, 2, vec=V1))
check("db: asks RPC for twice the cut", fc.rpc_args["p_limit"] == 2 * sl.MAX_CANDIDATES, fc.rpc_args)
check("db: round-ups dropped, real ones kept in similarity order", [e["id"] for e in cands] == ["d8", "d9", "d10", "d11"], [e["id"] for e in cands])
check("db: excludes the story itself", fc.rpc_args["p_exclude_id"] == "s50")
story_rows2 = [row(i, "Real lead") for i in range(12)]
cands = sl.DbBackend(FakeClient(rpc_rows, story_rows2)).candidates(story(50, 2, vec=V1))
check("db: cut to 8 after filtering", len(cands) == sl.MAX_CANDIDATES)

sl.llm.flash_json = real_flash

# ---------------------------------------------------------------- prompt text
check("assign prompt: same subject is not same story", "Same subject is not same story" in sl.ASSIGN_SYSTEM)
check("assign prompt: separate incidents", "Separate incidents" in sl.ASSIGN_SYSTEM)
check("assign prompt: keeps commentary on the event", "commentary or analysis about that event" in sl.ASSIGN_SYSTEM)
check("assign prompt: round-up rule kept", "Round-up or multi-topic videos" in sl.ASSIGN_SYSTEM)
check("threshold unchanged", sl.MIN_SIM == 0.70)
contents, labels = sl.Engine.build_prompt(story(7, 3, vec=V1), cands[:2])
check("build_prompt still builds", "NEW REPORT" in contents and set(labels) == {"A", "B"})

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
