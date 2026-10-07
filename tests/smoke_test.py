#!/usr/bin/env python3
"""Smoke test for Bot Island Arcade.
1. Data honesty, computed in Python straight from ../bot-island/data/fleet.json (read-only): every bot in the level data
   really exists, every delivery is a real logged event at its real timestamp, nothing about money, no message bodies.
2. Headless Chrome (one instance, niced, Chrome DevTools) drives the game with real key and touch events: starts it, flies
   deliveries with an arrow-key autopilot, checks scoring, combo, pause, mute, the token meter + boost, game over, the
   localStorage high-score table, touch controls on a phone viewport, the offline snapshot, and that no JS errors occur.
Usage: python3 tests/smoke_test.py [--no-browser] [--shots]"""
import json, os, re, subprocess, sys, collections, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(R)
ET = ZoneInfo("America/New_York"); SRC = os.path.join(R, "..", "bot-island", "data", "fleet.json")
res = []
def check(name, cond, info=""): res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info != "" else ""), flush=True)
def etday(ts): return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(ET).date().isoformat()
src = json.load(open(SRC, encoding="utf-8")); hidden = set(json.load(open(os.path.join(R, "..", "bot-island", "config.json"))).get("hide", []))
name = {b["id"]: b["name"] for b in src["bots"] if b["name"] not in hidden}; real = set(name.values())
snap = open("dist/bot-island-arcade.html", encoding="utf-8").read()
data = json.loads(re.search(r"window\.ARCADE_DATA = (\{.*?\});</script>", snap, re.S).group(1))
MONEY = re.compile(r"bill|financ|cash|money|statement|budget|pay|bank|invest|\$", re.I)

# --- 1. data honesty ---
WANT = ["Michael", "Pam", "Oscar", "Jim", "Kelly", "Ryan", "Dwight", "Brief", "Pods", "Path", "Vic Tutor", "Char Tutor", "Boyd Family Times", "Dr. EggBot", "TokenMax"]
check("all 15 requested bots are on the island (from fleet.json)", all(n in real and n in {b["name"] for b in data["bots"]} for n in WANT), f'{len(data["bots"])} bots')
jobs = [j for L in data["levels"] for j in L["jobs"]]
inlv = {n for j in jobs for n in (j["from"], j.get("to")) if n and n != "Boyd"}
check("every bot in the level data really exists in fleet.json", inlv <= real and {b["name"] for b in data["bots"]} <= real, f"{len(inlv)} bots in levels: " + ", ".join(sorted(inlv)))
check("every requested bot gets at least one delivery", set(WANT) <= inlv, sorted(set(WANT) - inlv))
by_ts = collections.defaultdict(list)
for e in src["events"]: by_ts[e["ts"]].append(e)
runs = {(b["name"], r["name"], x["start"]) for b in src["bots"] for r in b.get("routines", []) for x in r.get("runs", [])}
bad = []
for j in jobs:
    for ts in j["srcTs"]:
        if j["kind"] == "msg": ok = any(e["type"] == "agent_msg" and name.get(e.get("from")) == j["from"] and name.get(e["bot"]) == j["to"] for e in by_ts[ts])
        elif j["kind"] == "boyd": ok = j["from"] == "Boyd" and any(e["type"] == "boyd_msg" and name.get(e["bot"]) == j["to"] for e in by_ts[ts])
        elif j["kind"] == "output": ok = any(e["type"] in ("dated_output", "file_write") and name.get(e["bot"]) == j["from"] for e in by_ts[ts])
        elif j["kind"] == "routine": ok = (j["from"], j["label"], ts) in runs
        else: ok = False
        if not ok: bad.append((j["id"], ts))
check("every delivery is a real logged event at its real timestamp", not bad and len(jobs) > 0, f"{len(jobs)} deliveries, {sum(len(j['srcTs']) for j in jobs)} source events, {len(bad)} unmatched {bad[:3]}")
for L in data["levels"]:
    d = L["day"]; exp = collections.Counter()
    for e in src["events"]:
        if e.get("bot") in name and etday(e["ts"]) == d and e["type"] in ("agent_msg", "boyd_msg", "dated_output", "file_write") and (e["type"] != "agent_msg" or e.get("from") in name): exp[e["type"]] += 1
    for b in src["bots"]:
        if b["name"] in hidden: continue
        for r in b.get("routines", []):
            for x in r.get("runs", []):
                if etday(x["start"]) == d and not MONEY.search(r["name"]): exp["routine_run"] += 1
    got = collections.Counter()
    for j in L["jobs"]: got[j["srcType"]] += len(j["srcTs"])
    check(f'level "{L["title"]}" = every qualifying event that ET day', got == exp and L["title"].startswith(datetime.fromisoformat(d).strftime("%A")), f"{len(L['jobs'])} deliveries from {sum(exp.values())} events")
check("levels are named after real replay days (days with logged events)", all(any(etday(e["ts"]) == L["day"] for e in src["events"]) for L in data["levels"]), ", ".join(L["short"] for L in data["levels"]))
check("nothing about money (no money routines or labels)", not any(MONEY.search(j["label"]) for j in jobs) and data["excluded"].get("money routine run", 0) > 0, f'excluded {data["excluded"]}')
ALLOWED = {"kind", "label", "from", "to", "fromB", "toB", "srcType", "srcTs", "count", "ts", "id", "exts", "status"}
check("no message bodies: deliveries carry only who/where/when + existing labels", all(set(j) <= ALLOWED for j in jobs) and not any(k in json.dumps(src["events"][:50]) for k in ('"text"', '"body"', '"subject"')), sorted({k for j in jobs for k in j}))
check("labels come from the data (routine names, output labels, file extensions)", all(j["label"] in ("Message", "Message from Boyd") or j["kind"] == "routine" or j["label"].startswith("New files: ") or any(e.get("tool") == j["label"] for ts in j["srcTs"] for e in by_ts[ts]) for j in jobs))
check("snapshot is offline (no external scripts, styles or images)", not re.search(r'<(script|link|img)[^>]+(src|href)\s*=\s*["\']?https?:', snap) and "cdn." not in snap, f"{len(snap)//1024} KB")
try:
    page = urllib.request.urlopen("http://127.0.0.1:4267/", timeout=5).read().decode()
    check("server :4267 serves the game", "Bot Island Arcade" in page and "ARCADE_DATA" in page and json.load(urllib.request.urlopen("http://127.0.0.1:4267/api/health", timeout=5)).get("ok"))
except Exception as e: check("server :4267 reachable", False, e)

# --- 2. headless drive ---
if "--no-browser" not in sys.argv:
    cmd = ["nice", "-n", "15", "node", "--experimental-websocket", "tests/drive.mjs", "http://127.0.0.1:4267/", "file://" + os.path.join(R, "dist", "bot-island-arcade.html")] + (["--shots"] if "--shots" in sys.argv else [])
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    try: O = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception: O = {"crash": (p.stdout + p.stderr)[-800:]}
    check("headless drive ran", "crash" not in O, O.get("crash", ""))
    S = O.get("steps", {}); T = O.get("title", {})
    check("title screen: 7 real days to pick", T.get("screen") == "title" and T.get("levels") == len(data["levels"]) == 7, T.get("levels"))
    check("JS sees exactly the baked levels", O.get("levels") == [{"day": L["day"], "title": L["title"], "jobs": [{k: j.get(k) for k in ("id", "ts", "kind", "from", "to", "label", "count", "srcTs")} for j in L["jobs"]]} for L in data["levels"]])
    check("JS: every bot in the level data exists in the bot list", O.get("levelBots") and set(O["levelBots"]) <= set(O.get("bots", [])) and set(O["levelBots"]) <= real, len(O.get("levelBots") or []))
    check("Enter starts the game", S.get("started") == "play")
    check("arrow keys move the drone", (S.get("arrowDx") or 0) < -40, S.get("arrowDx"))
    check("WASD moves the drone", (S.get("wasdDy") or 0) > 40, S.get("wasdDy"))
    l1 = S.get("level1", {}); n1 = len(data["levels"][0]["jobs"])
    check("scoring: autopilot (arrow keys) delivers all of Level 1 and scores", l1.get("screen") == "clear" and l1.get("delivered") == n1 and l1.get("score", 0) > 0, l1)
    check("combo meter builds on back-to-back deliveries", l1.get("combo", 0) >= 2 and (S.get("level4") or {}).get("combo", 0) >= 2, f'L1 combo {l1.get("combo")}, L4 combo {(S.get("level4") or {}).get("combo")}')
    check("Enter on the day-complete card goes to the next day", S.get("level2") == 1)
    check("pause screen freezes the game; P resumes", (S.get("pause") or {}).get("screen") == "paused" and S["pause"].get("frozen") and S["pause"].get("frozen2") and S.get("resumed") == "play", S.get("pause"))
    check("mute button state persists (M)", (S.get("mute") or {}).get("muted") and S["mute"].get("stored") == "1" and S.get("unmuted"), S.get("mute"))
    check("token meter fills from coins and Space fires TOKENMAX MODE", S.get("tokens", 0) >= 100 and S.get("boost", 0) > 0, f'tokens {S.get("tokens")}, boost {S.get("boost")}')
    go = S.get("gameOver", {})
    check("game over after 5 missed deliveries", go.get("screen") == "over" and go.get("misses") == 5, go)
    sv = S.get("saved") or []
    check("high-score table saved to localStorage (quick-pick 'Vic')", any(r.get("name") == "Vic" and r.get("score", 0) > 0 for r in sv), sv[:2])
    check("high scores show on the title screen after reload", "Vic" in (S.get("titleScores") or ""), (S.get("titleScores") or "")[:80])
    t = S.get("touch", {})
    check("touch: drag on a phone moves the drone; touch controls shown", t.get("touchUi") and t.get("dx", 0) < -20 and t.get("dy", 0) > 10, t)
    sn = O.get("snapshot", {})
    check("offline snapshot (file://) plays with no network", sn.get("delivered", 0) >= 1 and sn.get("score", 0) > 0 and sn.get("net") == 0, sn)
    check("no JavaScript errors", not O.get("errors"), O.get("errors"))
shots = sorted(f for f in os.listdir("screenshots") if f.endswith(".png")) if os.path.isdir("screenshots") else []
check("screenshots: title, gameplay (00-best), game over, phone", any(f.startswith("00-best-") for f in shots) and {"01-title.png", "03-game-over.png", "04-phone.png"} <= set(shots), shots)
print(f"\n{sum(res)}/{len(res)} checks passed"); sys.exit(0 if all(res) else 1)
