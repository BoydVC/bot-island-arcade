// Drives Bot Island Arcade in one headless Chrome (niced) with real key/touch events via Chrome DevTools.
// Usage: node --experimental-websocket tests/drive.mjs <url> [--shots]   → prints one JSON line of results.
import { launch, sleep } from "./cdp.mjs";
const url = process.argv[2], fileUrl = process.argv[3]; const SHOTS = process.argv.includes("--shots"); const SD = process.cwd() + "/screenshots/";
const R = { steps: {} }; const c = await launch(9573, 1440, 900);
const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Space: 32, KeyP: 80, KeyM: 77, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68 };
const KEYNAME = { Space: " ", KeyP: "p", KeyM: "m", KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" };
const key = (code, type) => c.send("Input.dispatchKeyEvent", { type, code, key: KEYNAME[code] || code, windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code] });
const tap = async (code) => { await key(code, "keyDown"); await sleep(40); await key(code, "keyUp"); await sleep(60); };
const st = () => c.ev("ARCADE.state()");
const held = new Set();
async function steer(tx, ty) {
  const s = await st(); const dx = tx - s.drone.x, dy = ty - s.drone.y; const want = new Set();
  if (dx > 10) want.add("ArrowRight"); if (dx < -10) want.add("ArrowLeft"); if (dy > 10) want.add("ArrowDown"); if (dy < -10) want.add("ArrowUp");
  for (const k of [...held]) if (!want.has(k)) { await key(k, "keyUp"); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await key(k, "keyDown"); held.add(k); }
  return s;
}
async function release() { for (const k of [...held]) await key(k, "keyUp"); held.clear(); }
// autopilot: fly to the most urgent target (carried envelopes first) until `until(state)` or timeout
async function autopilot(until, ms, coins = false) {
  const t0 = Date.now(); let s = await st();
  while (Date.now() - t0 < ms && !until(s)) {
    if (s.screen !== "play") break;
    let tgt = null;
    if (coins && s.coins.length) tgt = s.coins.reduce((a, b) => Math.hypot(a.x - s.drone.x, a.y - s.drone.y) < Math.hypot(b.x - s.drone.x, b.y - s.drone.y) ? a : b);
    else if (s.active.length) { const j = [...s.active].sort((a, b) => (b.carry - a.carry) || (a.left - b.left))[0]; tgt = j.target; }
    s = tgt ? await steer(tgt.x, tgt.y) : await st(); await sleep(50);
  }
  await release(); return await st();
}
try {
  await c.goto(url, 1500);
  R.title = await c.ev("({screen: ARCADE.state().screen, levels: document.querySelectorAll('#levelList li').length, h1: document.querySelector('h1').textContent, scores: document.querySelector('#scoresTitle').textContent})");
  R.levels = await c.ev("ARCADE.levels()"); R.bots = await c.ev("ARCADE.bots()");
  R.levelBots = await c.ev("[...new Set(ARCADE.levels().flatMap(L => L.jobs.flatMap(j => [j.from, j.to])).filter(n => n && n !== 'Boyd'))]");
  if (SHOTS) await c.shot(SD + "01-title.png");
  // start with Enter
  await tap("Enter"); await sleep(400); R.steps.started = (await st()).screen;
  // arrow keys move the drone
  let a = await st(); await key("ArrowLeft", "keyDown"); await sleep(600); await key("ArrowLeft", "keyUp"); let b = await st(); R.steps.arrowDx = Math.round(b.drone.x - a.drone.x);
  // WASD moves the drone
  a = await st(); await key("KeyS", "keyDown"); await sleep(600); await key("KeyS", "keyUp"); b = await st(); R.steps.wasdDy = Math.round(b.drone.y - a.drone.y);
  // play level 1 to the end with the autopilot (real key events) → scoring + combo + level clear
  const s1 = await autopilot((s) => s.screen !== "play", 60000);
  R.steps.level1 = { screen: s1.screen, score: s1.score, delivered: s1.delivered, misses: s1.misses, combo: s1.combo };
  R.steps.clearText = await c.ev("document.getElementById('clearStats').textContent");
  // next day (Enter) → level 2: pause/mute/tokens
  await tap("Enter"); await sleep(500); R.steps.level2 = (await st()).level;
  await autopilot((s) => s.delivered >= s1.delivered + 2, 30000);
  a = await st(); await tap("KeyP"); await sleep(700); b = await st();
  R.steps.pause = { screen: b.screen, frozen: Math.abs(b.drone.x - a.drone.x) < 25 && b.active.every((j, i) => !a.active[i] || Math.abs(j.left - a.active[i].left) < 0.2) };
  await sleep(600); const b2 = await st(); R.steps.pause.frozen2 = b2.active.every((j, i) => !b.active[i] || j.left === b.active[i].left);
  if (SHOTS) await c.shot(SD + "05-pause.png");
  await tap("KeyP"); await sleep(200); R.steps.resumed = (await st()).screen;
  await tap("KeyM"); R.steps.mute = { muted: (await st()).muted, stored: await c.ev("localStorage.getItem('botIslandArcade.muted')"), icon: await c.ev("document.getElementById('bMute').textContent") };
  await tap("KeyM"); R.steps.unmuted = !(await st()).muted;
  const t1 = await autopilot((s) => s.tokens >= 100, 45000, true); R.steps.tokens = t1.tokens;
  await tap("Space"); await sleep(200); R.steps.boost = (await st()).boostT;
  await autopilot((s) => s.screen !== "play", 120000);
  // gameplay screenshot on Fri Sep 11 (level 4) mid-rush
  await c.goto(url + "?level=4", 1200);
  await autopilot((s) => s.delivered >= 5 && s.active.length >= 2 && s.combo >= 2, 60000);
  const g = await st(); R.steps.level4 = { score: g.score, combo: g.combo, active: g.active.length, delivered: g.delivered };
  if (SHOTS) { await key("ArrowUp", "keyDown"); await sleep(250); await c.shot(SD + "00-best-gameplay-sep11.png"); await key("ArrowUp", "keyUp"); }
  // game over: Wed Sep 9 (level 7), don't fly; 5 missed deliveries end the shift
  await c.goto(url + "?level=7", 1200);
  await autopilot((s) => s.delivered >= 1, 40000);
  const t0 = Date.now(); let s = await st(); while (s.screen === "play" && Date.now() - t0 < 150000) { await sleep(1000); s = await st(); }
  R.steps.gameOver = { screen: s.screen, misses: s.misses, title: await c.ev("document.getElementById('overTitle').textContent") };
  // save a high score as "Vic" with the quick-pick button, then it must persist across a reload
  await c.ev("document.querySelector('.who button[data-n=Vic]').click()"); await sleep(300);
  if (SHOTS) await c.shot(SD + "03-game-over.png");
  R.steps.saved = await c.ev("JSON.parse(localStorage.getItem('botIslandArcade.scores.v1') || '[]')");
  await c.goto(url, 1000); R.steps.titleScores = await c.ev("document.querySelector('#scoresTitle').textContent");
  // phone: touch drag moves the drone
  await c.viewport(390, 844, true, 3); await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await c.goto(url + "?level=2", 1500);
  a = await st();
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 600 }] });
  for (let i = 1; i <= 6; i++) { await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200 - i * 12, y: 600 + i * 8 }] }); await sleep(80); }
  await sleep(500); b = await st(); R.steps.touch = { dx: Math.round(b.drone.x - a.drone.x), dy: Math.round(b.drone.y - a.drone.y), touchUi: await c.ev("!document.getElementById('touch').hidden") };
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  if (SHOTS) { await autopilot((s) => s.delivered >= 2 && s.active.length >= 1, 30000); await c.shot(SD + "04-phone.png"); }
  // offline single-file snapshot (file://): loads, starts, plays, no errors
  if (fileUrl) { await c.viewport(1280, 800, false, 1); await c.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await c.goto(fileUrl, 1500); await tap("Enter"); await sleep(300);
    const f = await autopilot((s) => s.delivered >= 1, 30000); R.snapshot = { screen: f.screen, delivered: f.delivered, score: f.score, net: await c.ev("performance.getEntriesByType('resource').filter(r => /^https?:/.test(r.name)).length") }; }
  R.errors = [...c.errors, ...((await st()).errors || [])];
} catch (e) { R.crash = String(e.stack || e); R.errors = c.errors; }
await c.close(); console.log(JSON.stringify(R));
