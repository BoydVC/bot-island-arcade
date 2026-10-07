/* ---------- Bot Island Arcade game ---------- */
const LEVELS = DATA.levels;
const BOT_BY_NAME = Object.fromEntries(DATA.bots.map(b => [b.name, b]));
const $ = (id) => document.getElementById(id);
const KIND = {msg: {icon: '✉️', base: 100}, boyd: {icon: '💬', base: 100}, routine: {icon: '⏰', base: 60}, output: {icon: '📦', base: 60}};
const JOKES = ['Use it before the weekly reset!', 'Spending leftover tokens, as designed.', 'On-demand spend: still OFF. Phew.', 'Tokens → fun. That\'s the whole plan.', '0 tokens left on the table!', 'TokenMax approves this burn rate.'];
const RESET_EVERY = 45, MAX_MISSES = 5, SPEED = 250;
const HS_KEY = 'botIslandArcade.scores.v1', MUTE_KEY = 'botIslandArcade.muted';

// bots + houses (same rim layout as Bot Island)
S.bots = DATA.bots.map(b => Object.assign({}, b));
[...S.bots].sort((a, b) => a.name.localeCompare(b.name)).forEach((b, i, arr) => { const a = -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / arr.length) + 0.12; const p = islePoint(a, 0.8); b.home = {x: p.x, y: p.y, a}; b.phase = i * 1.7; });
const BYNAME = Object.fromEntries(S.bots.map(b => [b.name, b]));
function bpos(key) { const b = key === 'boyd' ? BOYD_PLACE : BUILDINGS[key] || BUILDINGS.commons; return {x: b.x, y: b.y + 10}; }
function bname(key) { return key === 'boyd' ? (BOYD_PLACE.name || "Boyd's Place") : (BUILDINGS[key] || {}).name; }
function short(n) { return (n || '').replace('Boyd Family Times (archive)', 'Family Times (archive)').replace('Boyd Family Times', 'Family Times'); }

// ---------- state ----------
const G = {screen: 'title', level: 0, sel: 0, score: 0, levelScore: 0, combo: 0, comboT: 0, bestCombo: 0, misses: 0, delivered: 0, levelDelivered: 0,
  drone: {x: 905, y: 200, vx: 0, vy: 0, tilt: 0}, queue: [], active: [], spawnCD: 0, coins: [], coinCD: 0, bugs: [], fx: [], pops: [],
  tokens: 0, boostT: 0, resetT: RESET_EVERY, dizzyT: 0, clockTs: Date.now(), elapsed: 0, boosts: 0, resets: 0, wasted: 0, lastRank: -1, finishedAll: false};
const keys = new Set(); const touch = {on: false, ox: 0, oy: 0, dx: 0, dy: 0, id: null};
let muted = localStorage.getItem(MUTE_KEY) === '1', actx = null, errorsSeen = [];

// ---------- sound (WebAudio blips, no files) ----------
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } } if (actx && actx.state === 'suspended') actx.resume(); return actx; }
function tone(f, d = 0.12, type = 'sine', vol = 0.08, when = 0, slide = 0) {
  if (muted) return; const a = audio(); if (!a) return; const t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + d); o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
}
const SFX = {
  pick: () => { tone(660, .08, 'square', .05); tone(990, .1, 'square', .05, .06); },
  drop: (m) => { const b = 520 * Math.pow(1.06, Math.min(12, m)); [0, 4, 7, 12].forEach((s, i) => tone(b * Math.pow(2, s / 12), .12, 'triangle', .07, i * .05)); },
  coin: () => { tone(1320, .06, 'square', .04); tone(1760, .12, 'square', .04, .05); },
  boost: () => { tone(220, .6, 'sawtooth', .05, 0, 900); tone(330, .6, 'square', .03, .05, 900); },
  bug: () => { tone(200, .25, 'sawtooth', .06, 0, -120); },
  miss: () => { tone(330, .18, 'triangle', .07); tone(247, .28, 'triangle', .07, .15); },
  reset: () => { tone(880, .1, 'sine', .05); tone(440, .3, 'sine', .05, .1, -200); },
  spawn: () => tone(880, .05, 'sine', .03),
  clear: () => [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * Math.pow(2, s / 12), .16, 'triangle', .07, i * .08)),
  over: () => [12, 7, 4, 0].forEach((s, i) => tone(392 * Math.pow(2, s / 12), .25, 'triangle', .07, i * .14)),
  click: () => tone(700, .04, 'square', .03),
};
function setMute(m) { muted = m; localStorage.setItem(MUTE_KEY, m ? '1' : '0'); $('bMute').textContent = m ? '🔇' : '🔊'; $('bMute2').textContent = m ? '🔇 Sound off' : '🔊 Sound on'; if (!m) SFX.click(); }

// ---------- high scores ----------
function loadScores() { try { const s = JSON.parse(localStorage.getItem(HS_KEY) || '[]'); return Array.isArray(s) ? s : []; } catch (e) { return []; } }
function saveScore(name) {
  const s = loadScores(); const rec = {name: (name || 'Pilot').slice(0, 12), score: G.score, day: (LEVELS[G.level] || {}).short || '', level: G.level + 1, at: new Date().toISOString().slice(0, 10)};
  s.push(rec); s.sort((a, b) => b.score - a.score); const top = s.slice(0, 10); localStorage.setItem(HS_KEY, JSON.stringify(top)); G.lastRank = top.indexOf(rec); return top;
}
function renderScores(el, mark = -1) {
  const s = loadScores(); const esc = (t) => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  el.innerHTML = s.length ? s.map((r, i) => `<tr class="${i === mark ? 'me' : ''}"><td>${i + 1}. ${esc(r.name)}</td><td>${esc(r.day)} · L${r.level}</td><td>${r.score.toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="3" style="color:#94a3b8">No scores yet. Be the first!</td></tr>';
}

// ---------- levels ----------
function levelBlurb(L) {
  const c = L.counts, parts = [];
  if (c.msg) parts.push(`${c.msg} message${c.msg > 1 ? 's' : ''}`); if (c.boyd) parts.push(`${c.boyd} from Boyd`); if (c.routine) parts.push(`${c.routine} routine${c.routine > 1 ? 's' : ''}`); if (c.output) parts.push(`${c.output} output${c.output > 1 ? 's' : ''}`);
  return parts.join(' · ') + (L.topPair ? ` · busiest pair ${short(L.topPair.split(' ↔ ')[0])} ↔ ${short(L.topPair.split(' ↔ ')[1])}` : '');
}
function renderLevelList() {
  $('levelList').innerHTML = LEVELS.map((L, i) => `<li data-i="${i}" class="${i === G.sel ? 'sel' : ''}"><b>Level ${i + 1}</b> · ${L.title}<small>${L.jobs.length} deliveries: ${levelBlurb(L)}</small></li>`).join('');
  for (const li of $('levelList').children) li.onclick = () => { G.sel = +li.dataset.i; SFX.click(); renderLevelList(); };
}
function startGame(lv = G.sel) { G.score = 0; G.delivered = 0; G.misses = 0; G.bestCombo = 0; G.boosts = 0; G.resets = 0; G.wasted = 0; G.finishedAll = false; G.tokens = 0; startLevel(lv); }
function startLevel(lv) {
  audio(); G.level = lv; const L = LEVELS[lv];
  G.queue = L.jobs.map(j => Object.assign({}, j, {state: 'new'})); G.active = []; G.spawnCD = 0.8; G.coins = []; G.coinCD = 1; G.fx = []; G.pops = [];
  G.combo = 0; G.comboT = 0; G.boostT = 0; G.resetT = RESET_EVERY; G.dizzyT = 0; G.levelScore = 0; G.levelDelivered = 0; G.levelMisses = 0; G.elapsed = 0;
  G.drone = {x: BUILDINGS.launchpad.x - 50, y: BUILDINGS.launchpad.y + 30, vx: 0, vy: 0, tilt: 0};
  G.clockTs = L.jobs.length ? Date.parse(L.jobs[0].ts) : Date.now();
  G.bugs = []; for (let i = 0; i < Math.min(6, lv); i++) { const p = islePoint(i * 2.1 + 0.4, 0.55); G.bugs.push({x: p.x, y: p.y, vx: Math.cos(i * 1.7) * (40 + lv * 6), vy: Math.sin(i * 1.7) * (30 + lv * 5), ph: i}); }
  show('play'); toast(`Level ${lv + 1}: ${L.title}`, 2.6);
}
function maxActive() { return [2, 2, 2, 3, 3, 3, 3][G.level] || 3; }
function spawnJob() {
  const j = G.queue.shift(); if (!j) return; const two = j.kind === 'msg' || j.kind === 'boyd';
  const a = bpos(j.fromB), b = two ? bpos(j.toB) : a; const d = G.drone;
  const travel = Math.hypot(a.x - d.x, a.y - d.y) + (two ? Math.hypot(b.x - a.x, b.y - a.y) : 0);
  j.limit = Math.round(travel / SPEED * 1.5 + 12 + G.active.length * 5 - Math.min(5, G.level * 0.8)); j.left = j.limit; j.state = 'pickup'; j.carry = false; j.born = G.elapsed;
  G.active.push(j); G.clockTs = Date.parse(j.ts); SFX.spawn();
}
function targetOf(j) { return j.carry ? bpos(j.toB) : bpos(j.fromB); }
function complete(j) {
  G.combo = Math.min(12, G.combo + 1); G.comboT = 10; G.bestCombo = Math.max(G.bestCombo, G.combo);
  const mult = 1 + 0.25 * (G.combo - 1); const base = KIND[j.kind].base + 25 * (j.count - 1);
  const pts = Math.round((base + Math.ceil(j.left) * 5) * mult * (G.boostT > 0 ? 2 : 1));
  G.score += pts; G.levelScore += pts; G.delivered++; G.levelDelivered++;
  G.active = G.active.filter(x => x !== j); const p = targetOf(j);
  G.pops.push({x: p.x, y: p.y - 40, txt: `+${pts}${G.combo > 1 ? '  ×' + mult.toFixed(2).replace(/\.?0+$/, '') : ''}`, t: 1.4, c: '#fde047'});
  burst(p.x, p.y - 20, BYNAME[j.to || j.from]?.hex || '#fde047', 18); SFX.drop(G.combo);
}
function miss(j) {
  G.misses++; G.levelMisses++; G.combo = 0; G.comboT = 0; G.active = G.active.filter(x => x !== j); SFX.miss();
  toast(`Missed: ${j.kind === 'msg' || j.kind === 'boyd' ? short(j.from) + ' → ' + short(j.to) : short(j.from) + ' · ' + j.label}`, 2);
  if (G.misses >= MAX_MISSES) gameOver(false);
}
function burst(x, y, c, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 60 + Math.random() * 160; G.fx.push({x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, t: 0.8 + Math.random() * .4, c}); } }
function boost() {
  if (G.screen !== 'play' || G.tokens < 100 || G.boostT > 0) return;
  G.tokens = 0; G.boostT = 7; G.boosts++; SFX.boost(); toast('⚡ TOKENMAX MODE! ' + JOKES[G.boosts % JOKES.length], 2.4); burst(G.drone.x, G.drone.y, '#f0abfc', 30);
}

// ---------- update ----------
function inIsland(x, y, k = 0.86) { const a = Math.atan2((y - ISLE.cy) / ISLE.ry, (x - ISLE.cx) / ISLE.rx); const r = Math.hypot((x - ISLE.cx) / ISLE.rx, (y - ISLE.cy) / ISLE.ry); return r < islandRadius(a) * k; }
function update(dt) {
  G.elapsed += dt; const d = G.drone;
  let ix = 0, iy = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) ix -= 1; if (keys.has('ArrowRight') || keys.has('KeyD')) ix += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) iy -= 1; if (keys.has('ArrowDown') || keys.has('KeyS')) iy += 1;
  if (touch.on) { const m = Math.hypot(touch.dx, touch.dy); if (m > 8) { ix = touch.dx / Math.max(m, 50); iy = touch.dy / Math.max(m, 50); } }
  const im = Math.hypot(ix, iy); if (im > 1) { ix /= im; iy /= im; }
  const top = SPEED * (G.boostT > 0 ? 1.6 : 1) * (G.dizzyT > 0 ? 0.4 : 1);
  d.vx += (ix * top - d.vx) * Math.min(1, dt * 7); d.vy += (iy * top - d.vy) * Math.min(1, dt * 7);
  d.x = Math.max(30, Math.min(W - 30, d.x + d.vx * dt)); d.y = Math.max(60, Math.min(H - 20, d.y + d.vy * dt)); d.tilt = d.vx / SPEED * 0.3;
  if (G.boostT > 0) { G.boostT -= dt; if (Math.random() < dt * 40) G.fx.push({x: d.x, y: d.y + 6, vx: -d.vx * .2 + (Math.random() - .5) * 30, vy: -d.vy * .2 + 20, t: .6, c: `hsl(${(G.elapsed * 400) % 360},90%,65%)`}); }
  if (G.dizzyT > 0) G.dizzyT -= dt;
  // combo meter drains
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
  // weekly reset joke
  G.resetT -= dt; if (G.resetT <= 0) { G.resetT = RESET_EVERY; G.resets++; if (G.tokens > 0) { G.wasted += Math.round(G.tokens); toast(`🔄 Weekly reset! ${Math.round(G.tokens)}% of your tokens expired unused 😱`, 2.4); G.tokens = 0; SFX.reset(); } else toast('🔄 Weekly reset! You wasted zero tokens. TokenMax is proud.', 2.2); }
  // spawn jobs
  G.spawnCD -= dt; if (G.spawnCD <= 0 && G.queue.length && G.active.length < maxActive()) { spawnJob(); G.spawnCD = 1.6; }
  // jobs
  for (const j of [...G.active]) {
    j.left -= dt; const p = targetOf(j);
    if (Math.hypot(p.x - d.x, p.y - d.y) < 44) {
      if (!j.carry && (j.kind === 'msg' || j.kind === 'boyd')) { j.carry = true; SFX.pick(); burst(p.x, p.y - 20, '#fff', 8); if (j.fromB === j.toB) { complete(j); } }
      else complete(j);
    }
    if (j.left <= 0 && G.active.includes(j)) { miss(j); if (G.screen !== 'play') return; }
  }
  // coins
  G.coinCD -= dt; if (G.coinCD <= 0 && G.coins.length < 3) { G.coinCD = 3.5; for (let k = 0; k < 20; k++) { const x = 140 + Math.random() * 920, y = 130 + Math.random() * 520; if (inIsland(x, y, 0.8)) { G.coins.push({x, y, ph: Math.random() * 6}); break; } } }
  for (const c of [...G.coins]) if (Math.hypot(c.x - d.x, c.y - d.y) < 32) { G.coins = G.coins.filter(x => x !== c); if (G.boostT <= 0) G.tokens = Math.min(100, G.tokens + 25); SFX.coin(); G.pops.push({x: c.x, y: c.y - 20, txt: G.tokens >= 100 ? 'METER FULL! Space / ⚡' : '+25% tokens', t: 1.1, c: '#f0abfc'}); if (G.tokens >= 100) toast('Token Meter full! Press Space or ⚡ before the weekly reset', 2.2); }
  // bugs
  for (const b of G.bugs) {
    b.x += b.vx * dt; b.y += b.vy * dt; if (!inIsland(b.x, b.y, 0.9)) { b.vx = -b.vx; b.vy = -b.vy; b.x += b.vx * dt * 2; b.y += b.vy * dt * 2; }
    if (G.dizzyT <= 0 && G.boostT <= 0 && Math.hypot(b.x - d.x, b.y - d.y) < 26) { G.dizzyT = 1.3; G.combo = 0; G.comboT = 0; SFX.bug(); toast('🐛 Bug! Combo lost', 1.4); }
    else if (G.boostT > 0 && Math.hypot(b.x - d.x, b.y - d.y) < 26) { burst(b.x, b.y, '#a3e635', 12); const p = islePoint(Math.random() * 6.28, 0.5); b.x = p.x; b.y = p.y; G.score += 50; G.levelScore += 50; G.pops.push({x: d.x, y: d.y - 30, txt: 'Bug squashed +50', t: 1, c: '#a3e635'}); }
  }
  for (const f of G.fx) { f.t -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 220 * dt; } G.fx = G.fx.filter(f => f.t > 0);
  for (const p of G.pops) { p.t -= dt; p.y -= 30 * dt; } G.pops = G.pops.filter(p => p.t > 0);
  if (!G.queue.length && !G.active.length) levelClear();
}

// ---------- screens ----------
function show(s) {
  G.screen = s; for (const id of ['title', 'paused', 'clear', 'over']) $(id).hidden = id !== s;
  $('hud').hidden = s === 'title'; $('touch').hidden = !(s === 'play' && isTouch());
  if (s === 'title') { renderLevelList(); renderScores($('scoresTitle')); }
}
function isTouch() { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; }
function pause(on) {
  if (on && G.screen === 'play') { show('paused'); keys.clear(); touch.on = false; $('pauseInfo').textContent = `Level ${G.level + 1} · ${LEVELS[G.level].title} · score ${G.score.toLocaleString()} · ${G.queue.length + G.active.length} deliveries left`; }
  else if (!on && G.screen === 'paused') { show('play'); SFX.click(); }
}
function levelClear() {
  const bonus = 250 * (G.level + 1) + (G.levelMisses === 0 ? 500 : 0); G.score += bonus; SFX.clear(); S.launchAt = performance.now(); setTimeout(() => { S.launchAt = null; }, 6000);
  const L = LEVELS[G.level], last = G.level >= LEVELS.length - 1;
  $('clearTitle').textContent = `☀️ ${L.title}: delivered!`;
  $('clearStats').innerHTML = `<div class="stat"><span>Deliveries</span><b>${G.levelDelivered}/${L.jobs.length}</b><span>Day bonus${G.levelMisses === 0 ? ' (+500 perfect!)' : ''}</span><b>+${bonus}</b><span>Score so far</span><b>${G.score.toLocaleString()}</b><span>Best combo</span><b>×${(1 + .25 * (Math.max(1, G.bestCombo) - 1)).toFixed(2).replace(/\.?0+$/, '')}</b><span>Real time span</span><b>${hm(Date.parse(L.firstTs))} – ${hm(Date.parse(L.lastTs))}</b></div><p style="font-size:13px;color:#cbd5e1">Every delivery today was a real ${L.title} event from Bot Island's logs.</p>`;
  if (last) { G.finishedAll = true; gameOver(true); return; }
  $('bNext').textContent = `Next: ${LEVELS[G.level + 1].title} ▶`; show('clear');
}
function gameOver(won) {
  SFX[won ? 'clear' : 'over'](); G.lastRank = -1;
  $('overTitle').textContent = won ? '🏆 You delivered every day!' : '📭 Shift over!';
  $('overStats').innerHTML = `<div class="stat"><span>Final score</span><b>${G.score.toLocaleString()}</b><span>Reached</span><b>Level ${G.level + 1} · ${LEVELS[G.level].short}</b><span>Deliveries</span><b>${G.delivered}</b><span>Best combo</span><b>${G.bestCombo} in a row</b><span>TokenMax boosts</span><b>${G.boosts}</b><span>Tokens lost to resets</span><b>${G.wasted}%</b></div>`;
  $('nameEntry').hidden = G.score <= 0; $('nameIn').value = localStorage.getItem('botIslandArcade.lastName') || ''; renderScores($('scoresOver')); show('over');
}
function doSave(n) { n = (n || $('nameIn').value || 'Pilot').trim(); localStorage.setItem('botIslandArcade.lastName', n); saveScore(n); $('nameEntry').hidden = true; renderScores($('scoresOver'), G.lastRank); SFX.coin(); }

let toastT = 0; function toast(t, s = 2) { $('toast').textContent = t; $('toast').style.opacity = 1; toastT = s; }

// ---------- drawing ----------
let view = {s: 1, ox: 0, oy: 0};
function resize() { const dpr = window.devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
function camera() {
  const dpr = window.devicePixelRatio || 1, cw = innerWidth, ch = innerHeight; const fit = Math.min(cw / W, ch / H);
  let s = fit, ox = (cw - W * s) / 2, oy = (ch - H * s) / 2;
  if (fit < 0.62 && G.screen !== 'title') { s = Math.max(fit, Math.min(cw / 480, ch / H)); ox = cw / 2 - G.drone.x * s; oy = ch / 2 - G.drone.y * s; ox = W * s <= cw ? (cw - W * s) / 2 : Math.min(0, Math.max(cw - W * s, ox)); oy = H * s <= ch ? (ch - H * s) / 2 + 30 : Math.min(0, Math.max(ch - H * s, oy)); }
  view = {s: s * dpr, ox: ox * dpr, oy: oy * dpr};
}
function drawBotAt(b, x, y, now, label, wave) {
  const bob = Math.sin(now / 260 + b.phase) * (wave ? 2.5 : 1);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y + 9, 8, 3, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y - bob); ctx.fillStyle = b.hex; botShape(b.shape, 9); ctx.fill(); ctx.strokeStyle = shade(b.hex, 0.6); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, -14); ctx.stroke(); ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(0, -15, 2, 0, 7); ctx.fill();
  ctx.fillStyle = '#0f172a'; rr(-6, -4, 12, 7, 3); ctx.fill(); ctx.fillStyle = '#7dd3fc'; ctx.fillRect(-4, -2.5, 2.5, 3.5); ctx.fillRect(1.5, -2.5, 2.5, 3.5);
  if (wave) { ctx.strokeStyle = b.hex; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(14, -8 + Math.sin(now / 120) * 3); ctx.stroke(); }
  ctx.restore();
  if (label) { ctx.font = '700 11px ui-sans-serif,system-ui,sans-serif'; ctx.textAlign = 'center'; const tw = ctx.measureText(label).width + 10; ctx.fillStyle = 'rgba(15,23,42,.82)'; rr(x - tw / 2, y + 12, tw, 15, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(label, x, y + 23.5); }
}
function drawBoydHouse() {
  const {x, y} = BOYD_PLACE; shadow(x, y + 2, 22, 7); ctx.fillStyle = '#fffbeb'; rr(x - 17, y - 22, 34, 22, 2); ctx.fill();
  ctx.fillStyle = '#4c1d95'; ctx.beginPath(); ctx.moveTo(x - 21, y - 21); ctx.lineTo(x, y - 38); ctx.lineTo(x + 21, y - 21); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#facc15'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('8', x, y - 25); ctx.fillStyle = '#7c2d12'; ctx.fillRect(x - 3, y - 10, 6, 10);
}
function drawDrone(now) {
  const d = G.drone, hov = Math.sin(now / 180) * 3; const carrying = G.active.filter(j => j.carry);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(d.x, d.y + 24, 26, 7, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(d.x, d.y - 8 + hov); ctx.scale(1.35, 1.35); ctx.rotate(d.tilt + (G.dizzyT > 0 ? Math.sin(now / 50) * 0.5 : 0));
  if (G.boostT > 0) { ctx.fillStyle = `hsla(${(now / 3) % 360},90%,70%,.35)`; ctx.beginPath(); ctx.arc(0, 0, 34 + Math.sin(now / 80) * 4, 0, 7); ctx.fill(); }
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-18, -10); ctx.lineTo(18, 10); ctx.moveTo(18, -10); ctx.lineTo(-18, 10); ctx.stroke();
  for (const [rx, ry] of [[-18, -10], [18, -10], [-18, 10], [18, 10]]) { ctx.fillStyle = 'rgba(203,213,225,.55)'; ctx.beginPath(); ctx.ellipse(rx, ry, 11, 3.5 + Math.abs(Math.sin(now / 30 + rx)) * 2, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.arc(rx, ry, 2.2, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#d946ef'; botShape('sparkle', 11); ctx.fill(); ctx.strokeStyle = '#86198f'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#0f172a'; rr(-6, -4, 12, 7, 3); ctx.fill(); ctx.fillStyle = G.dizzyT > 0 ? '#fca5a5' : '#7dd3fc';
  if (G.dizzyT > 0) { ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('x  x', 0, 1.5); } else { ctx.fillRect(-4, -2.5, 2.5, 3.5); ctx.fillRect(1.5, -2.5, 2.5, 3.5); }
  carrying.forEach((j, i) => { const c = BYNAME[j.to]?.hex || '#fff'; ctx.fillStyle = '#fff'; ctx.fillRect(-8 + i * 5, 12 + i * 4, 16, 11); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.strokeRect(-8 + i * 5, 12 + i * 4, 16, 11); ctx.beginPath(); ctx.moveTo(-8 + i * 5, 12 + i * 4); ctx.lineTo(i * 5, 18 + i * 4); ctx.lineTo(8 + i * 5, 12 + i * 4); ctx.stroke(); });
  ctx.restore();
}
function draw(now) {
  camera(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0b1f3a'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
  S.t = G.screen === 'title' ? Date.now() : G.clockTs; const dk = Math.min(0.45, darkness(S.t));
  drawWater(now, dk); ctx.drawImage(staticLayer(dk, now), 0, 0, W, H);
  // targets under everything
  const labels = []; const tgt = new Map(); for (const j of G.screen === 'title' ? [] : G.active) { const k = j.carry ? j.toB : j.fromB; tgt.set(k, (tgt.get(k) || []).concat(j)); }
  for (const [k, js] of tgt) { const p = bpos(k); const urgent = js.some(j => j.left < 6); ctx.strokeStyle = urgent ? '#ef4444' : (js.some(j => j.carry) ? '#fde047' : '#ffffff'); ctx.lineWidth = 4; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 150); ctx.beginPath(); ctx.ellipse(p.x, p.y, 46 + Math.sin(now / 200) * 4, 20, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; labels.push([p, bname(k)]); }
  const items = [];
  for (const [k, b] of Object.entries(BUILDINGS)) items.push({y: b.y, f: () => drawBuilding(k, b, now, dk > 0.3, G.active.some(j => j.fromB === k || j.toB === k))});
  items.sort((a, b) => a.y - b.y); for (const it of items) it.f();
  // bots waiting / receiving
  if (G.screen !== 'title') {
    const slots = {};
    for (const j of G.active) {
      const k = j.carry ? j.toB : j.fromB, n = j.carry ? j.to : j.from, b = BYNAME[n]; const p = bpos(k); const s = (slots[k] = (slots[k] || 0) + 1) - 1;
      const x = p.x - 34 + s * 34, y = p.y + 18 + (s % 2) * 20; const tag = `${KIND[j.kind].icon} ${j.carry ? 'to ' : ''}${short(n)}`;
      if (b) drawBotAt(b, x, y, now, tag, true); else { ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🧑', x, y + 6); ctx.font = '700 11px sans-serif'; const tw = ctx.measureText('💬 Boyd').width + 10; ctx.fillStyle = 'rgba(15,23,42,.82)'; rr(x - tw / 2, y + 12, tw, 15, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText('💬 Boyd', x, y + 23.5); }
    }
    for (const c of G.coins) { const s = Math.abs(Math.cos(now / 300 + c.ph)); ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(c.x, c.y + Math.sin(now / 250 + c.ph) * 3, 11 * s + 1, 11, 0, 0, 7); ctx.fill(); ctx.stroke(); if (s > .4) { ctx.fillStyle = '#a16207'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TK', c.x, c.y + 3 + Math.sin(now / 250 + c.ph) * 3); } }
    for (const b of G.bugs) { ctx.save(); ctx.translate(b.x, b.y); ctx.scale(1.5, 1.5); ctx.rotate(Math.atan2(b.vy, b.vx)); ctx.fillStyle = '#65a30d'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-8 + i * 7, Math.sin(now / 90 + i + b.ph) * 1.5, 5.5, 0, 7); ctx.fill(); } ctx.fillStyle = '#1a2e05'; ctx.beginPath(); ctx.arc(9, 0, 4, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(9, -2.5, 2, 2); ctx.fillRect(9, 1, 2, 2); ctx.restore(); }
    // guide line to most urgent target
    const urgent = [...G.active].sort((a, b) => a.left - b.left)[0];
    if (urgent) { const p = targetOf(urgent); ctx.setLineDash([6, 8]); ctx.lineDashOffset = -now / 40; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(G.drone.x, G.drone.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]); }
    for (const [p, n] of labels) { ctx.font = '800 12px ui-rounded,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15,23,42,.85)'; ctx.strokeText(n, p.x, p.y - 104); ctx.fillStyle = '#fef9c3'; ctx.fillText(n, p.x, p.y - 104); }
    drawDrone(now);
    for (const f of G.fx) { ctx.globalAlpha = Math.min(1, f.t * 1.5); ctx.fillStyle = f.c; ctx.fillRect(f.x - 2, f.y - 2, 4, 4); } ctx.globalAlpha = 1;
    for (const p of G.pops) { ctx.globalAlpha = Math.min(1, p.t * 1.5); ctx.font = '900 18px ui-rounded,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#0f172a'; ctx.strokeText(p.txt, p.x, p.y); ctx.fillStyle = p.c; ctx.fillText(p.txt, p.x, p.y); } ctx.globalAlpha = 1;
  } else {
    // title attract mode: drone circles the island
    const a = now / 2400; G.drone.x = 600 + Math.cos(a) * 330; G.drone.y = 400 + Math.sin(a) * 190; G.drone.tilt = -Math.sin(a) * .2; drawDrone(now);
  }
}
let layer = null, layerKey = '';
function staticLayer(dk, now) {
  const key = Math.round(dk * 20) + ':' + view.s.toFixed(2); if (layer && key === layerKey) return layer;
  if (!terrain) buildTerrain();
  const sc = Math.max(1, Math.min(2.5, view.s)); const c = document.createElement('canvas'); c.width = Math.round(W * sc); c.height = Math.round(H * sc);
  const main = ctx; const g = c.getContext('2d'); g.scale(sc, sc);
  try {
    ctx = g; // reuse Bot Island's drawing functions on the offscreen layer
    g.drawImage(terrain, 0, 0, W, H); if (dk > 0) { g.fillStyle = `rgba(10,20,60,${dk * 0.55})`; g.fillRect(0, 0, W, H); }
    const items = [];
    for (const tr of trees) items.push({y: tr.y, f: () => drawTree(tr, 0)});
    for (const b of S.bots) items.push({y: b.home.y, f: () => drawHouse(Object.assign({state: 'idle'}, b), 0, dk)});
    items.push({y: BOYD_PLACE.y, f: drawBoydHouse});
    items.sort((a, b) => a.y - b.y); for (const it of items) it.f();
  } finally { ctx = main; }
  layer = c; layerKey = key; return layer;
}
let jobsHtml = '';
function hud() {
  const L = LEVELS[G.level]; $('hLevel').textContent = `Level ${G.level + 1} · ${L.short}`; $('hClock').textContent = `🕒 ${hm(G.clockTs)} ET · ${G.queue.length + G.active.length} to go`;
  $('hScore').textContent = G.score.toLocaleString(); $('hMult').textContent = '×' + (1 + 0.25 * Math.max(0, G.combo - 1)).toFixed(2).replace(/\.?0+$/, '') + (G.combo > 1 ? ` (${G.combo} in a row)` : '');
  $('hCombo').style.width = (G.combo ? G.comboT / 10 * 100 : 0) + '%';
  const tp = G.boostT > 0 ? G.boostT / 7 * 100 : G.tokens; $('hTok').style.width = tp + '%'; $('hTokPct').textContent = G.boostT > 0 ? 'BOOST!' : `${Math.round(G.tokens)}% · reset in ${Math.ceil(G.resetT)}s`;
  const tk = $('hTok').closest('.tok'); tk.classList.toggle('ready', G.tokens >= 100 && G.boostT <= 0); tk.classList.toggle('boost', G.boostT > 0); $('bBoost').classList.toggle('ready', G.tokens >= 100 && G.boostT <= 0);
  $('hLives').textContent = '📬'.repeat(Math.max(0, MAX_MISSES - G.misses)) + '📭'.repeat(Math.min(MAX_MISSES, G.misses));
  const h = G.active.map(j => { const two = j.kind === 'msg' || j.kind === 'boyd'; const c = BYNAME[j.carry ? j.to : j.from]?.hex || '#8b5cf6';
    const what = two ? `${short(j.from)} → ${short(j.to)}${j.count > 1 ? ` (×${j.count})` : ''}` : `${short(j.from)}`;
    const sub = two ? (j.carry ? `Drop at ${bname(j.toB)}` : `Pick up at ${bname(j.fromB)}`) : `${j.kind === 'routine' ? 'Routine' : 'Output'}: ${j.label}`;
    return `<div class="job ${j.carry ? 'carry' : ''} ${j.left < 6 ? 'hurry' : ''}" style="--c:${c}"><div class="t"><span>${KIND[j.kind].icon} ${what}</span><em>${hm(Date.parse(j.ts))}</em></div><div class="s">${sub}</div><div class="tm"><i style="width:${Math.max(0, j.left / j.limit * 100)}%"></i></div></div>`; }).join('');
  if (h !== jobsHtml) { $('jobs').innerHTML = h; jobsHtml = h; }
  if (toastT > 0) { toastT -= 1 / 60; if (toastT <= 0) $('toast').style.opacity = 0; }
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now; G.fps = G.fps ? G.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
  if (G.screen === 'play') { const n = Math.ceil(dt / 0.034); for (let i = 0; i < n && G.screen === 'play'; i++) update(dt / n); }
  draw(now); if (G.screen !== 'title') hud();
  requestAnimationFrame(frame);
}

// ---------- input ----------
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') { if (e.key === 'Enter') doSave(); return; }
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.code === 'KeyM') { setMute(!muted); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { if (G.screen === 'play') pause(true); else if (G.screen === 'paused') pause(false); return; }
  if (e.code === 'Enter') { if (G.screen === 'title') startGame(); else if (G.screen === 'clear') startLevel(G.level + 1); else if (G.screen === 'over') { G.sel = 0; startGame(0); } else if (G.screen === 'paused') pause(false); return; }
  if (G.screen === 'title' && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) { G.sel = (G.sel + (e.code === 'ArrowDown' ? 1 : LEVELS.length - 1)) % LEVELS.length; renderLevelList(); SFX.click(); return; }
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') { boost(); return; }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (G.screen === 'play') pause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.screen === 'play') pause(true); });
const stick = $('stick');
cv.addEventListener('pointerdown', (e) => { if (G.screen !== 'play') return; audio(); touch.on = true; touch.id = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY; touch.dx = touch.dy = 0; if (e.pointerType !== 'mouse') { stick.style.display = 'block'; stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px'; } cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (!touch.on || e.pointerId !== touch.id) return; touch.dx = e.clientX - touch.ox; touch.dy = e.clientY - touch.oy; const m = Math.hypot(touch.dx, touch.dy), k = Math.min(1, 45 / Math.max(m, 1)); stick.firstElementChild.style.transform = `translate(${touch.dx * k}px,${touch.dy * k}px)`; });
const endTouch = (e) => { if (e.pointerId !== touch.id) return; touch.on = false; touch.dx = touch.dy = 0; stick.style.display = 'none'; stick.firstElementChild.style.transform = ''; };
cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch);
$('bBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); boost(); });
$('bMute').onclick = () => setMute(!muted); $('bMute2').onclick = () => setMute(!muted);
$('bPause').onclick = () => pause(true); $('bResume').onclick = () => pause(false);
$('bQuit').onclick = () => { SFX.click(); show('title'); };
$('bStart').onclick = () => startGame(); $('bNext').onclick = () => startLevel(G.level + 1);
$('bAgain').onclick = () => startGame(0); $('bTitle').onclick = () => show('title');
$('bSave').onclick = () => doSave(); for (const b of document.querySelectorAll('.who button[data-n]')) b.onclick = () => doSave(b.dataset.n);
addEventListener('resize', resize);
window.addEventListener('error', (e) => errorsSeen.push(String(e.message)));

// ---------- boot ----------
(function boot() {
  const u = DATA.usage; const nBots = DATA.bots.length;
  $('factLine').innerHTML = `${LEVELS.reduce((a, L) => a + L.jobs.length, 0)} deliveries across ${LEVELS.length} real days, starring all ${nBots} bots on Bot Island. Every job is a real logged message, routine run or output from Bot Island's data (who, where and when only: no message contents).` +
    (u ? ` Real-life token meter: Boyd's Grok Bot weekly usage was ${u.used_pct}% used when this was built (checked ${hm(Date.parse(u.checked_at))} ET). TokenMax's whole job is spending the rest before the reset.` : '');
  setMute(muted); resize(); show('title'); requestAnimationFrame(frame);
  const q = new URLSearchParams(location.search); if (q.has('level')) startGame(Math.max(0, Math.min(LEVELS.length - 1, (+q.get('level') || 1) - 1)));
})();

// ---------- test hooks (read-only views + start; the smoke test drives the game with real key events) ----------
window.ARCADE = {
  state: () => ({screen: G.screen, level: G.level, score: G.score, combo: G.combo, misses: G.misses, delivered: G.delivered, tokens: G.tokens, boostT: G.boostT,
    drone: {x: G.drone.x, y: G.drone.y}, active: G.active.map(j => ({id: j.id, kind: j.kind, from: j.from, to: j.to, carry: j.carry, left: j.left, target: targetOf(j)})),
    queue: G.queue.length, muted, fps: Math.round(G.fps || 0), coins: G.coins.map(c => ({x: c.x, y: c.y})), errors: errorsSeen.slice()}),
  levels: () => LEVELS.map(L => ({day: L.day, title: L.title, jobs: L.jobs.map(j => ({id: j.id, ts: j.ts, kind: j.kind, from: j.from, to: j.to, label: j.label, count: j.count, srcTs: j.srcTs}))})),
  bots: () => DATA.bots.map(b => b.name),
  view: () => view,
};
