#!/usr/bin/env python3
"""Bot Island Arcade build. Reads Bot Island's data READ-ONLY and bakes the levels into one offline HTML file.
Sources (never written): ../bot-island/data/fleet.json, ../bot-island/config.json, ../bot-island/web/app.js
(building layout, palette, emoji), /workspace/tokenmax/usage.json (the token-meter joke on the title screen).

Every delivery job is one real event (or a burst of identical real events) from fleet.json:
  agent_msg            -> "Message" envelope: pick up at sender's building, drop at recipient's building
  boyd_msg             -> "Message from Boyd": pick up at Boyd's Place, drop at the bot's building
  routine run          -> wake-up ping at the bot's building, labelled with the routine's real name
  dated_output         -> collect the output at the bot's building, labelled with its real label
  file_write           -> collect new files at the bot's building, labelled with the real file extensions
No message bodies exist in fleet.json and none are used. Money routines are excluded; nothing about grades is read."""
import json, os, re, collections
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__))
BI = os.path.normpath(os.path.join(HERE, "..", "bot-island"))
FLEET = os.path.join(BI, "data", "fleet.json"); CONFIG = os.path.join(BI, "config.json"); APPJS = os.path.join(BI, "web", "app.js")
USAGE = "/workspace/tokenmax/usage.json"
ET = ZoneInfo("America/New_York")
LEVEL_DAYS = ["2026-10-07", "2026-09-14", "2026-09-10", "2026-09-11", "2026-09-15", "2026-08-20", "2026-09-09"]  # easiest first
MONEY = re.compile(r"bill|financ|cash|money|statement|budget|pay|bank|invest|\$", re.I)

def ro(p):
    with open(p, "r", encoding="utf-8") as f: return f.read()
def dt(ts): return datetime.fromisoformat(ts.replace("Z", "+00:00"))
def etday(ts): return dt(ts).astimezone(ET).date().isoformat()

def layout():
    js = ro(APPJS)
    colors = dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", re.search(r"const COLORS = \{(.*?)\};", js).group(1)))
    blk = re.search(r"const BUILDINGS = \{(.*?)\n\};", js, re.S).group(1)
    b = {}
    for m in re.finditer(r"(\w+):\s*\{x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*name:\s*(['\"])(.*?)\4,\s*emoji:\s*'(.*?)'(.*?)\}", blk):
        b[m.group(1)] = {"x": float(m.group(2)), "y": float(m.group(3)), "name": m.group(5), "emoji": m.group(6), "decor": "decor" in m.group(7)}
    m = re.search(r"BUILDINGS\.boyd = \{x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*name:\s*\"(.*?)\"", js)
    if m: b["boyd"] = {"x": float(m.group(1)), "y": float(m.group(2)), "name": m.group(3), "emoji": "🏠", "decor": True}
    emo = dict(re.findall(r"'?([\w .()\-]+?)'?:\s*'([^']+)'", re.search(r"const EMOJI = \{(.*?)\};", js).group(1)))
    return colors, b, emo

def build_levels(fleet, hide):
    bots = {b["id"]: b for b in fleet["bots"] if b["name"] not in hide}
    name = {i: b["name"] for i, b in bots.items()}
    bld = {i: b.get("building") or "commons" for i, b in bots.items()}
    levels = []; excluded = collections.Counter()
    for day in LEVEL_DAYS:
        raw = []
        for e in fleet["events"]:
            if e.get("bot") not in bots or etday(e["ts"]) != day: continue
            if e["type"] in ("agent_msg", "boyd_msg", "dated_output", "file_write"): raw.append(e)
        runs = []
        for b in bots.values():
            for r in b.get("routines", []):
                for x in r.get("runs", []):
                    if etday(x["start"]) != day: continue
                    if MONEY.search(r["name"]): excluded["money routine run"] += 1; continue
                    runs.append((x["start"], b["id"], r["name"], x.get("status")))
        raw.sort(key=lambda e: e["ts"])
        jobs = []
        def merge(kind, key, ts, window, make):
            for j in reversed(jobs[-12:]):
                if j["_mk"] == kind and j["_key"] == key and (dt(ts) - dt(j["srcTs"][-1])) <= window:
                    j["srcTs"].append(ts); j["count"] += 1; return
            jobs.append(dict(make(), _key=key, _mk=kind, srcTs=[ts], count=1, ts=ts))
        for e in raw:
            t = e["type"]; to = e["bot"]
            if t == "agent_msg":
                fr = e.get("from")
                if fr not in bots: excluded["message from hidden/unknown bot"] += 1; continue
                merge("msg", (fr, to), e["ts"], timedelta(minutes=3), lambda: {"kind": "msg", "label": "Message", "from": name[fr], "to": name[to], "fromB": bld[fr], "toB": bld[to], "srcType": "agent_msg"})
            elif t == "boyd_msg":
                merge("boyd", (to,), e["ts"], timedelta(minutes=10), lambda: {"kind": "boyd", "label": "Message from Boyd", "from": "Boyd", "to": name[to], "fromB": "boyd", "toB": bld[to], "srcType": "boyd_msg"})
            elif t == "dated_output":
                merge("output", (to, e.get("tool")), e["ts"], timedelta(minutes=60), lambda: {"kind": "output", "label": e.get("tool") or "Output", "from": name[to], "to": None, "fromB": bld[to], "toB": None, "srcType": "dated_output"})
            elif t == "file_write":
                merge("files", (to,), e["ts"], timedelta(minutes=60), lambda: {"kind": "output", "label": "New files", "from": name[to], "to": None, "fromB": bld[to], "toB": None, "srcType": "file_write", "exts": []})
                for j in reversed(jobs):
                    if j.get("srcType") == "file_write" and j["_key"] == (to,) and e["ts"] in j["srcTs"]: j["exts"].append(e.get("ext") or "(no ext)"); break
        for start, bid, rname, status in runs:
            jobs.append({"kind": "routine", "label": rname, "from": name[bid], "to": None, "fromB": bld[bid], "toB": None, "srcType": "routine_run", "srcTs": [start], "count": 1, "ts": start, "status": status, "_key": None, "_mk": "routine"})
        jobs.sort(key=lambda j: j["ts"])
        for i, j in enumerate(jobs):
            j.pop("_key", None); j.pop("_mk", None); j["id"] = f"{day}#{i}"
            if j.get("exts"):
                c = collections.Counter(j["exts"]); j["label"] = "New files: " + ", ".join(f"{k} ×{v}" if v > 1 else k for k, v in c.most_common())
        cnt = collections.Counter(j["kind"] for j in jobs)
        pairs = collections.Counter(tuple(sorted((j["from"], j["to"]))) for j in jobs if j["kind"] == "msg")
        cast = sorted({n for j in jobs for n in (j["from"], j["to"]) if n and n != "Boyd"})
        d0 = datetime.fromisoformat(day)
        levels.append({"day": day, "title": d0.strftime("%A, %b ") + str(d0.day), "short": d0.strftime("%a %b ") + str(d0.day),
                       "jobs": jobs, "counts": dict(cnt), "cast": cast,
                       "topPair": (f"{pairs.most_common(1)[0][0][0]} ↔ {pairs.most_common(1)[0][0][1]}" if pairs else None),
                       "firstTs": jobs[0]["ts"] if jobs else None, "lastTs": jobs[-1]["ts"] if jobs else None})
    return levels, dict(excluded)

def build():
    fleet = json.loads(ro(FLEET)); cfg = json.loads(ro(CONFIG)); colors, buildings, emo = layout()
    hide = set(cfg.get("hide", []))
    bots = [{"id": b["id"], "name": b["name"], "title": b.get("title") or "", "color": b.get("color"), "hex": colors.get(b.get("color"), "#94a3b8"),
             "shape": b.get("shape"), "building": b.get("building") or "commons", "emoji": emo.get(b["name"], "🤖")} for b in fleet["bots"] if b["name"] not in hide]
    levels, excluded = build_levels(fleet, hide)
    try: u = json.loads(ro(USAGE)); usage = {k: u.get(k) for k in ("used_pct", "reset_date", "checked_at", "label")}
    except Exception: usage = None
    return {"app": "Bot Island Arcade", "builtAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "fleetGeneratedAt": fleet.get("generatedAt"), "fleetFile": FLEET, "palette": colors, "buildings": buildings,
            "bots": bots, "eggs": fleet.get("eggs", []), "levels": levels, "excluded": excluded, "usage": usage}

def main():
    data = build()
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True); os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    with open(os.path.join(HERE, "data", "levels.json"), "w") as f: json.dump(data, f, indent=1, ensure_ascii=False)
    src = lambda n: ro(os.path.join(HERE, "src", n))
    html = src("index.html")
    html = html.replace("/*__CSS__*/", src("style.css"))
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = html.replace("<!--__DATA__-->", f"<script>window.ARCADE_DATA = {payload};</script>")
    html = html.replace("<!--__JS__-->", "<script>\n" + src("game_head.js") + "\n" + src("art.js") + "\n" + src("game.js") + "\n</script>")
    for n in ("bot-island-arcade.html", "index.html"):
        with open(os.path.join(HERE, "dist", n), "w", encoding="utf-8") as f: f.write(html)
    print(f"built dist/bot-island-arcade.html ({len(html)//1024} KB): " + "; ".join(f'{l["short"]}={len(l["jobs"])} jobs {l["counts"]}' for l in data["levels"]) + f"; excluded {data['excluded']}")

if __name__ == "__main__":
    main()
