'use strict';
/* Bot Island Arcade: shared globals + shims the copied Bot Island drawing code expects (S, ctx, BUILDINGS, etParts...). */
const DATA = window.ARCADE_DATA;
const TZ = 'America/New_York';
const W = 1200, H = 760;
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const fmtParts = new Intl.DateTimeFormat('en-US', {timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'});
function etParts(ms) {
  const o = {};
  for (const p of fmtParts.formatToParts(new Date(ms))) o[p.type] = p.value;
  const wd = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6}[o.weekday];
  return {y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd};
}
function hm(ms) { const p = etParts(ms); const h12 = (p.h % 12) || 12; return `${h12}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`; }
const BUILDINGS = {}; for (const [k, b] of Object.entries(DATA.buildings)) if (k !== 'boyd') BUILDINGS[k] = b;
const BOYD_PLACE = DATA.buildings.boyd || {x: 712, y: 352, name: "Boyd's Place"};
const PLAZA = {x: 600, y: 420};
const COLORS = DATA.palette;
const S = {data: {eggs: DATA.eggs || [], tokenFuel: DATA.usage ? {usedPct: DATA.usage.used_pct} : null}, bots: [], game: null, launchAt: null, t: Date.now()};
const cv = document.getElementById('game'); let ctx = cv.getContext('2d');
let terrain = null, trees = [], stars = [];
