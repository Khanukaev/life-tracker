/* Verbatim <script> from the original single-page app (reference only).
 * The only change: the personal PERSONA prompt was removed.
 * Executed by golden/run-legacy.mjs to prove the Python port is 1:1. */
/* ===== Core: dates, energy model, habits, goals. Pure functions. ===== */
const DAY_START = 5 * 60; // логический день: 05:00 → 05:00
const STEP = 5; // минут

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function idxOf(k) { const [y, m, d] = k.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
function keyFromIdx(i) { const d = new Date(i * 864e5); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
function addDays(k, n) { return keyFromIdx(idxOf(k) + n); }
function logicalNow(now) {
  now = now || new Date();
  const shifted = new Date(now.getTime() - DAY_START * 60000);
  const key = keyOf(shifted);
  const min = now.getHours() * 60 + now.getMinutes() + (now.getHours() * 60 + now.getMinutes() < DAY_START ? 1440 : 0);
  return { key, min };
}
function hm(s) { if (s == null || s === "") return null; const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); }
function fmtHM(min) { min = Math.round(min); const x = ((min % 1440) + 1440) % 1440; return pad(Math.floor(x / 60)) + ":" + pad(x % 60); }
function fmtDur(min) {
  min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + " мин"; if (!m) return h + " ч"; return h + " ч " + m + " мин";
}
/* время задачи "HH:MM" → минуты от 00:00 логического дня (00:00–04:59 = после полуночи) */
function taskMin(s) { const m = hm(s); if (m == null) return null; return m < DAY_START ? m + 1440 : m; }
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_S = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function fmtDate(k, opts) {
  const [y, m, d] = k.split("-").map(Number); const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (opts === "short") return d + " " + MON_S[m - 1];
  return wd[0].toUpperCase() + wd.slice(1) + ", " + d + " " + MON[m - 1];
}

/* ---------- sleep nights ---------- */
/* ночь k = сон, после которого проснулся в день k. Время относительно 00:00 дня k. */
function parseNight(sl) {
  if (!sl || !sl.bed || !sl.wake) return null;
  let bed = hm(sl.bed); const wake = hm(sl.wake);
  if (bed >= 12 * 60) bed -= 1440;
  if (wake <= bed) return null;
  return { bed, wake, dur: wake - bed, q: sl.q || "ok", real: true };
}
function plannedNight(st) {
  let bed = hm(st.targets.bed || "01:00"); if (bed >= 12 * 60) bed -= 1440;
  const dur = Math.round((st.targets.sleepNeed || 8) * 60);
  return { bed, wake: bed + dur, dur, q: "ok", real: false, planned: true };
}
function usualNight(k, days, st) {
  const xs = [];
  for (let i = 1; i <= 7; i++) { const n = parseNight(days[addDays(k, -i)]?.sleep); if (n) xs.push(n); }
  if (!xs.length) { const n = parseNight({ bed: st.usual?.bed || "03:00", wake: st.usual?.wake || "12:30" }); return { ...n, real: false }; }
  const bed = xs.reduce((a, n) => a + n.bed, 0) / xs.length, wake = xs.reduce((a, n) => a + n.wake, 0) / xs.length;
  return { bed, wake, dur: wake - bed, q: "ok", real: false };
}
function nightFor(k, ctx) {
  const n = parseNight(ctx.days[k]?.sleep); if (n) return n;
  if (k > ctx.today) return plannedNight(ctx.st);
  if (k === ctx.today) return usualNight(k, ctx.days, ctx.st); // ещё не отметил — берём привычный
  return usualNight(k, ctx.days, ctx.st);
}

/* ---------- three-process model of alertness (Åkerstedt–Folkard, на базе Борбели) ---------- */
const P = { La: 2.4, Ha: 14.3, dRise: 0.0353, dRec: 0.381, M: 2.5, Wc: -5.72, Wd: 1.51, A0: 3, Ar: 11.5 };
const toIdx = (a) => (a - P.A0) / P.Ar * 100;
const unit2pts = 100 / P.Ar;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function bucketOf(hSinceWake) { return hSinceWake < 3 ? 0 : hSinceWake < 7 ? 1 : hSinceWake < 11 ? 2 : 3; }
const FEEL_T = { low: 30, ok: 58, high: 82 };

function energyDay(D, ctx, opt) {
  opt = opt || {};
  const st = ctx.st, base = idxOf(D) * 1440;
  // ночи D-4 … D+1
  const nights = [];
  for (let i = -4; i <= 1; i++) { const k = addDays(D, i); const n = nightFor(k, ctx); nights.push({ k, off: idxOf(k) * 1440, ...n }); }
  const nD = nights[4], nNext = nights[5];
  const wakeD = nD.wake, bedNext = 1440 + nNext.bed; // относительно 00:00 дня D
  // фаза циркадного ритма: взвешенная середина сна за 7 ночей (часы лагают за режимом)
  const W7 = [0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.05];
  let ms = 0, bedH = 0, wakeH = 0, wsum = 0; const mids = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(D, -i); const n = i < 1 ? nD : nightFor(k, ctx);
    ms += W7[i] * (n.bed + n.wake) / 2; bedH += W7[i] * n.bed; wakeH += W7[i] * n.wake; wsum += W7[i];
    if (n.real) mids.push((n.bed + n.wake) / 2);
  }
  ms /= wsum; bedH /= wsum; wakeH /= wsum;
  const acro = ms + 13.8 * 60; // пик циркадной бодрости
  // 24-ч компонента + 12-ч гармоника (послеобеденный спад, вечерняя «зона бодрствования»)
  const C = (m) => P.M * Math.cos(2 * Math.PI * (m - acro) / 1440) + 1.0 * Math.cos(4 * Math.PI * (m - (acro - 510)) / 1440);
  // процесс S
  const sleepAbs = nights.map((n) => [n.off + n.bed, n.off + n.wake]);
  const asleepAt = (t) => sleepAbs.some(([a, b]) => t >= a && t < b);
  let t = base - 4 * 1440 + 12 * 60, S = 10; const end = base + 29 * 60;
  const Sm = new Map();
  while (t <= end) {
    const sl = asleepAt(t); const dt = STEP / 60;
    S = sl ? P.Ha - (P.Ha - S) * Math.exp(-P.dRec * dt) : P.La + (S - P.La) * Math.exp(-P.dRise * dt);
    t += STEP; if (t >= base + DAY_START) Sm.set(t - base, S);
  }
  // штрафы
  const need = (st.targets.sleepNeed || 8) * 60; let debt = 0;
  for (let i = 0; i < 7; i++) { const n = i < 1 ? nD : nightFor(addDays(D, -i), ctx); debt += Math.max(0, need - n.dur) / 60 * Math.pow(0.85, i); }
  const pDebt = Math.min(3, 0.3 * debt);
  const durH = nD.dur / 60; const pOver = durH > 9.5 ? Math.min(1.5, 0.5 * (durH - 9.5)) : 0;
  let pIrr = 0; if (mids.length >= 3) { const mu = mids.reduce((a, b) => a + b, 0) / mids.length; const sd = Math.sqrt(mids.reduce((a, b) => a + (b - mu) ** 2, 0) / mids.length) / 60; pIrr = Math.min(1.5, 0.5 * sd); }
  const goalBed = plannedNight(st).bed; const late = (nD.bed - goalBed) / 60; const pLate = late > 0 ? Math.min(1.5, 0.35 * late) : 0;
  const pQ = nD.q === "bad" ? 1.0 : nD.q === "good" ? -0.4 : 0;
  const pen = pDebt + pOver + pIrr + pLate + pQ;
  const bias = (st.model && st.model.bias) || [0, 0, 0, 0];
  // ощущение сегодня (последняя отметка)
  const feels = (ctx.days[D]?.feel || []).slice(-1);
  const pts = [];
  for (let m = DAY_START; m <= 29 * 60; m += STEP) {
    const asleep = asleepAt(base + m);
    const sinceWake = m >= wakeD ? (m - wakeD) / 60 : null;
    const W = sinceWake != null && !asleep ? P.Wc * Math.exp(-P.Wd * sinceWake) : 0;
    const Sv = Sm.get(m) ?? 8; const Cv = C(m);
    const raw = toIdx(Sv + Cv + W - pen);
    const b = sinceWake != null ? bias[bucketOf(sinceWake)] || 0 : 0;
    let idx = raw + b;
    if (!opt.noFeel && feels.length) { const f = feels[0]; const fm = taskMin(f.t); if (fm != null && m >= fm - 60) idx += (f.err || 0) * 0.7 * Math.exp(-Math.abs(m - fm) / 180); }
    pts.push({ m, asleep, idx: asleep ? null : clamp(Math.round(idx), 3, 100), raw: clamp(raw + b, 0, 100), C: Cv, S: Sv });
  }
  // зоны
  const awake = pts.filter((p) => !p.asleep && p.m >= wakeD && p.m < bedNext);
  let max = -1, min = 101, maxAt = null, minAt = null, sum = 0;
  awake.forEach((p) => { sum += p.idx; if (p.idx > max) { max = p.idx; maxAt = p.m; } if (p.idx < min) { min = p.idx; minAt = p.m; } });
  const avg = awake.length ? Math.round(sum / awake.length) : null;
  const sorted = awake.map((p) => p.idx).sort((a, b) => a - b);
  const q = (f) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 50;
  const qHi = q(0.64), qLo = q(0.22);
  pts.forEach((p) => {
    if (p.asleep || p.idx == null) { p.zone = "sleep"; return; }
    if (p.idx >= qHi && p.idx >= 45) p.zone = "focus";
    else if ((p.idx <= qLo && p.idx <= max - 8) || p.idx < 30) p.zone = "recharge";
    else p.zone = "steady";
  });
  const windows = [];
  pts.forEach((p) => {
    if (p.zone === "sleep") return; const last = windows[windows.length - 1];
    if (last && last.zone === p.zone && last.end === p.m) { last.end = p.m + STEP; last.sum += p.idx; last.n++; }
    else windows.push({ zone: p.zone, start: p.m, end: p.m + STEP, sum: p.idx, n: 1 });
  });
  windows.forEach((w) => (w.avg = Math.round(w.sum / w.n)));
  // тренировка: пик температуры тела ≈ циркадный пик, не позже чем за 2,5 ч до сна
  let train = null; const at = (m) => pts[Math.round((m - DAY_START) / STEP)];
  for (let s = Math.ceil((wakeD + 120) / 15) * 15; s + 90 <= bedNext - 150; s += 15) {
    let sc = 0, n = 0; for (let m = s; m < s + 90; m += STEP) { const p = at(m); if (!p || p.asleep) { sc = -1e9; break; } sc += 0.6 * (p.C + P.M) / (2 * P.M) + 0.4 * p.idx / 100; n++; }
    if (n && (!train || sc / n > train.score)) train = { start: s, end: s + 90, score: sc / n };
  }
  // модельные «гормоны» (оценка)
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const dlmo = bedH - 120, off = wakeH - 30;
  pts.forEach((p) => {
    let mel = 0; for (const k of [0, 1]) mel = Math.max(mel, sig((p.m - (dlmo + 1440 * k)) / 40) * sig((off + 1440 * k - p.m) / 50));
    const car = 0.45 * Math.exp(-(((p.m - (wakeD + 40)) / 50) ** 2));
    const cb = 0.15 + 0.4 * (1 + Math.cos(2 * Math.PI * (p.m - (wakeH + 60)) / 1440)) / 2;
    p.cort = clamp(cb + (p.m >= wakeD - 30 ? car : 0), 0, 1); p.mel = clamp(mel, 0, 1);
    p.mot = p.asleep ? 0.05 : clamp(0.45 * p.cort / 0.95 + 0.55 * (p.idx || 0) / 100, 0, 1);
    p.alert = p.asleep ? 0.02 : (p.idx || 0) / 100;
  });
  const factors = [
    { key: "debt", label: "Долг сна за 7 дней", val: -Math.round(pDebt * unit2pts), note: debt.toFixed(1) + " ч (взвеш.)" },
    { key: "late", label: "Поздний отбой", val: -Math.round(pLate * unit2pts), note: late > 0 ? "на " + fmtDur(late * 60) + " позже цели" : "в норме" },
    { key: "irr", label: "Сбитый режим", val: -Math.round(pIrr * unit2pts), note: mids.length >= 3 ? "разброс середины сна" : "мало данных" },
    { key: "over", label: "Пересып", val: -Math.round(pOver * unit2pts), note: durH > 9.5 ? fmtDur(nD.dur) : "нет" },
    { key: "q", label: "Качество сна", val: -Math.round(pQ * unit2pts), note: nD.q === "bad" ? "плохо" : nD.q === "good" ? "хорошо" : "нормально" },
  ];
  return { D, pts, wake: wakeD, bed: bedNext, night: nD, tonight: nNext, windows, train, avg, max, maxAt, min, minAt, factors, acro, at };
}
function idxAt(e, m) { const p = e.at(Math.round(m / STEP) * STEP); return p ? p.idx : null; }
function zoneAt(e, m) { const p = e.at(Math.round(m / STEP) * STEP); return p ? p.zone : null; }

/* ---------- habits ---------- */
const DEFAULT_SETTINGS = {
  startDate: null,
  targets: { bed: "01:00", waterL: 2.5, glassL: 0.25, proteinG: 140, sleepNeed: 8, studyH: 2 },
  usual: { bed: "03:00", wake: "12:30" },
  spheres: ["Сон", "Учёба", "Бизнес", "Спорт", "Здоровье", "Английский", "Личное"],
  habits: [
    { key: "bedtime", name: "Отбой до {bed}", type: "sleep", sphere: "Сон", sched: { t: "daily" }, active: true },
    { key: "orders", name: "Все заказы отправлены вовремя", type: "check", sphere: "Бизнес", sched: { t: "daily" }, active: true },
    { key: "study", name: "Подготовка к сессии ≥ {studyH} ч", type: "check", sphere: "Учёба", sched: { t: "daily" }, active: true },
    { key: "creatine", name: "Креатин", type: "check", sphere: "Спорт", sched: { t: "daily" }, active: true },
    { key: "water", name: "Вода {waterL} л", type: "water", sphere: "Здоровье", sched: { t: "daily" }, active: true },
    { key: "kbju", name: "КБЖУ + белок {proteinG} г", type: "protein", sphere: "Спорт", sched: { t: "daily" }, active: true },
    { key: "training", name: "Тренировка по плану", type: "check", sphere: "Спорт", sched: { t: "cycle", p: "11010", a: null }, active: true },
    { key: "skin", name: "Уход за кожей", type: "check", sphere: "Здоровье", sched: { t: "daily" }, active: true },
    { key: "expander", name: "Эспандер 5 мин", type: "check", sphere: "Спорт", sched: { t: "every", n: 2 }, active: true },
    { key: "english", name: "Английский", type: "check", sphere: "Английский", sched: { t: "every", n: 2 }, active: true },
  ],
  model: { bias: [0, 0, 0, 0], n: 0 },
};
function withDefaults(s) {
  s = s || {}; const d = DEFAULT_SETTINGS;
  return { ...d, ...s, targets: { ...d.targets, ...(s.targets || {}) }, usual: { ...d.usual, ...(s.usual || {}) }, model: { ...d.model, ...(s.model || {}) }, spheres: s.spheres || d.spheres, habits: s.habits || d.habits };
}
function habitName(h, st) {
  const t = st.targets; return h.name.replace("{bed}", t.bed).replace("{waterL}", String(t.waterL).replace(".", ",")).replace("{proteinG}", t.proteinG).replace("{studyH}", String(t.studyH).replace(".", ","));
}
function glassesNeed(st) { return Math.max(1, Math.ceil(st.targets.waterL / st.targets.glassL - 1e-9)); }
function studyNeed(st) { return Math.max(15, Math.round((st.targets.studyH || 2) * 60)); }
function habitDoneRaw(h, k, ctx) {
  const st = ctx.st, d = ctx.days[k] || {}, v = (d.h || {});
  if (h.type === "sleep") { const n = parseNight(ctx.days[addDays(k, 1)]?.sleep); if (!n) return null; return n.bed <= plannedNight(st).bed; }
  if (h.type === "water") return (v[h.key] || 0) >= glassesNeed(st);
  if (h.type === "protein") return !!(v.kbju && v.proteinOk);
  if (h.key === "study" && v.studyMin != null) return v.studyMin >= studyNeed(st); // минуты важнее галочки
  return !!v[h.key];
}
function habitDue(h, k, ctx) {
  const s = h.sched || { t: "daily" };
  if (s.t === "every") { const n = s.n || 2; for (let i = 1; i < n; i++) { const pk = addDays(k, -i); if (pk < (ctx.st.startDate || pk)) break; if (habitDoneRaw(h, pk, ctx)) return false; } return true; }
  if (s.t === "cycle") { const p = s.p || "1"; const a = s.a || ctx.st.startDate || k; const i = ((idxOf(k) - idxOf(a)) % p.length + p.length) % p.length; return p[i] === "1"; }
  return true;
}
/* done | missed | rest | pending | nodata | future */
function habitStatus(h, k, ctx) {
  if (ctx.st.startDate && k < ctx.st.startDate) return "nodata";
  if (k > ctx.today) return "future";
  const due = habitDue(h, k, ctx); const done = habitDoneRaw(h, k, ctx);
  if (done) return "done";
  if (!due) return "rest";
  if (h.type === "sleep" && done == null && addDays(k, 1) >= ctx.today) return "pending";
  if (k === ctx.today) return "pending";
  return "missed";
}
function activeHabits(st) { return st.habits.filter((h) => h.active !== false); }
function dayOk(keys, k, ctx) {
  let pend = false;
  for (const key of keys) { const h = ctx.st.habits.find((x) => x.key === key); if (!h) continue; const s = habitStatus(h, k, ctx); if (s === "missed" || s === "nodata") return s; if (s === "pending") pend = true; }
  return pend ? "pending" : "ok";
}
function streakOf(keys, ctx, upto) {
  let k = upto || ctx.today, n = 0, first = true;
  for (let i = 0; i < 400; i++) {
    const s = dayOk(keys, k, ctx);
    if (s === "ok") n++; else if (s === "pending" && first) { /* сегодня ещё не закрыт */ } else if (s === "pending") { /* вчерашний отбой ещё не внесён */ } else break;
    first = false; k = addDays(k, -1);
    if (ctx.st.startDate && k < ctx.st.startDate) break;
  }
  return n;
}
function bestStreak(keys, ctx) {
  if (!ctx.st.startDate) return 0; let best = 0, cur = 0;
  for (let k = ctx.st.startDate; k <= ctx.today; k = addDays(k, 1)) { const s = dayOk(keys, k, ctx); if (s === "ok") { cur++; best = Math.max(best, cur); } else if (s !== "pending") cur = 0; }
  return best;
}
function habitRate(h, ctx, n) {
  let done = 0, miss = 0;
  for (let i = 0; i < n; i++) { const k = addDays(ctx.today, -i); const s = habitStatus(h, k, ctx); if (s === "done") done++; else if (s === "missed") miss++; }
  return { done, miss, pct: done + miss ? Math.round(done / (done + miss) * 100) : null };
}
function missRun(h, ctx) { let n = 0, k = ctx.today; for (let i = 0; i < 60; i++) { const s = habitStatus(h, k, ctx); if (s === "missed") n++; else if (s === "rest" || s === "pending") { } else break; k = addDays(k, -1); } return n; }

/* ---------- goals ---------- */
function goalProgress(g, ctx) {
  if (g.kind === "streak") { const cur = streakOf(g.habits || [], ctx); const t = g.target || 1; return { pct: Math.min(100, Math.round(cur / t * 100)), label: cur + "/" + t + " дн. подряд", cur, t }; }
  if (g.kind === "count") {
    const w = g.window || 7, t = g.target || w; let c = 0;
    for (let i = 0; i < w; i++) if (dayOk(g.habits || [], addDays(ctx.today, -i), ctx) === "ok") c++;
    return { pct: Math.min(100, Math.round(c / t * 100)), label: c + " из " + t + " за " + w + " дн.", cur: c, t };
  }
  const sub = g.subtasks || []; const d = sub.filter((s) => s.done).length;
  if (g.kind === "manual") return { pct: g.value || 0, label: (g.value || 0) + "%" };
  return { pct: sub.length ? Math.round(d / sub.length * 100) : 0, label: d + "/" + sub.length + " шагов", cur: d, t: sub.length };
}
function goalOverdue(g, ctx) { return !!(g.deadline && g.deadline < ctx.today && goalProgress(g, ctx).pct < 100); }

if (typeof module !== "undefined") module.exports = { keyOf, idxOf, addDays, logicalNow, hm, fmtHM, fmtDur, taskMin, fmtDate, parseNight, nightFor, energyDay, idxAt, zoneAt, DEFAULT_SETTINGS, withDefaults, habitName, habitStatus, habitDue, streakOf, bestStreak, habitRate, missRun, goalProgress, goalOverdue, FEEL_T, bucketOf, glassesNeed, activeHabits, dayOk, DAY_START };

/* ===== state, db, helpers ===== */
const S = {
  db: null, user: null, sample: null, loading: true, stale: false, offline: false,
  st: withDefaults(null), stExists: false, days: {}, tasks: {}, goals: {}, reviews: [],
  view: "day", dayKey: logicalNow().key, taskTab: "today", statsN: 7, scrolled: false,
};
const VIEWS = ["day", "now", "tasks", "goals", "stats", "settings"];
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const nowISO = () => new Date().toISOString();
function ctx() { const f = firstKey(); const sd = S.st.startDate && S.st.startDate < f ? S.st.startDate : f; return { days: S.days, st: { ...S.st, startDate: sd }, today: logicalNow().key }; }
function firstKey() { const ks = Object.keys(S.days).sort(); const t = logicalNow().key; return ks[0] && ks[0] < t ? ks[0] : t; }
const ZN = { focus: "Focus", steady: "Steady", recharge: "Recharge", sleep: "Сон" };
const ZHINT = { focus: "сложная учёба, экзамены, Авито", steady: "рутина, ДЗ, отправка заказов", recharge: "отдых, восстановление" };

/* energy cache */
let EC = new Map();
function energy(k) { if (!EC.has(k)) EC.set(k, energyDay(k, ctx())); return EC.get(k); }
function dirty() { EC = new Map(); }

/* toast */
let toastT;
function toast(msg) { let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

/* write queue: one write at a time per document */
const QW = {};
function qwrite(path, fn) {
  if (!S.db) return Promise.resolve();
  QW[path] = (QW[path] || Promise.resolve()).then(fn).catch((e) => {
    if (e && e.code === "quota_exceeded") toast("База заполнена: удали старые задачи");
    else if (e && e.code === "unavailable") toast("Нет связи с базой, повтори позже");
    else toast("Не сохранилось: " + (e && (e.code || e.message) || "ошибка"));
  });
  return QW[path];
}
function saveDay(k, mut) {
  const d = clone(S.days[k]) || {}; d.h = d.h || {}; mut(d);
  if (k < logicalNow().key) d.backfill = true;
  d.updatedAt = nowISO(); S.days[k] = d; dirty(); renderView();
  return qwrite("days/" + k, () => S.db.doc("days/" + k).set(d));
}
function saveTask(t, quiet) {
  t.updatedAt = nowISO(); S.tasks[t.id] = t; dirty(); if (!quiet) renderView();
  return qwrite("tasks/" + t.id, () => S.db.doc("tasks/" + t.id).set(t));
}
function deleteTask(id) { delete S.tasks[id]; renderView(); return qwrite("tasks/" + id, () => S.db.doc("tasks/" + id).delete()); }
function saveGoal(g, what, by) {
  g.history = g.history || []; if (what) g.history.unshift({ at: nowISO(), by: by || "me", what });
  g.history = g.history.slice(0, 60); g.updatedAt = nowISO(); S.goals[g.id] = g; renderView();
  return qwrite("goals/" + g.id, () => S.db.doc("goals/" + g.id).set(g));
}
function deleteGoal(id) { delete S.goals[id]; renderView(); return qwrite("goals/" + id, () => S.db.doc("goals/" + id).delete()); }
function saveSettings(mut) {
  const s = clone(S.st); mut(s); s.updatedAt = nowISO(); S.st = withDefaults(s); S.stExists = true; dirty(); renderView();
  return qwrite("settings/main", () => S.db.doc("settings/main").set(s));
}
function saveReview(r) { if (!S.db) return; const id = r.id || uid(); S.reviews = [{ id, ...r }, ...S.reviews]; return qwrite("reviews/" + id, () => S.db.doc("reviews/" + id).set(r)); }

/* ---------- db boot ---------- */
async function boot() {
  render();
  const loadT = setTimeout(() => { if (S.loading) { S.loading = false; S.stale = true; renderView(); } }, 10000);
  let db = null, user = null;
  try { [db, user] = await Promise.all([claude.use("db"), claude.use("user")]); } catch (e) { db = null; }
  S.user = user;
  if (!db) { clearTimeout(loadT); S.loading = false; S.offline = true; renderView(); return; }
  S.db = db;
  const fresh = new Set();
  const done = (name, snap) => { if (!snap.metadata.fromCache) fresh.add(name); if (fresh.size >= 3) { S.loading = false; S.stale = false; clearTimeout(loadT); } dirty(); renderView(); };
  const fail = (e) => { S.loading = false; clearTimeout(loadT); if (e && e.code !== "revoked") S.stale = true; renderView(); };
  db.doc("settings/main").onSnapshot((s) => { S.stExists = s.exists; S.st = withDefaults(s.data()); done("settings", s); }, fail);
  db.collection("days").onSnapshot((q) => { const o = {}; q.docs.forEach((d) => (o[d.id] = d.data())); S.days = o; done("days", q); }, fail);
  db.collection("tasks").onSnapshot((q) => { const o = {}; q.docs.forEach((d) => (o[d.id] = { ...d.data(), id: d.id })); S.tasks = o; done("tasks", q); }, fail);
  db.collection("goals").onSnapshot((q) => { const o = {}; q.docs.forEach((d) => (o[d.id] = { ...d.data(), id: d.id })); S.goals = o; done("goals", q); }, fail);
  db.collection("reviews").orderBy("at", "desc").limit(30).onSnapshot((q) => { S.reviews = q.docs.map((d) => ({ ...d.data(), id: d.id })); done("reviews", q); }, () => {});
  claude.use("sample").then((s) => { S.sample = s; renderView(); }).catch(() => {});
}

/* ---------- task helpers ---------- */
const allTasks = () => Object.values(S.tasks);
function tasksOn(k) { return allTasks().filter((t) => t.date === k); }
function taskEnd(t) { const s = taskMin(t.start); return s == null ? null : s + (t.dur || 30); }
function isOverdue(t, c) {
  c = c || ctx(); if (t.done || !t.date) return false; if (t.date < c.today) return true;
  if (t.date === c.today && t.start) { const n = logicalNow().min; return taskEnd(t) < n; }
  return false;
}
function busyOn(k, excludeId) { return tasksOn(k).filter((t) => t.start && t.id !== excludeId).map((t) => [taskMin(t.start), taskEnd(t)]).sort((a, b) => a[0] - b[0]); }
function suggestSlot(k, dur, en, excludeId) {
  const e = energy(k), c = ctx(); dur = dur || 30;
  let from = Math.ceil((e.wake + 15) / 15) * 15;
  if (k === c.today) from = Math.max(from, Math.ceil((logicalNow().min + 10) / 15) * 15);
  const to = e.bed - 15; const busy = busyOn(k, excludeId); let best = null;
  for (let s = from; s + dur <= to; s += 15) {
    if (busy.some(([a, b]) => s < b && s + dur > a)) continue;
    let match = 0, n = 0, sum = 0;
    for (let m = s; m < s + dur; m += 5) { const p = e.at(m); if (!p || p.zone === "sleep") { n = -1; break; } n++; sum += p.idx; if (p.zone === en) match++; }
    if (n <= 0) continue; const fit = match / n, avg = sum / n;
    let score = fit * 2 + (en === "focus" ? avg / 100 : en === "recharge" ? (100 - avg) / 200 : 0) - (s - from) / 1440 * 0.6;
    if (!best || score > best.score) best = { start: s, end: s + dur, fit, avg: Math.round(avg), score, zone: zoneAt(e, s) };
  }
  return best;
}
function relDay(k) { const t = logicalNow().key; if (k === t) return "Сегодня"; if (k === addDays(t, 1)) return "Завтра"; if (k === addDays(t, -1)) return "Вчера"; return fmtDate(k, "short"); }

/* ---------- icons ---------- */
const I = {
  day: '<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
  now: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  tasks: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  stats: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
};
const ic = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + "</svg>";

/* tiny markdown */
function md(s) {
  const lines = esc(s).split("\n"); let out = "", ul = false;
  const inl = (x) => x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const l of lines) {
    const m = l.match(/^\s*[-•*]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (m) { if (!ul) { out += "<ul>"; ul = true; } out += "<li>" + inl(m[1]) + "</li>"; continue; }
    if (ul) { out += "</ul>"; ul = false; }
    if (l.trim()) out += "<p>" + inl(l.replace(/^#+\s*/, "")) + "</p>";
  }
  if (ul) out += "</ul>"; return out;
}

/* ===== views ===== */
const QN = { bad: "Плохо", ok: "Нормально", good: "Хорошо" };
function render() {
  /* своё корневое место: body не трогаем, иначе стираются стили страницы */
  let root = document.getElementById("appRoot");
  if (!root) { root = document.createElement("div"); root.id = "appRoot"; document.body.appendChild(root); }
  root.innerHTML = `<main class="app" id="view"></main>
  <nav class="nav" aria-label="Разделы">
    <button data-a="nav" data-v="day">${ic("day")}<span>День</span></button>
    <button data-a="nav" data-v="now">${ic("now")}<span>Сейчас</span></button>
    <button class="fab" data-a="add" aria-label="Добавить задачу">${ic("plus")}</button>
    <button data-a="nav" data-v="tasks">${ic("tasks")}<span>Задачи</span></button>
    <button data-a="nav" data-v="goals">${ic("goals")}<span>Цели</span></button>
  </nav><div id="sheetRoot"></div>`;
  renderView();
}
function renderView() {
  const el = $("#view"); if (!el) return;
  const fn = { day: vDay, now: vNow, tasks: vTasks, goals: vGoals, stats: vStats, settings: vSettings }[S.view] || vDay;
  try { el.innerHTML = banner() + fn(); } catch (e) { el.innerHTML = '<div class="alert">Ошибка отрисовки: ' + esc(e.message) + "</div>"; console.error(e); }
  document.querySelectorAll(".nav [data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === S.view));
  if (S.view === "day" && !S.scrolled && !S.loading) { S.scrolled = true; requestAnimationFrame(scrollToNow); }
}
function banner() {
  if (S.offline) return '<div class="banner">Нет доступа к базе в этом окне. Открой страницу на claude.ai под своим аккаунтом, иначе отметки не сохранятся.</div>';
  if (S.stale) return '<div class="banner">Не могу достучаться до базы. Данные на экране могут быть неактуальны.</div>';
  if (S.loading) return '<div class="banner">Загружаю данные…</div>';
  return "";
}
function scrollToNow() { const el = $(".tl-now") || $(".tl-task") || $(".tl"); if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 220) }); }
function headBtns() { return `<button class="iconbtn" data-a="claude" aria-label="Разбор от Claude">${ic("spark")}</button><button class="iconbtn" data-a="nav" data-v="stats" aria-label="Итоги">${ic("stats")}</button><button class="iconbtn" data-a="nav" data-v="settings" aria-label="Настройки">${ic("settings")}</button>`; }
function head(title, sub) { return `<header class="top"><div class="grow"><div class="eyebrow">${sub || fmtDate(logicalNow().key)}</div><h1>${title}</h1></div>${headBtns()}</header>`; }
function zonePill(idx, zone, small) { return `<span class="epill z-${zone}"><span class="zdot ${zone}"></span><b>${idx == null ? "—" : idx}</b><small>${small || ZN[zone] || ""}</small></span>`; }

/* ---------- рейтинг выкладывания ---------- */
/* Взвешенная доля сделанного за день. База (сон, учёба, заказы) весит 3, задачи 2, остальное 1.
   Сон дня = ночь, после которой проснулся в этот день: полный балл при отбое до цели, ноль при отбое на 2 ч позже. */
const SCORE_W = { sleep: 3, study: 3, orders: 3, tasks: 2 };
function dayScore(k, c) {
  c = c || ctx(); if (k > c.today || (c.st.startDate && k < c.st.startDate)) return null;
  const d = S.days[k] || {}, v = d.h || {}, t = c.st.targets, items = [];
  const n = parseNight(d.sleep); let goal = hm(t.bed); if (goal >= 720) goal -= 1440;
  items.push({ key: "sleep", label: "Отбой до " + t.bed, w: SCORE_W.sleep, v: n ? clamp(1 - Math.max(0, n.bed - goal) / 120, 0, 1) : 0, note: n ? "лёг в " + fmtHM(n.bed) : "сон не отмечен" });
  for (const h of activeHabits(c.st)) {
    if (h.type === "sleep") continue;
    const s = habitStatus(h, k, c); if (s === "rest") continue;
    let val = s === "done" ? 1 : 0, note = "";
    if (h.type === "water") { const need = glassesNeed(c.st), g = v[h.key] || 0; val = Math.min(1, g / need); note = g + "/" + need + " стак."; }
    else if (h.type === "protein") val = (v.kbju ? 0.5 : 0) + (v.proteinOk ? 0.5 : 0);
    else if (h.key === "study" && v.studyMin != null) { val = Math.min(1, v.studyMin / studyNeed(c.st)); note = v.studyMin + " мин"; }
    items.push({ key: h.key, label: habitName(h, c.st), w: SCORE_W[h.key] || 1, v: val, note });
  }
  const ts = tasksOn(k);
  if (ts.length) { const dn = ts.filter((x) => x.done).length; items.push({ key: "tasks", label: "Задачи дня", w: SCORE_W.tasks, v: dn / ts.length, note: dn + "/" + ts.length }); }
  const W = items.reduce((a, x) => a + x.w, 0), got = items.reduce((a, x) => a + x.w * x.v, 0);
  return { pct: W ? Math.round(got / W * 100) : 0, items, W };
}
const SHORT = { sleep: "Отбой", orders: "Заказы", study: "Учёба", creatine: "Креатин", water: "Вода", kbju: "КБЖУ", training: "Тренировка", skin: "Кожа", expander: "Эспандер", english: "Английский", tasks: "Задачи" };
const PHR = {
  low: ["Пустой день не нейтральный. Он идёт в минус.", "Ты не устал. Ты ещё не начал.", "Один закрытый пункт лучше десяти запланированных. Возьми самый лёгкий и сделай сейчас.", "Никто не придёт и не сделает это за тебя.", "День ещё можно вытащить. Не обнуляй его."],
  mid: ["Половина — это не результат, это разгон.", "Хороший день собирается из скучных пунктов. Добей их.", "Ты уже в движении. Не тормози на полпути.", "Вода и кожа — пара минут, а рейтинг растёт.", "Вчерашний ты сделал меньше. Обгони его ещё на пару пунктов."],
  high: ["Вот так выглядит человек, который закрывает сессию без пересдач.", "Серия ломается в тот день, когда расслабился. Держи.", "Сегодня ты сильнее вчерашнего себя. Повтори завтра.", "База строится не рывком, а каждым таким днём."],
  sleep: ["Сессия сдаётся вечером в 00:30, когда кладёшь телефон.", "Завтрашний подъём решается сегодня до {bed}.", "Лёг поздно — весь день платишь энергией. Сегодня отбой до {bed}."],
  study: ["Сессия не спрашивает, хотелось ли тебе. 30 минут сейчас лучше, чем ноль.", "Долги сами не закроются. Открой конспект на 15 минут, дальше пойдёт."],
};
function pickPhrase(sc, delta, c) {
  const t = c.st.targets, k = c.today, nm = logicalNow().min;
  const pool = (sc.pct < 40 ? PHR.low : sc.pct < 70 ? PHR.mid : PHR.high).slice();
  const n = parseNight(S.days[k]?.sleep); let goal = hm(t.bed); if (goal >= 720) goal -= 1440;
  if (n && n.bed - goal >= 60) pool.push(...PHR.sleep);
  const st = sc.items.find((x) => x.key === "study"); if (st && st.v < 1 && nm >= 16 * 60) pool.push(...PHR.study);
  if (delta != null && delta > 0) pool.push("+" + delta + " к вчера. Так и выглядит прогресс: понемногу, но каждый день.");
  const i = ((idxOf(k) * 7 + (S.phr || 0)) % pool.length + pool.length) % pool.length;
  return pool[i].replace(/\{bed\}/g, t.bed);
}
function scoreCard(k, c) {
  if (k > c.today) return "";
  const sc = dayScore(k, c); if (!sc) return "";
  const prev = dayScore(addDays(k, -1), c); const delta = prev ? sc.pct - prev.pct : null;
  const week = []; for (let i = 6; i >= 0; i--) { const kk = addDays(k, -i); week.push({ k: kk, s: i === 0 ? sc : dayScore(kk, c) }); }
  const ws = week.filter((x) => x.s); const avg = ws.length > 1 ? Math.round(ws.reduce((a, x) => a + x.s.pct, 0) / ws.length) : null;
  const bars = week.map((x) => `<div><i class="${x.k === k ? "cur" : ""}" style="height:${x.s ? Math.max(3, Math.round(x.s.pct * 0.5)) : 2}px${x.s ? "" : ";opacity:.4"}" title="${x.s ? x.s.pct + "%" : "нет данных"}"></i><span>${WD[new Date(idxOf(x.k) * 864e5).getUTCDay()]}</span></div>`).join("");
  const isT = k === c.today;
  let gains = "";
  if (isT) {
    const g = sc.items.filter((x) => x.key !== "sleep" && x.v < 1).map((x) => ({ x, g: Math.round(x.w * (1 - x.v) / sc.W * 100) })).filter((o) => o.g >= 1).sort((a, b) => b.g - a.g).slice(0, 4);
    if (g.length) gains = `<div class="gains"><span class="xs dim">Ещё можно взять:</span>${g.map((o) => `<span class="gain">${esc(SHORT[o.x.key] || o.x.label)} <b class="num">+${o.g}</b></span>`).join("")}</div>`;
  }
  const bedGain = Math.round(SCORE_W.sleep / sc.W * 100);
  const dl = delta == null ? "первый день в трекере" : `<span class="${delta > 0 ? "okc" : ""}">${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)}</span> к вчера`;
  const rows = sc.items.map((x) => `<div class="srow"><span class="grow">${esc(x.label)}${x.note ? `<span class="dim"> · ${esc(x.note)}</span>` : ""}</span><b class="num ${x.v >= 1 ? "okc" : x.v > 0 ? "" : "dim"}">${Math.round(x.w * x.v / sc.W * 100)}<span class="dim">/${Math.round(x.w / sc.W * 100)}</span></b></div>`).join("");
  return `<section class="card score" aria-label="Рейтинг выкладывания">
    <div class="score-top"><div class="grow" style="min-width:0"><div class="eyebrow">${isT ? "Сегодня выкладываешься на" : "В этот день выложился на"}</div><div class="score-num num">${sc.pct}<small>%</small></div><div class="xs muted">${dl}${avg != null ? ` · за 7 дней ${avg}%` : ""}</div></div>
      <div class="spark7" aria-hidden="true">${bars}</div></div>
    ${isT ? `<button class="quote" data-a="phr" aria-label="Другая фраза">${esc(pickPhrase(sc, delta, c))}</button>` : ""}
    ${gains}
    ${isT ? `<div class="xs muted">Отбой до ${esc(c.st.targets.bed)} сегодня даст до <b class="num okc">+${bedGain}</b> к завтрашнему рейтингу.</div>` : ""}
    <details class="score-d"><summary class="xs dim">Из чего складывается</summary><div>${rows}</div><div class="xs dim" style="margin-top:6px">Сон, учёба и заказы весят втрое больше остального, задачи дня — вдвое. Вода, учёба по минутам и КБЖУ засчитываются частично. Дни отдыха по графику не считаются.</div></details>
  </section>`;
}

/* ---------- ДЕНЬ ---------- */
function vDay() {
  const c = ctx(), k = S.dayKey, e = energy(k), isT = k === c.today, nm = logicalNow().min;
  const p = isT ? e.at(Math.floor(nm / 5) * 5) : null;
  const pill = isT ? (p && p.zone !== "sleep" ? zonePill(p.idx, p.zone) : zonePill(null, "sleep", "сон")) : zonePill(e.avg, "steady", "ср.");
  const eb = isT ? "Сегодня" : k < c.today ? (k === addDays(c.today, -1) ? "Вчера · задним числом" : "Задним числом") : relDay(k) === "Завтра" ? "Завтра" : "План";
  let h = `<header class="top">
    <button class="iconbtn" data-a="dprev" aria-label="Предыдущий день">${ic("left")}</button>
    <div class="grow"><div class="eyebrow">${eb}${!isT ? ` · <button class="dim small" data-a="dtoday" style="text-decoration:underline">к сегодня</button>` : ""}</div><h1>${fmtDate(k)}</h1></div>
    <button class="iconbtn" data-a="dnext" aria-label="Следующий день">${ic("right")}</button>
  </header>
  <div class="row" style="justify-content:space-between">${pill}<div class="row" style="gap:6px">${headBtns()}</div></div>`;
  h += scoreCard(k, c) + sleepCard(k, c) + habitsCard(k, c) + untimedCard(k) + timeline(k, e, isT, nm);
  h += `<button class="btn block" data-a="claude" data-m="day">${ic("spark")} Разбор дня от Claude</button>`;
  return h;
}
function sleepCard(k, c) {
  const n = parseNight(S.days[k]?.sleep);
  if (n) return `<button class="card tight" data-a="sleep" style="width:100%;text-align:left"><div class="row"><span class="dim">${ic("moon")}</span><div class="grow"><b class="num">${fmtHM(n.bed)} → ${fmtHM(n.wake)}</b> <span class="muted small">· ${fmtDur(n.dur)} · ${QN[n.q] || ""}</span></div><span class="dim small">Изменить</span></div></button>`;
  if (k > c.today) return `<div class="card tight"><div class="small muted">Сон по плану: отбой ${esc(c.st.targets.bed)}, ${c.st.targets.sleepNeed} ч. Отметишь утром.</div></div>`;
  return `<div class="card"><div class="card-h"><div class="grow"><h2>Как спал?</h2><div class="small muted">Во сколько лёг и встал. От этого считается энергия на день.</div></div><button class="btn primary sm" data-a="sleep">Отметить</button></div></div>`;
}
function habitsCard(k, c) {
  if (k > c.today) return "";
  const hs = activeHabits(c.st); let rows = "", done = 0, total = 0; const rest = [];
  for (const h of hs) {
    const s = habitStatus(h, k, c);
    if (s === "rest") { rest.push(h); continue; }
    total++; if (s === "done") done++;
    rows += habitRow(h, s, k, c);
  }
  const pct = total ? Math.round(done / total * 100) : 0;
  return `<section class="card"><div class="card-h"><h2 class="grow">Отметка дня</h2><span class="num ${pct === 100 ? "okc" : ""}">${done}/${total}</span></div>
    <div class="bar ${pct === 100 ? "ok" : ""}"><i style="width:${pct}%"></i></div>
    <div>${rows}</div>${rest.length ? `<div class="rest-hab"><span class="xs dim">По графику сегодня отдых. Сделал всё равно — отметь:</span><div class="row wrap" style="gap:6px">${rest.map((h) => `<button class="chip" data-a="hab" data-k="${h.key}">${ic("plus")}${esc(habitName(h, c.st))}</button>`).join("")}</div></div>` : ""}</section>`;
}
function habitRow(h, s, k, c) {
  const name = esc(habitName(h, c.st)); const v = (S.days[k] && S.days[k].h) || {};
  const tcls = s === "done" ? "done" : s === "missed" ? "missed" : "";
  const tick = `<span class="tick ${tcls}">${ic(s === "missed" ? "x" : "check")}</span>`;
  const sk = streakOf([h.key], c); const skT = sk > 1 ? `<span class="xs dim num">серия ${sk}</span>` : "";
  const sch = h.sched && h.sched.t === "every" ? "через день" : h.sched && h.sched.t === "cycle" ? "по циклу тренировок" : "";
  if (h.type === "sleep") {
    const n = parseNight(S.days[addDays(k, 1)]?.sleep);
    const note = n ? "лёг в " + fmtHM(n.bed) : k === c.today ? "заполнится утром из данных сна" : "отметь сон за следующее утро";
    return `<div class="hab">${tick}<div class="name">${name}<small>${note}</small></div>${skT}</div>`;
  }
  if (h.type === "water") {
    const need = glassesNeed(c.st), g = v[h.key] || 0; let gl = ""; for (let i = 0; i < need; i++) gl += `<i class="${i < g ? "on" : ""}"></i>`;
    return `<div class="hab">${tick}<div class="name">${name}<small><span class="num">${g}/${need}</span> стаканов по ${String(c.st.targets.glassL).replace(".", ",")} л</small><div class="glasses" style="margin-top:4px">${gl}</div></div><div class="mini"><button data-a="water" data-k="${h.key}" data-d="-1" aria-label="Минус стакан">−</button><button data-a="water" data-k="${h.key}" data-d="1" aria-label="Плюс стакан">+</button></div></div>`;
  }
  if (h.type === "protein") {
    return `<div class="hab">${tick}<div class="name">${name}<small>${v.proteinG ? v.proteinG + " г белка" : "отметь оба пункта"}</small></div><button class="tog ${v.kbju ? "on" : ""}" data-a="kbju">КБЖУ</button><button class="tog ${v.proteinOk ? "on" : ""}" data-a="prot">Белок</button></div>`;
  }
  if (h.key === "study") {
    const need = studyNeed(c.st), m = v.studyMin;
    const note = m != null ? `<span class="num">${m}/${need}</span> мин` : v.study ? "отмечено галочкой · впиши минуты" : `<span class="num">0/${need}</span> мин`;
    const pct = m != null ? Math.min(100, Math.round(m / need * 100)) : v.study ? 100 : 0;
    return `<div class="hab">${tick}<div class="name">${name}<small>${note}</small><div class="bar" style="margin-top:6px;height:4px"><i style="width:${pct}%"></i></div></div>${skT}<div class="mini t"><button data-a="study" data-d="-15" aria-label="Минус 15 минут">−15</button><button data-a="study" data-d="15" aria-label="Плюс 15 минут">+15</button><button data-a="study" data-d="60" aria-label="Плюс час">+1ч</button></div></div>`;
  }
  return `<button class="hab" data-a="hab" data-k="${h.key}">${tick}<div class="name">${name}${sch ? `<small>${sch}</small>` : ""}</div>${skT}</button>`;
}
function untimedCard(k) {
  const un = tasksOn(k).filter((t) => !t.start).sort((a, b) => (a.done - b.done));
  if (!un.length) return "";
  return `<section class="card"><div class="card-h"><h2 class="grow">Без времени</h2><span class="dim small">${un.filter((t) => !t.done).length}</span></div><div>${un.map((t) => taskItem(t, true)).join("")}</div></section>`;
}
function taskItem(t, slotBtn) {
  const c = ctx(); const od = isOverdue(t, c);
  const meta = [];
  if (t.date) meta.push(`<span class="${od ? "bad" : ""}">${relDay(t.date)}${t.start ? " · " + esc(t.start) : ""}</span>`); else meta.push("Входящие");
  if (t.dur) meta.push(fmtDur(t.dur));
  if (t.energy) meta.push(`<span class="row" style="gap:4px"><span class="zdot ${t.energy}"></span>${ZN[t.energy]}</span>`);
  if (t.sphere) meta.push(esc(t.sphere));
  if (t.by === "claude") meta.push('<span class="tag">от Claude</span>');
  return `<div class="item ${t.done ? "done" : ""}"><button data-a="ttoggle" data-id="${t.id}" aria-label="Выполнено"><span class="tick round ${t.done ? "done" : od ? "missed" : ""}">${ic("check")}</span></button>
    <button class="body" data-a="topen" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="meta">${meta.join("<span>·</span>")}</div></button>
    ${slotBtn && !t.done ? `<button class="btn sm" data-a="slot" data-id="${t.id}">В слот</button>` : ""}</div>`;
}
function timeline(k, e, isT, nm) {
  const H = 60, Y = (m) => (m - DAY_START) * H / 60;
  let hours = "", lines = "";
  for (let i = 0; i < 24; i++) { hours += `<div>${pad((5 + i) % 24)}:00</div>`; lines += '<div class="hl"></div>'; }
  // energy column
  const vals = e.pts.filter((p) => p.idx != null).map((p) => p.idx); const lo = Math.max(0, Math.min(...vals, 100) - 6), hi = Math.min(100, Math.max(...vals, 0) + 2);
  const X = (v) => 4 + (v - lo) / Math.max(10, hi - lo) * 38; let svg = "";
  const runs = []; e.pts.forEach((p) => { const l = runs[runs.length - 1]; if (l && l.z === p.zone) l.p.push(p); else { if (l) l.p.push(p); runs.push({ z: p.zone, p: [p] }); } });
  const col = { focus: "var(--focus)", steady: "var(--steady)", recharge: "var(--recharge)" };
  runs.forEach((r) => {
    if (r.z === "sleep") { svg += `<line x1="4" x2="4" y1="${Y(r.p[0].m)}" y2="${Y(r.p[r.p.length - 1].m)}" stroke="#3f3f46" stroke-dasharray="3 4"/>`; return; }
    const ps = r.p.filter((p) => p.idx != null); if (ps.length < 2) return;
    const d = ps.map((p, i) => (i ? "L" : "M") + X(p.idx).toFixed(1) + " " + Y(p.m)).join("");
    svg += `<path d="${d} L4 ${Y(ps[ps.length - 1].m)} L4 ${Y(ps[0].m)}Z" fill="${col[r.z]}" opacity=".16"/><path d="${d}" fill="none" stroke="${col[r.z]}" stroke-width="2" stroke-linejoin="round"/>`;
  });
  e.windows.filter((w) => w.end - w.start >= 55).forEach((w) => { const y = Y((w.start + w.end) / 2); svg += `<text x="49" y="${y}" transform="rotate(-90 49 ${y})" text-anchor="middle" dominant-baseline="middle" font-size="9" font-family="Geist, sans-serif" fill="${col[w.zone]}" letter-spacing=".04em">${ZN[w.zone]}</text>`; });
  // sleep blocks
  let body = lines;
  const nReal = parseNight(S.days[k]?.sleep), nextReal = parseNight(S.days[addDays(k, 1)]?.sleep);
  if (e.wake > DAY_START) body += `<div class="tl-sleep" style="top:${Y(DAY_START)}px;height:${Y(Math.min(e.wake, 1740))}px">${ic("moon").replace("<svg", '<svg width="14" height="14"')}<span>Сон${nReal ? "" : " (оценка)"} · подъём ${fmtHM(e.wake)}</span></div>`;
  if (e.bed < 1740) body += `<div class="tl-sleep" style="top:${Y(e.bed)}px;height:${Y(1740) - Y(e.bed)}px">${ic("moon").replace("<svg", '<svg width="14" height="14"')}<span>${nextReal ? "Сон · отбой " : "Отбой по плану "}${fmtHM(e.bed)}</span></div>`;
  // tasks
  const ts = tasksOn(k).filter((t) => t.start).map((t) => ({ t, s: taskMin(t.start), e: taskEnd(t) })).sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = []; let cur = null;
  ts.forEach((x) => { if (!cur || x.s >= cur.end) { cur = { items: [], end: x.e }; clusters.push(cur); } cur.items.push(x); cur.end = Math.max(cur.end, x.e); });
  clusters.forEach((cl) => { const cols = []; cl.items.forEach((x) => { let i = cols.findIndex((end) => end <= x.s); if (i < 0) { i = cols.length; cols.push(0); } x.col = i; cols[i] = x.e; }); cl.items.forEach((x) => (x.n = cols.length)); });
  // free gaps
  const busy = ts.map((x) => [x.s, x.e]); let g0 = Math.max(e.wake, DAY_START); const gaps = [];
  busy.forEach(([a, b]) => { if (a > g0) gaps.push([g0, Math.min(a, e.bed)]); g0 = Math.max(g0, b); });
  if (g0 < e.bed) gaps.push([g0, e.bed]);
  gaps.filter(([a, b]) => b - a >= 20).forEach(([a, b]) => {
    const zc = {}; for (let m = a; m < b; m += 5) { const z = zoneAt(e, m); zc[z] = (zc[z] || 0) + 1; }
    const dz = Object.entries(zc).filter(([z]) => z !== "sleep").sort((x, y) => y[1] - x[1])[0];
    const big = b - a >= 90;
    body += `<button class="tl-free" data-a="addat" data-m="${a}" data-g="${b - a}" style="top:${Y(a) + 3}px;height:${Y(b) - Y(a) - 6}px;${big ? "align-items:flex-start;padding-top:8px" : ""}"><span>Свободно · ${fmtDur(b - a)}${dz ? ` · <span class="ztext ${dz[0]}">${ZN[dz[0]]}</span>` : ""}</span></button>`;
  });
  ts.forEach((x) => {
    const t = x.t, top = Y(x.s), ht = Math.max(26, Y(x.e) - top - 2); const z = zoneAt(e, x.s);
    const warn = t.energy === "focus" && (z === "recharge" || z === "sleep") ? '<span class="warn">низкая энергия для Focus</span>' : "";
    const late = isOverdue(t);
    const left = `calc(6px + (100% - 12px) * ${x.col / x.n})`, w = `calc((100% - 12px) / ${x.n} - 4px)`;
    const inner = ht < 44 ? `<div style="min-width:0"><div class="tt" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)} <span class="tm">${esc(t.start)}</span></div></div>`
      : `<div style="min-width:0"><div class="tt">${esc(t.title)}</div><div class="tm">${esc(t.start)}–${fmtHM(x.e)} · ${fmtDur(t.dur || 30)}${t.sphere ? " · " + esc(t.sphere) : ""}</div>${warn}</div>`;
    body += `<div class="tl-task ${t.energy || "steady"} ${t.done ? "done" : ""} ${late ? "late" : ""}" style="top:${top + 1}px;height:${ht}px;left:${left};width:${w}">
      <button data-a="ttoggle" data-id="${t.id}" aria-label="Выполнено" style="align-self:flex-start"><span class="tick ${t.done ? "done" : ""}">${ic("check")}</span></button>
      <button data-a="topen" data-id="${t.id}" style="text-align:left;flex:1;min-width:0;align-self:stretch;display:flex">${inner}</button></div>`;
  });
  if (isT && nm >= DAY_START && nm < 1740) body += `<div class="tl-now" style="top:${Y(nm)}px"><span>${fmtHM(nm)}</span></div>`;
  return `<section class="tl" aria-label="Лента дня"><div class="tl-hours">${hours}</div><div class="tl-energy"><svg viewBox="0 0 54 1440" preserveAspectRatio="none" aria-hidden="true">${svg}</svg></div><div class="tl-body">${body}</div></section>`;
}

/* ---------- СЕЙЧАС ---------- */
function vNow() {
  const c = ctx(), k = c.today, e = energy(k), nm = logicalNow().min; const p = e.at(Math.floor(nm / 5) * 5) || {};
  const curW = e.windows.find((w) => nm >= w.start && nm < w.end);
  const nextF = e.windows.find((w) => w.zone === "focus" && w.start > nm && w.end - w.start >= 30);
  const z = p.zone || "sleep";
  let line;
  if (z === "sleep") line = "По модели сейчас время сна. Индекс считается для бодрствования.";
  else if (z === "focus" && curW) line = `Focus до ${fmtHM(curW.end)}. Бери самое сложное.`;
  else line = nextF ? `Следующее окно Focus: <b class="num">${fmtHM(nextF.start)}–${fmtHM(nextF.end)}</b>, через ${fmtDur(nextF.start - nm)}.` : "Окон Focus сегодня больше нет. Делай рутину и готовься ко сну.";
  const feel = (S.days[k]?.feel || []).slice(-1)[0];
  let h = head("Сейчас");
  h += `<section class="card"><div class="row"><span class="zdot ${z}" style="width:10px;height:10px"></span><span class="ztext ${z}" style="font-weight:600">${ZN[z]}</span><span class="dim small">${z !== "sleep" ? "· " + ZHINT[z] : ""}</span></div>
    <div class="row" style="align-items:baseline;gap:8px"><b class="num" style="font-size:56px;line-height:1;font-weight:600">${p.idx ?? "—"}</b><span class="muted">/ 100 · индекс энергии в ${fmtHM(nm)}</span></div>
    <div class="small muted">${line}</div>
    ${!parseNight(S.days[k]?.sleep) ? '<div class="alert">Сон за сегодня не отмечен, модель взяла твой привычный режим. <button class="btn sm" data-a="sleep" style="margin-left:6px">Отметить</button></div>' : ""}</section>`;
  h += `<section class="card"><h2>Как ты себя чувствуешь?</h2><div class="seg">${["low", "ok", "high"].map((v) => `<button data-a="feel" data-v="${v}" class="${feel && feel.v === v ? "on" : ""}">${{ low: "Низко", ok: "Нормально", high: "Бодро" }[v]}</button>`).join("")}</div>
    <div class="xs dim">${feel ? `Последняя отметка в ${esc(feel.t)}: модель ${feel.err > 0 ? "подняла" : "опустила"} оценку на ${Math.abs(Math.round(feel.err * 0.7))} п. и запомнила поправку.` : "Модель сравнит ответ со своим прогнозом и со временем подстроится под тебя."}</div></section>`;
  h += `<section class="card"><div class="card-h"><h2 class="grow">Энергия за день</h2><span class="xs dim">05:00 → 05:00</span></div>${chartEnergy(e, nm)}
    <div class="grid3"><div class="tile"><span>Среднее</span><b>${e.avg ?? "—"}</b></div><div class="tile"><span>Максимум · ${e.maxAt != null ? fmtHM(e.maxAt) : ""}</span><b>${e.max >= 0 ? e.max : "—"}</b></div><div class="tile"><span>Минимум · ${e.minAt != null ? fmtHM(e.minAt) : ""}</span><b>${e.min <= 100 ? e.min : "—"}</b></div></div>
    <div class="hours-strip" aria-label="Индекс по часам">${hourStrip(e, nm)}</div></section>`;
  const ws = e.windows.filter((w) => w.end - w.start >= 30);
  h += `<section class="card"><h2>Окна на сегодня</h2><div>${ws.map((w) => `<div class="item" style="padding:8px 0"><span class="zdot ${w.zone}" style="margin-top:6px"></span><div class="body"><div class="t"><span class="num">${fmtHM(w.start)}–${fmtHM(w.end)}</span> · <span class="ztext ${w.zone}">${ZN[w.zone]}</span></div><div class="meta">${ZHINT[w.zone]} · ~${w.avg}</div></div>${w.end <= nm ? '<span class="xs dim">прошло</span>' : ""}</div>`).join("")}
    ${e.train ? `<div class="item" style="padding:8px 0"><span class="zdot" style="background:var(--ok);margin-top:6px"></span><div class="body"><div class="t"><span class="num">${fmtHM(e.train.start)}–${fmtHM(e.train.end)}</span> · Тренировка</div><div class="meta">пик температуры тела и силы, не позже чем за 2,5 ч до сна</div></div></div>` : ""}</div></section>`;
  h += `<section class="card"><h2>Что влияет на индекс</h2><div>${e.factors.map((f) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow small">${f.label}<span class="dim"> · ${esc(f.note)}</span></span><b class="num ${f.val < 0 ? "bad" : f.val > 0 ? "okc" : "dim"}">${f.val > 0 ? "+" : ""}${f.val}</b></div>`).join("")}
    <div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow small">Твоя поправка (по ответам «Как ты?»)<span class="dim"> · ${c.st.model.n || 0} отметок</span></span><b class="num dim">${(c.st.model.bias || []).map((b) => (b > 0 ? "+" : "") + Math.round(b)).join(" / ")}</b></div></div>
    <div class="xs dim">Модель: процесс S (давление сна) + процесс C (циркадный ритм, фаза по середине твоего сна за 7 дней) + инерция после пробуждения, плюс штрафы за долг сна, поздний отбой, разброс режима и пересып.</div></section>`;
  h += `<section class="card"><h2>Гормоны и мотивация (оценка)</h2>${chartModel(e, nm)}
    <div class="row wrap xs muted" style="gap:12px"><span class="row" style="gap:5px"><i style="width:14px;height:2px;background:var(--fg)"></i>Бодрость</span><span class="row" style="gap:5px"><i style="width:14px;height:0;border-top:2px dashed #9a9aa2"></i>Кортизол</span><span class="row" style="gap:5px"><i style="width:14px;height:2px;background:var(--accent)"></i>Мотивация</span><span class="row" style="gap:5px"><i style="width:14px;height:8px;background:#2c2c31"></i>Мелатонин</span></div>
    <div class="xs dim">Это модельная оценка по времени твоего сна и типичным суточным профилям, не измерение. Реальные уровни зависят от света, еды, стресса и анализов не заменяют.</div></section>`;
  return h;
}
function hourStrip(e, nm) {
  let s = "";
  for (let m = Math.ceil(e.wake / 60) * 60; m < e.bed; m += 60) { const p = e.at(m); if (!p || p.idx == null) continue; s += `<div class="${p.zone} ${nm >= m && nm < m + 60 ? "now" : ""}"><span class="dim">${fmtHM(m).slice(0, 2)}</span><b>${p.idx}</b></div>`; }
  return s || '<div class="dim" style="width:auto;padding:4px 8px">нет данных</div>';
}
function chartFrame(W, Hh, L, T, Bt) {
  let g = "";
  [0, 50, 100].forEach((v) => { const y = T + (1 - v / 100) * Hh; g += `<line x1="${L}" x2="${L + W}" y1="${y}" y2="${y}" stroke="#27272a"/><text x="${L - 5}" y="${y + 3}" text-anchor="end">${v}</text>`; });
  for (let m = 360; m <= 1740; m += 240) { const x = L + (m - 300) / 1440 * W; g += `<text x="${x}" y="${T + Hh + Bt}" text-anchor="middle">${fmtHM(m).slice(0, 5)}</text>`; }
  return g;
}
function chartEnergy(e, nm) {
  const L = 26, T = 8, W = 306, Hh = 120, Bt = 14; const x = (m) => L + (m - 300) / 1440 * W, y = (v) => T + (1 - v / 100) * Hh;
  let s = chartFrame(W, Hh, L, T, Bt); const col = { focus: "var(--focus)", steady: "var(--steady)", recharge: "var(--recharge)" };
  const runs = []; e.pts.forEach((p) => { if (p.idx == null) { runs.push(null); return; } const l = runs[runs.length - 1]; if (l && l.z === p.zone) l.p.push(p); else { if (l) l.p.push(p); runs.push({ z: p.zone, p: [p] }); } });
  runs.filter(Boolean).forEach((r) => {
    if (r.p.length < 2) return; const d = r.p.map((p, i) => (i ? "L" : "M") + x(p.m).toFixed(1) + " " + y(p.idx).toFixed(1)).join("");
    s += `<path d="${d} L${x(r.p[r.p.length - 1].m).toFixed(1)} ${T + Hh} L${x(r.p[0].m).toFixed(1)} ${T + Hh}Z" fill="${col[r.z] || "#555"}" opacity=".12"/><path d="${d}" fill="none" stroke="${col[r.z] || "#555"}" stroke-width="2" stroke-linejoin="round"/>`;
  });
  if (e.maxAt != null) s += `<circle cx="${x(e.maxAt)}" cy="${y(e.max)}" r="3" fill="var(--fg)"/>`;
  if (nm >= 300 && nm <= 1740) { const p = e.at(Math.floor(nm / 5) * 5); s += `<line x1="${x(nm)}" x2="${x(nm)}" y1="${T}" y2="${T + Hh}" stroke="#ff2d55" stroke-dasharray="2 3" opacity=".7"/>`; if (p && p.idx != null) s += `<circle cx="${x(nm)}" cy="${y(p.idx)}" r="4.5" fill="#000000" stroke="#ff2d55" stroke-width="2"/>`; }
  return `<svg class="chart" viewBox="0 0 340 ${T + Hh + Bt + 6}" role="img" aria-label="Кривая энергии за день">${s}</svg>`;
}
function chartModel(e, nm) {
  const L = 26, T = 8, W = 306, Hh = 110, Bt = 14; const x = (m) => L + (m - 300) / 1440 * W, y = (v) => T + (1 - v) * Hh;
  let s = ""; for (let m = 360; m <= 1740; m += 240) s += `<text x="${x(m)}" y="${T + Hh + Bt}" text-anchor="middle">${fmtHM(m)}</text>`;
  s += `<line x1="${L}" x2="${L + W}" y1="${T + Hh}" y2="${T + Hh}" stroke="#27272a"/>`;
  const line = (f) => e.pts.map((p, i) => (i ? "L" : "M") + x(p.m).toFixed(1) + " " + y(f(p)).toFixed(1)).join("");
  s += `<path d="${line((p) => p.mel)} L${x(1740)} ${T + Hh} L${x(300)} ${T + Hh}Z" fill="#2c2c31" opacity=".7"/>`;
  s += `<path d="${line((p) => p.cort)}" fill="none" stroke="#9a9aa2" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  s += `<path d="${line((p) => p.mot)}" fill="none" stroke="#ff2d55" stroke-width="1.8"/>`;
  s += `<path d="${line((p) => p.alert)}" fill="none" stroke="#f5f5f6" stroke-width="2"/>`;
  if (nm >= 300 && nm <= 1740) s += `<line x1="${x(nm)}" x2="${x(nm)}" y1="${T}" y2="${T + Hh}" stroke="#ff2d55" stroke-dasharray="2 3" opacity=".6"/>`;
  return `<svg class="chart" viewBox="0 0 340 ${T + Hh + Bt + 6}" role="img" aria-label="Модельные кривые">${s}</svg>`;
}

/* ---------- ЗАДАЧИ ---------- */
function taskBuckets() {
  const c = ctx(), t = c.today, all = allTasks();
  const b = {
    inbox: all.filter((x) => !x.date && !x.done),
    today: all.filter((x) => x.date === t).sort((a, b2) => a.done - b2.done || (taskMin(a.start) ?? 9999) - (taskMin(b2.start) ?? 9999)),
    overdue: all.filter((x) => !x.done && x.date && x.date < t).sort((a, b2) => a.date.localeCompare(b2.date)),
    soon: all.filter((x) => !x.done && x.date > t && x.date <= addDays(t, 14)).sort((a, b2) => (a.date + (a.start || "99")).localeCompare(b2.date + (b2.start || "99"))),
    done: all.filter((x) => x.done).sort((a, b2) => String(b2.doneAt || "").localeCompare(String(a.doneAt || ""))).slice(0, 60),
  };
  return b;
}
function vTasks() {
  const b = taskBuckets(); const tabs = [["inbox", "Входящие", b.inbox.length], ["today", "Сегодня", b.today.filter((x) => !x.done).length], ["overdue", "Просрочено", b.overdue.length], ["soon", "2 недели", b.soon.length], ["done", "Выполнено", null], ["energy", "По энергии", null]];
  let h = head("Задачи");
  h += `<div class="chips" role="tablist">${tabs.map(([k, n, c]) => `<button class="chip ${S.taskTab === k ? "on" : ""}" data-a="ttab" data-v="${k}" role="tab" aria-selected="${S.taskTab === k}">${n}${c ? ` <span class="cnt ${k === "overdue" ? "bad" : ""}">${c}</span>` : ""}</button>`).join("")}</div>`;
  if (S.taskTab === "energy") return h + energyLeft();
  const list = b[S.taskTab] || [];
  const empty = { inbox: "Входящие пусты. Сюда падают задачи без даты.", today: "На сегодня задач нет. Нажми «+».", overdue: "Просрочки нет. Так держать.", soon: "На ближайшие 2 недели ничего.", done: "Пока ничего не закрыто." }[S.taskTab];
  h += `<section class="card">${list.length ? `<div>${list.map((t) => taskItem(t, S.taskTab === "today" && !t.start)).join("")}</div>` : `<div class="empty">${empty}</div>`}</section>`;
  if (S.taskTab === "overdue" && list.length) h += `<button class="btn block" data-a="movetoday">Перенести всё просроченное на сегодня</button>`;
  return h;
}
function energyLeft() {
  const c = ctx(), e = energy(c.today), nm = logicalNow().min;
  const left = allTasks().filter((t) => !t.done && t.date && t.date <= c.today);
  const busy = busyOn(c.today); let h = "";
  for (const z of ["focus", "steady", "recharge"]) {
    const ts = left.filter((t) => (t.energy || "steady") === z); const need = ts.reduce((a, t) => a + (t.dur || 30), 0);
    let free = 0; for (let m = Math.max(nm, e.wake); m < e.bed; m += 5) { if (zoneAt(e, m) === z && !busy.some(([a, b]) => m >= a && m < b)) free += 5; }
    const over = need > free;
    h += `<section class="card"><div class="card-h"><span class="zdot ${z}"></span><h2 class="grow">${ZN[z]}</h2><span class="small ${over ? "bad" : "muted"}">${fmtDur(need)} задач / ${fmtDur(free)} окна</span></div>
      <div class="xs dim">${ZHINT[z]}${over ? ". Не влезает в оставшиеся окна: перенеси часть на завтра." : ""}</div>${ts.length ? `<div>${ts.map((t) => taskItem(t)).join("")}</div>` : '<div class="empty">Ничего не осталось.</div>'}</section>`;
  }
  return h;
}

/* ---------- ЦЕЛИ ---------- */
function vGoals() {
  const c = ctx(); const gs = Object.values(S.goals).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const act = gs.filter((g) => !g.archived), arc = gs.filter((g) => g.archived);
  let h = head("Цели");
  const grp = (title, sub, list) => list.length ? `<div class="row" style="margin-top:4px"><h3 class="grow">${title}</h3><span class="xs dim">${sub}</span></div>${list.map((g) => goalCard(g, c)).join("")}` : "";
  h += grp("База — сейчас", "сон, учёба, заказы", act.filter((g) => (g.stage || 1) === 1));
  h += grp("Следующий этап", "подключаем, когда база держится", act.filter((g) => g.stage === 2));
  if (!act.length) h += '<div class="card"><div class="empty">Целей пока нет. Создай первую или попроси Claude.</div></div>';
  h += `<button class="btn block" data-a="gnew">${ic("plus")} Новая цель</button>`;
  if (arc.length) h += `<details class="card"><summary class="small muted" style="cursor:pointer">Архив · ${arc.length}</summary>${arc.map((g) => goalCard(g, c)).join("")}</details>`;
  return h;
}
function goalCard(g, c) {
  const p = goalProgress(g, c), od = goalOverdue(g, c);
  const subOd = (g.subtasks || []).filter((s) => !s.done && s.deadline && s.deadline < c.today).length;
  return `<button class="card goal" data-a="gopen" data-id="${g.id}"><div class="gt"><b>${esc(g.title)}</b><span class="${p.pct >= 100 ? "okc" : od ? "bad" : ""}">${p.pct}%</span></div>
    ${g.criterion ? `<div class="small muted">${esc(g.criterion)}</div>` : ""}
    <div class="bar ${p.pct >= 100 ? "ok" : od ? "badb" : ""}"><i style="width:${p.pct}%"></i></div>
    <div class="row wrap xs" style="gap:6px"><span class="muted">${p.label}</span>${g.deadline ? `<span class="tag ${od ? "red" : ""}">до ${fmtDate(g.deadline, "short")}</span>` : ""}${subOd ? `<span class="tag red">просрочено шагов: ${subOd}</span>` : ""}${g.sphere ? `<span class="tag">${esc(g.sphere)}</span>` : ""}</div></button>`;
}

/* ---------- ИТОГИ ---------- */
function vStats() {
  const c = ctx(), n = S.statsN; const hs = activeHabits(c.st);
  let h = head("Итоги");
  h += `<div class="chips">${[[7, "Неделя"], [30, "Месяц"]].map(([v, l]) => `<button class="chip ${n === v ? "on" : ""}" data-a="sn" data-v="${v}">${l}</button>`).join("")}</div>`;
  // где проседаешь
  const al = weakSpots(c, n);
  h += `<section class="card"><h2>Где проседаешь</h2>${al.length ? al.map((a) => `<div class="alert">${a}</div>`).join("") : '<div class="alert okb">Провалов за период нет. Держи темп и не расслабляйся.</div>'}</section>`;
  // проценты
  let D = 0, M = 0; const rates = hs.map((x) => { const r = habitRate(x, c, n); D += r.done; M += r.miss; return { x, r }; });
  const tk = allTasks().filter((t) => t.date && t.date <= c.today && t.date > addDays(c.today, -n)); const tdone = tk.filter((t) => t.done).length;
  h += `<section class="card"><h2>Выполнение за ${n === 7 ? "неделю" : "месяц"}</h2><div class="grid3"><div class="tile"><span>Привычки</span><b>${D + M ? Math.round(D / (D + M) * 100) + "%" : "—"}</b></div><div class="tile"><span>Задачи</span><b>${tk.length ? Math.round(tdone / tk.length * 100) + "%" : "—"}</b></div><div class="tile"><span>Закрыто задач</span><b>${tdone}/${tk.length}</b></div></div>
    <div>${rates.map(({ x, r }) => `<div style="padding:8px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px"><div class="row"><span class="grow small">${esc(habitName(x, c.st))}</span><b class="num small ${r.pct != null && r.pct < 60 ? "bad" : ""}">${r.pct == null ? "—" : r.pct + "%"}</b></div><div class="row"><div class="dots grow">${dotStrip(x, c, n)}</div><span class="xs dim num">серия ${streakOf([x.key], c)} · лучшая ${bestStreak([x.key], c)}</span></div></div>`).join("")}</div>
    <div class="xs dim">Розовый — сделано, светло-серый — пропуск, тёмный с рамкой — день отдыха по графику.</div></section>`;
  // серии по сферам
  const sph = c.st.spheres.map((s) => ({ s, keys: hs.filter((x) => x.sphere === s).map((x) => x.key) })).filter((o) => o.keys.length);
  h += `<section class="card"><h2>Серии по сферам</h2><table class="t"><thead><tr><th>Сфера</th><th style="text-align:right">Серия</th><th style="text-align:right">Лучшая</th></tr></thead><tbody>${sph.map((o) => { const cur = streakOf(o.keys, c); return `<tr><td style="font-family:var(--font)">${esc(o.s)}</td><td style="text-align:right" class="${cur ? "okc" : "dim"}">${cur} дн.</td><td style="text-align:right" class="dim">${bestStreak(o.keys, c)} дн.</td></tr>`; }).join("")}</tbody></table><div class="xs dim">День в сфере засчитан, если все её привычки на этот день сделаны.</div></section>`;
  h += sleepStats(c);
  h += `<button class="btn block" data-a="claude" data-m="week">${ic("spark")} Разбор недели от Claude</button>`;
  return h;
}
function dotStrip(x, c, n) { let s = ""; for (let i = n - 1; i >= 0; i--) { const k = addDays(c.today, -i); const st = habitStatus(x, k, c); s += `<i class="${st}" title="${k}"></i>`; } return s; }
function weakSpots(c, n) {
  const out = []; const hs = activeHabits(c.st);
  hs.forEach((x) => { const run = missRun(x, c); if (run >= 2) out.push({ w: 10 + run, t: `<b>${esc(habitName(x, c.st))}</b>: ${run} ${run < 5 ? "дня" : "дней"} подряд мимо.` }); });
  hs.forEach((x) => { const r = habitRate(x, c, n); if (r.pct != null && r.pct < 60 && missRun(x, c) < 2 && r.done + r.miss >= 3) out.push({ w: 5, t: `<b>${esc(habitName(x, c.st))}</b>: ${r.pct}% за ${n === 7 ? "неделю" : "месяц"}.` }); });
  const od = allTasks().filter((t) => !t.done && t.date && t.date < c.today);
  if (od.length) { const old = od.map((t) => t.date).sort()[0]; out.push({ w: 9 + od.length, t: `Просрочено задач: <b>${od.length}</b>, самая старая с ${fmtDate(old, "short")}.` }); }
  Object.values(S.goals).filter((g) => !g.archived && goalOverdue(g, c)).forEach((g) => out.push({ w: 12, t: `Цель «${esc(g.title)}» просрочена (дедлайн ${fmtDate(g.deadline, "short")}).` }));
  const subs = []; Object.values(S.goals).filter((g) => !g.archived).forEach((g) => (g.subtasks || []).forEach((s) => { if (!s.done && s.deadline && s.deadline < c.today) subs.push(s.title); }));
  if (subs.length) out.push({ w: 8, t: `Просроченные шаги в целях: ${subs.slice(0, 3).map(esc).join("; ")}${subs.length > 3 ? " и ещё " + (subs.length - 3) : ""}.` });
  const ns = []; for (let i = 0; i < 7; i++) { const nn = parseNight(S.days[addDays(c.today, -i)]?.sleep); if (nn) ns.push(nn); }
  if (ns.length >= 2) { const avgBed = ns.reduce((a, x) => a + x.bed, 0) / ns.length; let goal = hm(c.st.targets.bed); if (goal >= 720) goal -= 1440; if (avgBed - goal > 30) out.push({ w: 11, t: `Отбой в среднем <b class="num">${fmtHM(avgBed)}</b>, на ${fmtDur(avgBed - goal)} позже цели.` }); }
  const e = energy(c.today); const debt = e.factors.find((f) => f.key === "debt"); if (debt && debt.val <= -8) out.push({ w: 9, t: `Долг сна снижает энергию на ${-debt.val} п. (${esc(debt.note)}).` });
  let low = 0; for (let i = 0; i < n; i++) (S.days[addDays(c.today, -i)]?.feel || []).forEach((f) => f.v === "low" && low++); if (low >= 3) out.push({ w: 6, t: `«Низко» отмечено ${low} раз за период.` });
  return out.sort((a, b) => b.w - a.w).slice(0, 7).map((o) => o.t);
}
function sleepStats(c) {
  // последние 14 ночей
  const N = 14, L = 34, T = 10, W = 296, Hh = 110; let s = "";
  const yv = (m) => T + (m - (-180)) / (360 - (-180)) * Hh; // 21:00 … 06:00
  for (let m = -180; m <= 360; m += 180) s += `<line x1="${L}" x2="${L + W}" y1="${yv(m)}" y2="${yv(m)}" stroke="#27272a"/><text x="${L - 5}" y="${yv(m) + 3}" text-anchor="end">${fmtHM(m)}</text>`;
  let goal = hm(c.st.targets.bed); if (goal >= 720) goal -= 1440;
  s += `<line x1="${L}" x2="${L + W}" y1="${yv(goal)}" y2="${yv(goal)}" stroke="var(--ok)" stroke-dasharray="4 4"/><text x="${L + W}" y="${yv(goal) - 4}" text-anchor="end" style="fill:var(--ok)">цель ${esc(c.st.targets.bed)}</text>`;
  for (let i = N - 1; i >= 0; i--) {
    const k = addDays(c.today, -i), n = parseNight(S.days[k]?.sleep); const x = L + (N - 1 - i + 0.5) * W / N;
    if ((N - 1 - i) % 3 === 0) s += `<text x="${x}" y="${T + Hh + 14}" text-anchor="middle">${fmtDate(k, "short").split(" ")[0]}</text>`;
    if (!n) continue; const b = clamp(n.bed, -180, 360);
    s += `<circle cx="${x}" cy="${yv(b)}" r="4" fill="${n.bed <= goal ? "#ff2d55" : "#9a9aa2"}"/>`;
  }
  // недели
  const rows = []; const mon = (k) => addDays(k, -((new Date(idxOf(k) * 864e5).getUTCDay() + 6) % 7));
  let wk = mon(c.today);
  for (let w = 0; w < 6; w++) {
    const ns = [], en = []; for (let d = 0; d < 7; d++) { const k = addDays(wk, d); if (k > c.today) break; const n = parseNight(S.days[k]?.sleep); if (n) { ns.push(n); en.push(energy(k).avg); } }
    if (ns.length) rows.push(`<tr><td>${fmtDate(wk, "short")}</td><td>${fmtHM(ns.reduce((a, x) => a + x.bed, 0) / ns.length)}</td><td>${fmtDur(ns.reduce((a, x) => a + x.dur, 0) / ns.length)}</td><td>${Math.round(en.reduce((a, b) => a + (b || 0), 0) / en.length)}</td><td>${ns.filter((x) => x.bed <= goal).length}/${ns.length}</td></tr>`);
    wk = addDays(wk, -7);
  }
  return `<section class="card"><h2>Сон</h2><div class="xs dim">Время отбоя за 14 ночей. Розовая точка — вовремя, серая — позже цели.</div><svg class="chart" viewBox="0 0 340 ${T + Hh + 22}" role="img" aria-label="Время отбоя">${s}</svg>
    <div class="scrollx">${rows.length ? `<table class="t"><thead><tr><th>Неделя с</th><th>Отбой</th><th>Сон</th><th>Энергия</th><th>Вовремя</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : '<div class="empty">Отмечай сон каждое утро, и здесь появится разбор по неделям.</div>'}</div></section>`;
}

/* ---------- НАСТРОЙКИ ---------- */
function vSettings() {
  const st = S.st, t = st.targets; let h = head("Настройки");
  const inp = (id, label, val, type, attrs) => `<label class="f" for="${id}">${label}<input class="in num" id="${id}" data-a="target" data-k="${id.slice(2)}" type="${type}" value="${esc(val)}" ${attrs || ""}></label>`;
  h += `<section class="card"><h2>Нормы и цели</h2><div class="f2">${inp("t-bed", "Отбой до", t.bed, "time")}${inp("t-sleepNeed", "Нужно сна, ч", t.sleepNeed, "number", 'step="0.5" min="5" max="11"')}${inp("t-waterL", "Вода, л", t.waterL, "number", 'step="0.1" min="0.5" max="6"')}${inp("t-glassL", "Стакан, л", t.glassL, "number", 'step="0.05" min="0.1" max="1"')}${inp("t-proteinG", "Белок, г", t.proteinG, "number", 'step="5" min="40" max="300"')}${inp("t-studyH", "Подготовка к сессии, ч", t.studyH, "number", 'step="0.5" min="0.5" max="10"')}</div>
    <div class="f2">${inp("u-bed", "Обычно ложусь (для модели)", st.usual.bed, "time")}${inp("u-wake", "Обычно встаю", st.usual.wake, "time")}</div></section>`;
  h += `<section class="card"><div class="card-h"><h2 class="grow">Привычки</h2><button class="btn sm" data-a="hnew">${ic("plus")} Добавить</button></div><div>${st.habits.map((x) => `<button class="hab" data-a="hedit" data-k="${x.key}"><span class="tick ${x.active !== false ? "done" : ""}">${ic("check")}</span><div class="name">${esc(habitName(x, st))}<small>${esc(x.sphere || "")} · ${schedLabel(x.sched)}${x.active === false ? " · выключена" : ""}</small></div><span class="dim">${ic("right")}</span></button>`).join("")}</div></section>`;
  h += `<section class="card"><h2>Сферы</h2><div class="row wrap" style="gap:6px">${st.spheres.map((s, i) => `<span class="chip">${esc(s)}<button data-a="sdel" data-i="${i}" aria-label="Удалить сферу ${esc(s)}" class="dim">${ic("x").replace("<svg", '<svg width="14" height="14"')}</button></span>`).join("")}</div>
    <div class="row"><input class="in" id="newSphere" placeholder="Новая сфера"><button class="btn" data-a="sadd">Добавить</button></div></section>`;
  h += `<section class="card"><h2>Отметить прошлый день</h2><div class="small muted">Забыл отметиться? Открой день: отметки сохранятся с пометкой «задним числом».</div><div class="row"><input class="in num" type="date" id="pastDay" max="${logicalNow().key}" value="${addDays(logicalNow().key, -1)}"><button class="btn" data-a="gopast">Открыть</button></div></section>`;
  h += `<section class="card"><h2>Модель энергии</h2><div class="small muted">Поправки по твоим ответам «Как ты себя чувствуешь?» (0–3 ч / 3–7 / 7–11 / 11+ ч после подъёма): <span class="num">${st.model.bias.map((b) => (b > 0 ? "+" : "") + Math.round(b)).join(" / ")}</span>, ответов: ${st.model.n || 0}.</div><button class="btn sm" data-a="mreset" style="align-self:flex-start">Сбросить подстройку</button></section>`;
  h += `<section class="card"><h2>Данные и Claude</h2><div class="small muted">Всё хранится в базе этой страницы: settings/main, days/ГГГГ-ММ-ДД, tasks, goals, reviews. Claude читает и меняет их из чата, а кнопка ${ic("spark").replace("<svg", '<svg width="14" height="14" style="vertical-align:-2px"')} открывает разбор и команды прямо здесь.</div><button class="btn sm" data-a="export" style="align-self:flex-start">Скопировать данные (JSON)</button></section>`;
  return h;
}
function schedLabel(s) { s = s || { t: "daily" }; if (s.t === "every") return s.n === 2 ? "через день" : "раз в " + s.n + " дн."; if (s.t === "cycle") return "цикл " + s.p; return "каждый день"; }

/* ===== sheets ===== */
let SH = null; // текущий лист: { kind, ... }
function openSheet(html) {
  const r = $("#sheetRoot"); r.innerHTML = `<div class="scrim" data-a="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div id="sheetBody" style="display:flex;flex-direction:column;gap:14px">${html}</div></div></div>`;
  document.body.style.overflow = "hidden";
}
function setSheet(html) { const b = $("#sheetBody"); if (b) b.innerHTML = html; }
function closeSheet() { $("#sheetRoot").innerHTML = ""; document.body.style.overflow = ""; if (SH && SH.abort) SH.abort.abort(); SH = null; }
const sheetHead = (t) => `<div class="sheet-h"><h2>${t}</h2><button class="iconbtn" data-a="close" aria-label="Закрыть">${ic("x")}</button></div>`;

/* ---------- задача ---------- */
function openTask(id, preset) {
  const c = ctx(); const t = id ? clone(S.tasks[id]) : { id: null, title: "", desc: "", date: S.view === "tasks" && S.taskTab === "inbox" ? null : (S.view === "day" ? S.dayKey : c.today), start: null, dur: 60, energy: "steady", sphere: null, done: false, ...(preset || {}) };
  SH = { kind: "task", t, del: false }; openSheet(taskForm()); refreshSlot();
  if (!id) setTimeout(() => $("#f-title") && $("#f-title").focus(), 50);
}
function taskForm() {
  const t = SH.t, c = ctx(); const dates = [[null, "Входящие"], [c.today, "Сегодня"], [addDays(c.today, 1), "Завтра"]];
  const custom = t.date && !dates.some(([d]) => d === t.date);
  return `${sheetHead(t.id ? "Задача" : "Новая задача")}
  <label class="f" for="f-title">Название<input class="in" id="f-title" value="${esc(t.title)}" placeholder="Например: ДЗ по матану, №3–7" autocomplete="off"></label>
  <label class="f" for="f-desc">Описание<textarea class="in" id="f-desc" rows="2" placeholder="Что именно сделать">${esc(t.desc || "")}</textarea></label>
  <div class="f"><span class="small muted">Когда</span><div class="chips">${dates.map(([d, l]) => `<button class="chip ${t.date === d ? "on" : ""}" data-a="f-date" data-v="${d || ""}">${l}</button>`).join("")}<input type="date" class="in in-chip ${custom ? "on" : ""}" id="f-dated" value="${custom ? t.date : ""}" aria-label="Другая дата"></div></div>
  <div class="f2"><label class="f" for="f-start">Время<input class="in num" type="time" id="f-start" value="${esc(t.start || "")}"></label><label class="f" for="f-dur">Длительность, мин<input class="in num" type="number" id="f-dur" min="5" step="5" value="${t.dur || 30}"></label></div>
  <div class="chips">${[15, 30, 45, 60, 90, 120, 180].map((d) => `<button class="chip ${t.dur === d ? "on" : ""}" data-a="f-dur" data-v="${d}">${fmtDur(d)}</button>`).join("")}</div>
  <div class="f"><span class="small muted">Тип энергии</span><div class="chips">${["focus", "steady", "recharge"].map((z) => `<button class="chip z-${z} ${t.energy === z ? "on" : ""}" data-a="f-en" data-v="${z}"><span class="zdot ${z}"></span>${ZN[z]}</button>`).join("")}</div><span class="xs dim">${ZHINT[t.energy] || ""}</span></div>
  <div class="f"><span class="small muted">Сфера</span><div class="chips">${c.st.spheres.map((s) => `<button class="chip ${t.sphere === s ? "on" : ""}" data-a="f-sph" data-v="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>
  <div id="f-slot"></div>
  <div class="row" style="gap:8px">${t.id ? `<button class="btn danger" data-a="f-del">${SH.del ? "Точно удалить?" : ic("trash")}</button><button class="btn" data-a="f-done">${t.done ? "Вернуть" : "Выполнено"}</button>` : ""}<button class="btn primary" data-a="f-save" style="flex:1">Сохранить</button></div>`;
}
function readTask() {
  const t = SH.t; t.title = $("#f-title").value.trim(); t.desc = $("#f-desc").value.trim();
  t.start = $("#f-start").value || null; t.dur = Math.max(5, parseInt($("#f-dur").value, 10) || 30);
  const dd = $("#f-dated").value; if (dd) t.date = dd;
}
function rerenderTask() { readTask(); setSheet(taskForm()); refreshSlot(); }
function refreshSlot() {
  const t = SH && SH.t; const el = $("#f-slot"); if (!el || !t) return;
  if (!t.date) { el.innerHTML = '<div class="xs dim">Без даты задача попадёт во «Входящие».</div>'; return; }
  const s = suggestSlot(t.date, t.dur, t.energy, t.id);
  if (!s) { el.innerHTML = '<div class="alert">Свободного окна на этот день нет. Выбери другой день или сократи длительность.</div>'; return; }
  SH.slot = s; const ok = s.fit >= 0.6;
  el.innerHTML = `<div class="card tight" style="background:var(--card-2)"><div class="row"><div class="grow small">${ok ? "Лучший слот" : "Подходящего окна нет, ближайшее"}: <b class="num">${fmtHM(s.start)}–${fmtHM(s.end)}</b> · <span class="ztext ${s.zone}">${ZN[s.zone] || ""}</span> <span class="dim">· энергия ~${s.avg}</span></div><button class="btn sm" data-a="f-slot">Поставить</button></div></div>`;
}
function saveTaskForm() {
  readTask(); const t = SH.t; if (!t.title) { toast("Напиши название задачи"); $("#f-title").focus(); return; }
  const isNew = !t.id; if (isNew) { t.id = uid(); t.createdAt = nowISO(); t.by = "me"; }
  saveTask(t); closeSheet(); toast(isNew ? "Задача добавлена" : "Сохранено");
}

/* ---------- сон (циферблат 24 ч) ---------- */
function openSleep() {
  const k = S.view === "day" ? S.dayKey : logicalNow().key; const c = ctx();
  const n = S.days[k]?.sleep || (() => { const u = nightFor(k, c); return { bed: fmtHM(u.bed), wake: fmtHM(u.wake), q: "ok" }; })();
  SH = { kind: "sleep", k, bed: hm(n.bed), wake: hm(n.wake), q: n.q || "ok", act: "bed" };
  openSheet(sleepForm()); bindDial();
}
function sleepForm() {
  const s = SH; const dur = ((s.wake - s.bed) % 1440 + 1440) % 1440;
  return `${sheetHead("Сон · ночь на " + fmtDate(s.k, "short"))}
  <svg class="dial" id="dial" viewBox="0 0 300 300" role="img" aria-label="Циферблат 24 часа">${dialSvg()}</svg>
  <div class="grid3" style="grid-template-columns:1fr 1fr"><button class="tile ${s.act === "bed" ? "" : ""}" data-a="sl-act" data-v="bed" style="text-align:left;${s.act === "bed" ? "border-color:var(--fg)" : ""}"><span>Лёг</span><b id="sl-bed">${fmtHM(s.bed)}</b></button><button class="tile" data-a="sl-act" data-v="wake" style="text-align:left;${s.act === "wake" ? "border-color:var(--fg)" : ""}"><span>Встал</span><b id="sl-wake">${fmtHM(s.wake)}</b></button></div>
  <div class="row" style="justify-content:center"><button class="btn sm" data-a="sl-step" data-v="-15">−15</button><button class="btn sm" data-a="sl-step" data-v="-5">−5</button><span class="small muted" style="width:120px;text-align:center">${s.act === "bed" ? "отбой" : "подъём"}</span><button class="btn sm" data-a="sl-step" data-v="5">+5</button><button class="btn sm" data-a="sl-step" data-v="15">+15</button></div>
  <div class="f"><span class="small muted">Как спал?</span><div class="seg">${["bad", "ok", "good"].map((q) => `<button data-a="sl-q" data-v="${q}" class="${s.q === q ? "on" : ""}">${QN[q]}</button>`).join("")}</div></div>
  ${dur < 180 || dur > 15 * 60 ? '<div class="alert">Проверь время: сон ' + fmtDur(dur) + "</div>" : ""}
  <button class="btn primary block" data-a="sl-save">Сохранить сон</button>`;
}
function dialSvg() {
  const s = SH, R = 112, cx = 150, cy = 150; const pt = (m, r) => { const a = m / 1440 * 2 * Math.PI - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#27272a" stroke-width="26"/>`;
  for (let h = 0; h < 24; h++) { const [x1, y1] = pt(h * 60, R - 20), [x2, y2] = pt(h * 60, R - (h % 3 ? 16 : 13)); g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#52525b" stroke-width="1.2"/>`; if (h % 3 === 0) { const [tx, ty] = pt(h * 60, R - 32); g += `<text x="${tx}" y="${ty + 4}" text-anchor="middle" font-size="11" font-family="Geist Mono, monospace" fill="#a1a1aa">${pad(h)}</text>`; } }
  const dur = ((s.wake - s.bed) % 1440 + 1440) % 1440; const [ax, ay] = pt(s.bed, R), [bx, by] = pt(s.wake, R);
  g += `<path d="M${ax} ${ay} A${R} ${R} 0 ${dur > 720 ? 1 : 0} 1 ${bx} ${by}" fill="none" stroke="#ff2d55" stroke-opacity=".5" stroke-width="26" stroke-linecap="round"/>`;
  const handle = (m, k, fill) => { const [x, y] = pt(m, R); return `<circle class="h" cx="${x}" cy="${y}" r="15" fill="${fill}" stroke="${s.act === k ? "#fafafa" : "#09090b"}" stroke-width="2.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#09090b" font-family="Geist, sans-serif" pointer-events="none">${k === "bed" ? "Л" : "В"}</text>`; };
  g += handle(s.bed, "bed", "#ff2d55") + handle(s.wake, "wake", "#f5f5f6");
  g += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="26" font-weight="600" fill="#fafafa" font-family="Geist Mono, monospace">${Math.floor(dur / 60)}:${pad(dur % 60)}</text><text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="12" fill="#71717a" font-family="Geist, sans-serif">часов сна</text>`;
  return g;
}
function bindDial() {
  const svg = $("#dial"); if (!svg) return; let drag = false;
  const toMin = (ev) => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * 300 - 150, y = (ev.clientY - r.top) / r.height * 300 - 150; let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += 2 * Math.PI; return Math.round(a / (2 * Math.PI) * 1440 / 5) * 5 % 1440; };
  const dist = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };
  svg.addEventListener("pointerdown", (ev) => { const m = toMin(ev); SH.act = dist(m, SH.bed) <= dist(m, SH.wake) ? "bed" : "wake"; SH[SH.act] = m; drag = true; svg.setPointerCapture(ev.pointerId); upd(); });
  svg.addEventListener("pointermove", (ev) => { if (!drag) return; SH[SH.act] = toMin(ev); upd(); });
  const end = () => { if (drag) { drag = false; setSheet(sleepForm()); bindDial(); } };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  function upd() { svg.innerHTML = dialSvg(); $("#sl-bed").textContent = fmtHM(SH.bed); $("#sl-wake").textContent = fmtHM(SH.wake); }
}

/* ---------- цель ---------- */
function openGoal(id) {
  const g = id ? clone(S.goals[id]) : { id: null, title: "", criterion: "", deadline: null, stage: 1, sphere: null, kind: "subtasks", subtasks: [], habits: [], target: 10, window: 7, history: [] };
  SH = { kind: "goal", g, del: false }; openSheet(goalForm());
}
function goalForm() {
  const g = SH.g, c = ctx(); const p = g.id ? goalProgress(g, c) : null; const od = g.id && goalOverdue(g, c);
  const kinds = [["subtasks", "Шаги"], ["streak", "Серия дней"], ["count", "Дней из N"]];
  let h = `${sheetHead(g.id ? "Цель" : "Новая цель")}`;
  if (p) h += `<div class="card tight" style="background:var(--card-2)"><div class="row"><b class="num ${p.pct >= 100 ? "okc" : od ? "bad" : ""}" style="font-size:22px">${p.pct}%</b><span class="grow small muted">${p.label}</span>${g.deadline ? `<span class="tag ${od ? "red" : ""}">до ${fmtDate(g.deadline, "short")}</span>` : ""}</div><div class="bar ${p.pct >= 100 ? "ok" : od ? "badb" : ""}"><i style="width:${p.pct}%"></i></div></div>`;
  h += `<label class="f" for="g-title">Название<input class="in" id="g-title" value="${esc(g.title)}" placeholder="Например: Закрыть долги по учёбе"></label>
  <label class="f" for="g-crit">Критерий успеха<textarea class="in" id="g-crit" rows="2" placeholder="Как поймёшь, что получилось">${esc(g.criterion || "")}</textarea></label>
  <div class="f2"><label class="f" for="g-dl">Дедлайн<input class="in num" type="date" id="g-dl" value="${esc(g.deadline || "")}"></label><label class="f" for="g-sph">Сфера<select class="in" id="g-sph"><option value="">—</option>${c.st.spheres.map((s) => `<option ${g.sphere === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label></div>
  <div class="f"><span class="small muted">Этап</span><div class="seg"><button data-a="g-stage" data-v="1" class="${(g.stage || 1) === 1 ? "on" : ""}">База — сейчас</button><button data-a="g-stage" data-v="2" class="${g.stage === 2 ? "on" : ""}">Следующий этап</button></div></div>
  <div class="f"><span class="small muted">Как считать прогресс</span><div class="seg">${kinds.map(([k, l]) => `<button data-a="g-kind" data-v="${k}" class="${g.kind === k ? "on" : ""}">${l}</button>`).join("")}</div></div>`;
  if (g.kind === "streak" || g.kind === "count") {
    h += `<div class="f"><span class="small muted">Привычки (день засчитан, когда сделаны все)</span><div class="row wrap" style="gap:6px">${c.st.habits.map((x) => `<button class="chip ${(g.habits || []).includes(x.key) ? "on" : ""}" data-a="g-hab" data-v="${x.key}">${esc(habitName(x, c.st))}</button>`).join("")}</div></div>
    <div class="f2"><label class="f" for="g-target">${g.kind === "streak" ? "Дней подряд" : "Нужно дней"}<input class="in num" type="number" min="1" id="g-target" value="${g.target || 10}"></label>${g.kind === "count" ? `<label class="f" for="g-win">Из последних, дн.<input class="in num" type="number" min="1" id="g-win" value="${g.window || 7}"></label>` : ""}</div>
    <div class="xs dim">Прогресс считается сам по отметкам привычек.</div>`;
  }
  const subs = g.subtasks || [];
  h += `<div class="f"><span class="small muted">Шаги${g.kind !== "subtasks" ? " (необязательно)" : ""}</span><div>${subs.map((s, i) => { const sod = !s.done && s.deadline && s.deadline < c.today; return `<div class="row" style="padding:8px 0;border-top:1px solid var(--line);gap:8px;align-items:flex-start"><button data-a="g-stog" data-i="${i}" aria-label="Шаг выполнен" style="margin-top:6px"><span class="tick round ${s.done ? "done" : sod ? "missed" : ""}">${ic("check")}</span></button><div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0"><input class="in" data-sub="${i}" value="${esc(s.title)}" style="height:36px;${s.done ? "text-decoration:line-through;color:var(--dim)" : ""}" aria-label="Шаг"><div class="row" style="gap:6px"><span class="xs dim">срок</span><input class="in num" type="date" data-subd="${i}" value="${esc(s.deadline || "")}" style="width:150px;height:30px;padding:0 8px;font-size:13px;${sod ? "color:var(--bad);border-color:#7f1d1d" : ""}" aria-label="Срок шага"><span class="grow"></span><button class="dim" data-a="g-sdel" data-i="${i}" aria-label="Удалить шаг">${ic("trash").replace("<svg", '<svg width="16" height="16"')}</button></div></div></div>`; }).join("")}</div>
    <div class="row"><input class="in" id="g-new" placeholder="Новый шаг"><button class="btn" data-a="g-sadd">Добавить</button></div></div>`;
  h += `<div class="row wrap" style="gap:8px">${g.id ? `<button class="btn danger" data-a="g-del">${SH.del ? "Точно удалить?" : ic("trash")}</button><button class="btn" data-a="g-arch">${g.archived ? "Вернуть из архива" : "В архив"}</button>` : ""}<button class="btn primary" data-a="g-save" style="flex:1">Сохранить</button></div>`;
  if (g.history && g.history.length) h += `<details><summary class="small muted" style="cursor:pointer">История изменений · ${g.history.length}</summary><div>${g.history.slice(0, 30).map((x) => `<div class="small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="num dim">${new Date(x.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> · <b>${x.by === "claude" ? "Claude" : "Ты"}</b> · ${esc(x.what)}</div>`).join("")}</div></details>`;
  return h;
}
function readGoal() {
  const g = SH.g; g.title = $("#g-title").value.trim(); g.criterion = $("#g-crit").value.trim(); g.deadline = $("#g-dl").value || null; g.sphere = $("#g-sph").value || null;
  if ($("#g-target")) g.target = Math.max(1, parseInt($("#g-target").value, 10) || 1);
  if ($("#g-win")) g.window = Math.max(1, parseInt($("#g-win").value, 10) || 7);
  document.querySelectorAll("[data-sub]").forEach((el) => { const s = g.subtasks[+el.dataset.sub]; if (s) s.title = el.value; });
  document.querySelectorAll("[data-subd]").forEach((el) => { const s = g.subtasks[+el.dataset.subd]; if (s) s.deadline = el.value || null; });
}
function rerenderGoal() { readGoal(); setSheet(goalForm()); }
function goalDiff(a, b) {
  if (!a) return "Цель создана";
  const ch = []; const f = (k, l, fmt) => { if ((a[k] ?? "") !== (b[k] ?? "")) ch.push(l + ": " + (fmt ? fmt(a[k]) : a[k] || "—") + " → " + (fmt ? fmt(b[k]) : b[k] || "—")); };
  f("title", "название"); f("criterion", "критерий"); f("deadline", "дедлайн", (x) => (x ? fmtDate(x, "short") : "—")); f("stage", "этап"); f("kind", "тип"); f("target", "цель, дней"); f("window", "окно, дней"); f("sphere", "сфера");
  if ((a.habits || []).join() !== (b.habits || []).join()) ch.push("привычки");
  const at = (a.subtasks || []).map((s) => s.id), bt = (b.subtasks || []).map((s) => s.id);
  (b.subtasks || []).filter((s) => !at.includes(s.id)).forEach((s) => ch.push("добавлен шаг «" + s.title + "»"));
  (a.subtasks || []).filter((s) => !bt.includes(s.id)).forEach((s) => ch.push("удалён шаг «" + s.title + "»"));
  (b.subtasks || []).forEach((s) => { const o = (a.subtasks || []).find((x) => x.id === s.id); if (o && o.title !== s.title) ch.push("шаг «" + o.title + "» → «" + s.title + "»"); if (o && (o.deadline || "") !== (s.deadline || "")) ch.push("срок шага «" + s.title + "»"); });
  return ch.length ? "Изменено: " + ch.join("; ") : null;
}

/* ---------- привычка ---------- */
function openHabit(key) {
  const st = S.st; const x = key ? clone(st.habits.find((h) => h.key === key)) : { key: null, name: "", type: "check", sphere: st.spheres[0], sched: { t: "daily" }, active: true };
  SH = { kind: "habit", x, del: false }; openSheet(habitForm());
}
function habitForm() {
  const x = SH.x, st = S.st, s = x.sched || { t: "daily" }; const c = ctx();
  const cyc = s.t === "cycle"; let dayN = 1; if (cyc) { const p = s.p || "1"; const a = s.a || c.st.startDate; dayN = ((idxOf(c.today) - idxOf(a)) % p.length + p.length) % p.length + 1; }
  return `${sheetHead(x.key ? "Привычка" : "Новая привычка")}
  <label class="f" for="h-name">Название<input class="in" id="h-name" value="${esc(x.name)}" placeholder="Например: Чтение 20 минут"></label>
  ${/\{/.test(x.name) ? '<div class="xs dim">{bed}, {waterL}, {proteinG}, {studyH} подставляются из норм.</div>' : ""}
  <label class="f" for="h-sph">Сфера<select class="in" id="h-sph">${st.spheres.map((sp) => `<option ${x.sphere === sp ? "selected" : ""}>${esc(sp)}</option>`).join("")}</select></label>
  ${x.type !== "check" ? `<div class="xs dim">Тип: ${{ sleep: "отбой, считается из сна", water: "вода стаканами", protein: "КБЖУ + белок" }[x.type]}</div>` : ""}
  <div class="f"><span class="small muted">График</span><div class="seg">${[["daily", "Каждый день"], ["every", "Раз в N дн."], ["cycle", "Цикл"]].map(([t, l]) => `<button data-a="h-sched" data-v="${t}" class="${s.t === t ? "on" : ""}">${l}</button>`).join("")}</div></div>
  ${s.t === "every" ? `<label class="f" for="h-n">Каждые N дней (2 = через день)<input class="in num" type="number" min="2" id="h-n" value="${s.n || 2}"></label><div class="xs dim">День занятия, если за последние N−1 дней не было отметки. Пропустил — привычка ждёт тебя на следующий день.</div>` : ""}
  ${cyc ? `<div class="f2"><label class="f" for="h-p">Шаблон (1 — делать, 0 — отдых)<input class="in num" id="h-p" value="${esc(s.p || "11010")}"></label><label class="f" for="h-day">Сегодня — день цикла<input class="in num" type="number" min="1" id="h-day" value="${dayN}"></label></div>` : ""}
  <div class="row"><button class="tog ${x.active !== false ? "on" : ""}" data-a="h-act">${x.active !== false ? "Включена" : "Выключена"}</button><span class="xs dim">Выключенные не отмечаются и не портят статистику.</span></div>
  <div class="row" style="gap:8px">${x.key ? `<button class="btn danger" data-a="h-del">${SH.del ? "Точно удалить?" : ic("trash")}</button>` : ""}<button class="btn primary" data-a="h-save" style="flex:1">Сохранить</button></div>`;
}
function readHabit() {
  const x = SH.x; x.name = $("#h-name").value.trim(); x.sphere = $("#h-sph").value;
  const s = x.sched = x.sched || { t: "daily" };
  if (s.t === "every" && $("#h-n")) s.n = Math.max(2, parseInt($("#h-n").value, 10) || 2);
  if (s.t === "cycle" && $("#h-p")) { s.p = ($("#h-p").value.replace(/[^01]/g, "") || "1"); const d = Math.max(1, parseInt($("#h-day").value, 10) || 1); s.a = addDays(logicalNow().key, -((d - 1) % s.p.length)); }
}

/* ===== Claude: разбор и команды (capability sample) ===== */
function dataSummary(nDays) {
  const c = ctx(); const hs = activeHabits(c.st);
  const out = { today: c.today, weekday: fmtDate(c.today).split(",")[0], now: fmtHM(logicalNow().min), targets: c.st.targets, days: [] };
  for (let i = 0; i < nDays; i++) {
    const k = addDays(c.today, -i); if (k < c.st.startDate) break;
    const n = parseNight(S.days[k]?.sleep); const e = energy(k); const hab = {};
    hs.forEach((h) => (hab[habitName(h, c.st)] = habitStatus(h, k, c)));
    const ts = tasksOn(k);
    out.days.push({ date: k, sleep: n ? { bed: fmtHM(n.bed), wake: fmtHM(n.wake), hours: +(n.dur / 60).toFixed(1), quality: n.q } : "не отмечен", energyAvg: e.avg, score: dayScore(k, c)?.pct ?? null, studyMin: S.days[k]?.h?.studyMin ?? null, habits: hab, tasksDone: ts.filter((t) => t.done).map((t) => t.title), tasksNotDone: ts.filter((t) => !t.done).map((t) => t.title + (t.start ? " (" + t.start + ", " + (t.energy || "steady") + ")" : "")), feel: (S.days[k]?.feel || []).map((f) => f.t + " " + f.v), backfill: !!S.days[k]?.backfill });
  }
  out.missRuns = hs.map((h) => ({ habit: habitName(h, c.st), daysInRow: missRun(h, c) })).filter((x) => x.daysInRow >= 2);
  out.streaks = hs.map((h) => ({ habit: habitName(h, c.st), current: streakOf([h.key], c) }));
  out.overdueTasks = allTasks().filter((t) => !t.done && t.date && t.date < c.today).map((t) => ({ title: t.title, date: t.date }));
  out.goals = Object.values(S.goals).filter((g) => !g.archived).map((g) => { const p = goalProgress(g, c); return { title: g.title, criterion: g.criterion, stage: g.stage === 2 ? "следующий этап" : "база", progress: p.pct + "%", detail: p.label, deadline: g.deadline, overdue: goalOverdue(g, c), overdueSteps: (g.subtasks || []).filter((s) => !s.done && s.deadline && s.deadline < c.today).map((s) => s.title), nextSteps: (g.subtasks || []).filter((s) => !s.done).slice(0, 3).map((s) => s.title + (s.deadline ? " (до " + s.deadline + ")" : "")) }; });
  const win = (k) => energy(k).windows.filter((w) => w.end - w.start >= 30).map((w) => ZN[w.zone] + " " + fmtHM(w.start) + "–" + fmtHM(w.end));
  out.energyWindowsToday = win(c.today); out.energyWindowsTomorrow = win(addDays(c.today, 1));
  const tr = energy(addDays(c.today, 1)).train; out.trainWindowTomorrow = tr ? fmtHM(tr.start) + "–" + fmtHM(tr.end) : null;
  out.tomorrowTasks = tasksOn(addDays(c.today, 1)).map((t) => t.title + (t.start ? " " + t.start : ""));
  return out;
}
const PERSONA = (st) => ""; /* removed: personal data */
function reviewPrompt(kind) {
  const st = S.st, d = dataSummary(kind === "week" ? 14 : 3);
  if (kind === "week") return `${PERSONA(st)}

Сделай недельный разбор за 7 дней до ${d.today} включительно (данные за 14 дней для сравнения).
Формат строго (Markdown, максимум ~230 слов):
**Неделя в цифрах:** привычки в %, задачи, средний отбой и длительность сна, сравнение с прошлой неделей.
**Главный провал:** 1–2 пункта.
**Где сливаешься:** паттерны (какие дни, какое время, какие сферы).
**Правки целей:** до 3 конкретных предложений (ужесточить, упростить, перенести дедлайн, добавить шаг) с цифрами. Если база не держится, предложи пока ничего не добавлять.
**План на неделю:** 3 пункта.

Данные (JSON):
${JSON.stringify(d)}`;
  return `${PERSONA(st)}

Сделай разбор дня ${d.today} (сейчас ${d.now}).
Формат строго (Markdown, максимум ~170 слов):
**Итог:** одна строка с цифрами, включая рейтинг дня (score, %) и сдвиг к вчера.
**Провалено:**
- пункты
**Сливаешься:** что пропущено 2+ дня подряд, с числом дней. Если нет — «нет».
**Завтра:**
- 3 конкретных шага со временем, привязанные к окнам энергии на завтра (Focus — для сложного).
**Плюс:** одна строка о том, что получилось, если есть.

Данные (JSON):
${JSON.stringify(d)}`;
}

/* --- инструменты для команд --- */
function assistantData() {
  const c = ctx();
  const tasks = allTasks().filter((t) => !t.done && (!t.date || t.date <= addDays(c.today, 14))).map((t) => ({ id: t.id, title: t.title, date: t.date || "inbox", start: t.start, dur: t.dur, energy: t.energy, sphere: t.sphere }));
  const goals = Object.values(S.goals).map((g) => ({ id: g.id, title: g.title, criterion: g.criterion, deadline: g.deadline, stage: g.stage || 1, kind: g.kind, habits: g.habits, target: g.target, window: g.window, archived: !!g.archived, progress: goalProgress(g, c).pct + "%", subtasks: (g.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: !!s.done, deadline: s.deadline || null })) }));
  return { today: c.today, now: fmtHM(logicalNow().min), targets: c.st.targets, spheres: c.st.spheres, habits: c.st.habits.map((h) => ({ key: h.key, name: habitName(h, c.st), active: h.active !== false })), tasks, goals };
}
const TOOLS = [
  { name: "get_data", description: "Свежие данные: задачи (не выполненные, до 14 дней вперёд и входящие) с id, цели с id и шагами, нормы, привычки.", inputSchema: { type: "object", properties: {} }, execute: () => assistantData() },
  { name: "find_slot", description: "Найти лучший свободный слот на дату под тип энергии и длительность.", inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, dur: { type: "number" }, energy: { type: "string", enum: ["focus", "steady", "recharge"] } }, required: ["date", "dur", "energy"] },
    execute: ({ date, dur, energy: en }) => { const s = suggestSlot(date, dur, en); return s ? { start: fmtHM(s.start), end: fmtHM(s.end), zone: s.zone, fit: Math.round(s.fit * 100) + "%" } : { none: true }; } },
  { name: "add_task", description: "Добавить задачу. date: YYYY-MM-DD или 'inbox'. start: HH:MM (необязательно; 00:00–04:59 — это ночь после этого дня). energy: focus (сложное), steady (рутина), recharge (отдых).", inputSchema: { type: "object", properties: { title: { type: "string" }, desc: { type: "string" }, date: { type: "string" }, start: { type: "string" }, dur: { type: "number" }, energy: { type: "string", enum: ["focus", "steady", "recharge"] }, sphere: { type: "string" } }, required: ["title"] },
    execute: (a) => { const t = { id: uid(), title: a.title, desc: a.desc || "", date: !a.date || a.date === "inbox" ? null : a.date, start: a.start || null, dur: a.dur || 30, energy: a.energy || "steady", sphere: a.sphere || null, done: false, createdAt: nowISO(), by: "claude" }; saveTask(t); return { ok: true, id: t.id }; } },
  { name: "update_task", description: "Изменить задачу по id: любые поля, done=true/false отмечает выполнение.", inputSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, desc: { type: "string" }, date: { type: "string" }, start: { type: "string" }, dur: { type: "number" }, energy: { type: "string" }, sphere: { type: "string" }, done: { type: "boolean" } }, required: ["id"] },
    execute: (a) => { const t = clone(S.tasks[a.id]); if (!t) throw new Error("нет задачи " + a.id); for (const k of ["title", "desc", "start", "dur", "energy", "sphere"]) if (a[k] !== undefined) t[k] = a[k] || null; if (a.date !== undefined) t.date = a.date === "inbox" ? null : a.date; if (a.done !== undefined) { t.done = a.done; t.doneAt = a.done ? nowISO() : null; } t.editedBy = "claude"; saveTask(t); return { ok: true }; } },
  { name: "delete_task", description: "Удалить задачу по id.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, execute: ({ id }) => { if (!S.tasks[id]) throw new Error("нет задачи"); deleteTask(id); return { ok: true }; } },
  { name: "add_goal", description: "Создать цель. kind: subtasks (прогресс по шагам), streak (серия дней подряд по привычкам habits, target дней), count (target дней из последних window). stage: 1 — база, 2 — следующий этап.", inputSchema: { type: "object", properties: { title: { type: "string" }, criterion: { type: "string" }, deadline: { type: "string" }, stage: { type: "number" }, sphere: { type: "string" }, kind: { type: "string", enum: ["subtasks", "streak", "count"] }, habits: { type: "array", items: { type: "string" } }, target: { type: "number" }, window: { type: "number" }, subtasks: { type: "array", items: { type: "string" } } }, required: ["title"] },
    execute: (a) => { const g = { id: uid(), title: a.title, criterion: a.criterion || "", deadline: a.deadline || null, stage: a.stage === 2 ? 2 : 1, sphere: a.sphere || null, kind: a.kind || "subtasks", habits: a.habits || [], target: a.target || 10, window: a.window || 7, subtasks: (a.subtasks || []).map((t) => ({ id: uid(), title: t, done: false })), createdAt: nowISO(), order: 50 }; saveGoal(g, "Цель создана", "claude"); return { ok: true, id: g.id }; } },
  { name: "update_goal", description: "Изменить цель по id: title, criterion, deadline (YYYY-MM-DD или пусто), stage, sphere, kind, habits, target, window, archived.", inputSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, criterion: { type: "string" }, deadline: { type: "string" }, stage: { type: "number" }, sphere: { type: "string" }, kind: { type: "string" }, habits: { type: "array", items: { type: "string" } }, target: { type: "number" }, window: { type: "number" }, archived: { type: "boolean" } }, required: ["id"] },
    execute: (a) => { const old = S.goals[a.id]; if (!old) throw new Error("нет цели"); const g = clone(old); for (const k of ["title", "criterion", "stage", "sphere", "kind", "habits", "target", "window", "archived"]) if (a[k] !== undefined) g[k] = a[k]; if (a.deadline !== undefined) g.deadline = a.deadline || null; saveGoal(g, a.archived !== undefined && Object.keys(a).length === 2 ? (a.archived ? "В архив" : "Из архива") : goalDiff(old, g) || "Обновлено", "claude"); return { ok: true }; } },
  { name: "edit_steps", description: "Шаги цели: add — новые шаги (title, deadline?), done/undone — id шагов, remove — id, rename — [{id,title}], deadlines — [{id,deadline}].", inputSchema: { type: "object", properties: { goalId: { type: "string" }, add: { type: "array", items: { type: "object", properties: { title: { type: "string" }, deadline: { type: "string" } } } }, done: { type: "array", items: { type: "string" } }, undone: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } }, rename: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } } }, deadlines: { type: "array", items: { type: "object", properties: { id: { type: "string" }, deadline: { type: "string" } } } } }, required: ["goalId"] },
    execute: (a) => {
      const old = S.goals[a.goalId]; if (!old) throw new Error("нет цели"); const g = clone(old); g.subtasks = g.subtasks || []; const log = [];
      (a.add || []).forEach((s) => { g.subtasks.push({ id: uid(), title: s.title, deadline: s.deadline || null, done: false }); log.push("добавлен шаг «" + s.title + "»"); });
      (a.done || []).forEach((id) => { const s = g.subtasks.find((x) => x.id === id); if (s) { s.done = true; s.doneAt = nowISO(); log.push("выполнен шаг «" + s.title + "»"); } });
      (a.undone || []).forEach((id) => { const s = g.subtasks.find((x) => x.id === id); if (s) { s.done = false; log.push("снята отметка «" + s.title + "»"); } });
      (a.rename || []).forEach((r) => { const s = g.subtasks.find((x) => x.id === r.id); if (s) { log.push("шаг «" + s.title + "» → «" + r.title + "»"); s.title = r.title; } });
      (a.deadlines || []).forEach((r) => { const s = g.subtasks.find((x) => x.id === r.id); if (s) { s.deadline = r.deadline || null; log.push("срок шага «" + s.title + "»"); } });
      (a.remove || []).forEach((id) => { const s = g.subtasks.find((x) => x.id === id); if (s) log.push("удалён шаг «" + s.title + "»"); g.subtasks = g.subtasks.filter((x) => x.id !== id); });
      saveGoal(g, log.join("; ") || "Шаги", "claude"); return { ok: true };
    } },
  { name: "delete_goal", description: "Удалить цель по id (только если пользователь прямо просит удалить; иначе лучше архив).", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, execute: ({ id }) => { if (!S.goals[id]) throw new Error("нет цели"); deleteGoal(id); return { ok: true }; } },
  { name: "set_targets", description: "Изменить нормы: bed (HH:MM), sleepNeed (ч), waterL, glassL, proteinG, studyH.", inputSchema: { type: "object", properties: { bed: { type: "string" }, sleepNeed: { type: "number" }, waterL: { type: "number" }, glassL: { type: "number" }, proteinG: { type: "number" }, studyH: { type: "number" } } },
    execute: (a) => { saveSettings((s) => { s.targets = { ...(s.targets || {}), ...a }; }); return { ok: true }; } },
];

/* --- лист Claude --- */
function openClaude(mode) {
  SH = { kind: "claude", mode: mode || "day", out: "", busy: false, msgs: null, chat: [], abort: null };
  openSheet(claudeForm());
  if (S.sample && (mode === "day" || mode === "week")) runReview(mode);
}
function claudeForm() {
  const s = SH; let h = `${sheetHead("Claude")}<div class="seg">${[["day", "Разбор дня"], ["week", "Неделя"], ["ask", "Попросить"]].map(([m, l]) => `<button data-a="cl-mode" data-v="${m}" class="${s.mode === m ? "on" : ""}">${l}</button>`).join("")}</div>`;
  if (!S.sample) return h + '<div class="alert">Claude недоступен в этом окне. Открой страницу на claude.ai под своим аккаунтом и разреши запросы к Claude.</div>' + pastReviews();
  if (s.mode === "ask") {
    h += `<div class="small muted">Скажи, что поменять: задачи, цели, шаги, нормы. Claude сам внесёт изменения в базу и отметит их в истории как «Claude».</div>
    <div id="cl-chat" style="display:flex;flex-direction:column;gap:10px">${s.chat.map((m) => m.role === "user" ? `<div class="card tight" style="background:var(--card-2);align-self:flex-end;max-width:85%">${esc(m.text)}</div>` : `<div class="md small">${md(m.text)}</div>`).join("")}${s.busy ? `<div class="md small" id="cl-live">${md(s.out || "Думаю…")}</div>` : ""}</div>
    <div class="chips">${["Перенеси всё просроченное на завтра", "Добавь задачу: ДЗ по матану завтра, Focus, 1,5 ч", "Сдвинь дедлайн подготовки к сессии на неделю"].map((q) => `<button class="chip" data-a="cl-q" data-v="${esc(q)}">${esc(q)}</button>`).join("")}</div>
    <div class="row" style="align-items:flex-end"><textarea class="in" id="cl-in" rows="2" placeholder="Например: поменяй цель «Отбой» на 14 дней"></textarea><button class="btn primary" data-a="cl-send" ${s.busy ? "disabled" : ""}>Отправить</button></div>`;
  } else {
    h += `<div class="md small" id="cl-out" style="min-height:60px">${s.out ? md(s.out) : s.busy ? '<span class="dim">Смотрю данные…</span>' : '<span class="dim">Claude посмотрит отметки, сон, задачи и цели и скажет прямо, где провал.</span>'}</div>
    <button class="btn ${s.out ? "" : "primary"} block" data-a="cl-run" ${s.busy ? "disabled" : ""}>${s.busy ? "Разбираю…" : s.out ? "Разобрать заново" : "Сделать разбор"}</button>`;
  }
  return h + pastReviews();
}
function pastReviews() {
  const rs = S.reviews.slice(0, 12); if (!rs.length) return "";
  const kn = { day: "День", week: "Неделя", ask: "Команда" };
  return `<details><summary class="small muted" style="cursor:pointer">Прошлые разборы · ${rs.length}</summary>${rs.map((r) => `<details style="border-top:1px solid var(--line);padding:8px 0"><summary class="small" style="cursor:pointer"><span class="num dim">${esc((r.at || "").slice(5, 16).replace("T", " "))}</span> · ${kn[r.kind] || r.kind}${r.by === "schedule" ? " · по расписанию" : ""}</summary><div class="md small" style="margin-top:6px">${md(r.text || "")}</div></details>`).join("")}</details>`;
}
async function runReview(kind) {
  if (!S.sample || SH.busy) return; SH.busy = true; SH.out = ""; SH.abort = new AbortController(); setSheet(claudeForm());
  try {
    const res = await S.sample(reviewPrompt(kind), { modelTier: kind === "week" ? "complex" : "default", signal: SH.abort.signal, onText: ({ text }) => { if (SH && SH.kind === "claude") { SH.out = text; const o = $("#cl-out"); if (o) o.innerHTML = md(text); } } });
    if (!SH || SH.kind !== "claude") return; SH.out = res.text; SH.busy = false; setSheet(claudeForm());
    saveReview({ at: nowISO(), kind, date: logicalNow().key, text: res.text, by: "app" });
  } catch (e) { if (!SH || SH.kind !== "claude") return; SH.busy = false; SH.out = (e && e.text) || ""; setSheet(claudeForm()); if (e && e.code === "not_granted") { S.sample = null; } toast(e && e.code === "rate_limited" ? "Слишком часто, подожди минуту" : "Claude не ответил: " + (e && (e.message || e.code) || "ошибка")); }
}
async function sendAsk(text) {
  if (!S.sample || SH.busy || !text.trim()) return;
  SH.chat.push({ role: "user", text }); SH.busy = true; SH.out = ""; SH.abort = new AbortController();
  const msgs = SH.msgs ? [...SH.msgs, { role: "user", content: text }] : [{ role: "user", content: `${PERSONA(S.st)}

Сейчас ты в режиме команд: пользователь просит изменить его данные. Делай ровно то, что просят, через инструменты. Если просьба неоднозначна (непонятно, какая задача или цель), спроси, ничего не меняя. Время задач ставь в окна энергии (find_slot), если время не указано. Даты пиши как YYYY-MM-DD. После изменений коротко перечисли, что сделал.

Текущие данные (JSON):
${JSON.stringify(assistantData())}

Просьба: ${text}` }];
  setSheet(claudeForm());
  try {
    const res = await S.sample(msgs, { tools: TOOLS, cache: false, modelTier: "default", signal: SH.abort.signal, onText: ({ text: t }) => { if (SH && SH.kind === "claude") { SH.out = t; const o = $("#cl-live"); if (o) o.innerHTML = md(t); } } });
    if (!SH || SH.kind !== "claude") return;
    SH.msgs = [...msgs, { role: "assistant", content: res.text }]; SH.chat.push({ role: "assistant", text: res.text }); SH.busy = false; SH.out = ""; setSheet(claudeForm());
    saveReview({ at: nowISO(), kind: "ask", date: logicalNow().key, text: "**Просьба:** " + text + "\n\n" + res.text, by: "app" });
  } catch (e) { if (!SH || SH.kind !== "claude") return; SH.busy = false; SH.chat.push({ role: "assistant", text: (e && e.text) || "Не получилось: " + (e && (e.message || e.code) || "ошибка") }); setSheet(claudeForm()); }
}

/* ===== actions ===== */
function go(v) { if (!VIEWS.includes(v)) v = "day"; S.view = v; if (location.hash !== "#" + v) { try { history.replaceState(null, "", "#" + v); } catch (e) { location.hash = v; } } renderView(); window.scrollTo({ top: 0 }); if (v === "day") { S.scrolled = false; requestAnimationFrame(() => { S.scrolled = true; scrollToNow(); }); } }
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== S.view) go(v); });

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-a]"); if (!el) return;
  const a = el.dataset.a, d = el.dataset; const c = ctx();
  if (a === "scrim") { if (ev.target === el) closeSheet(); return; }
  switch (a) {
    case "nav": return go(d.v);
    case "close": return closeSheet();
    case "add": return openTask(null);
    case "addat": return openTask(null, { date: S.dayKey, start: fmtHM(+d.m), dur: Math.min(60, +d.g) });
    case "dprev": S.dayKey = addDays(S.dayKey, -1); S.scrolled = false; return renderView();
    case "dnext": S.dayKey = addDays(S.dayKey, 1); S.scrolled = false; return renderView();
    case "dtoday": S.dayKey = c.today; S.scrolled = false; return renderView();
    case "sleep": return openSleep();
    case "claude": return openClaude(d.m || (S.view === "stats" ? "week" : "day"));
    /* привычки */
    case "hab": { const k = S.dayKey; return saveDay(k, (x) => { x.h[d.k] = !x.h[d.k]; }); }
    case "water": { const k = S.dayKey; return saveDay(k, (x) => { x.h[d.k] = Math.max(0, (x.h[d.k] || 0) + (+d.d)); }); }
    case "study": { const k = S.dayKey, need = studyNeed(c.st); return saveDay(k, (x) => { const m = Math.max(0, (x.h.studyMin != null ? x.h.studyMin : 0) + (+d.d)); x.h.studyMin = m; x.h.study = m >= need; }); }
    case "phr": S.phr = (S.phr || 0) + 1; return renderView();
    case "kbju": return saveDay(S.dayKey, (x) => { x.h.kbju = !x.h.kbju; });
    case "prot": return saveDay(S.dayKey, (x) => { x.h.proteinOk = !x.h.proteinOk; if (x.h.proteinOk && !x.h.proteinG) x.h.proteinG = c.st.targets.proteinG; if (!x.h.proteinOk) delete x.h.proteinG; });
    case "feel": return feel(d.v);
    /* задачи */
    case "ttoggle": { const t = clone(S.tasks[d.id]); if (!t) return; t.done = !t.done; t.doneAt = t.done ? nowISO() : null; saveTask(t); return toast(t.done ? "Готово" : "Вернул в работу"); }
    case "topen": return openTask(d.id);
    case "slot": { const t = clone(S.tasks[d.id]); if (!t) return; const s = suggestSlot(t.date || c.today, t.dur, t.energy, t.id); if (!s) return toast("Свободного окна нет"); t.date = t.date || c.today; t.start = fmtHM(s.start); saveTask(t); return toast("Поставил на " + fmtHM(s.start) + " · " + (ZN[s.zone] || "")); }
    case "ttab": S.taskTab = d.v; return renderView();
    case "movetoday": { allTasks().filter((t) => !t.done && t.date && t.date < c.today).forEach((t) => { const x = clone(t); x.date = c.today; x.start = null; saveTask(x, true); }); renderView(); return toast("Перенёс на сегодня, раскидай по слотам"); }
    case "f-date": SH.t.date = d.v || null; $("#f-dated").value = ""; return rerenderTask();
    case "f-dur": SH.t.dur = +d.v; $("#f-dur").value = d.v; return rerenderTask();
    case "f-en": SH.t.energy = d.v; return rerenderTask();
    case "f-sph": SH.t.sphere = SH.t.sphere === d.v ? null : d.v; return rerenderTask();
    case "f-slot": if (SH.slot) { $("#f-start").value = fmtHM(SH.slot.start); toast("Время: " + fmtHM(SH.slot.start)); } return;
    case "f-save": return saveTaskForm();
    case "f-done": { readTask(); SH.t.done = !SH.t.done; SH.t.doneAt = SH.t.done ? nowISO() : null; saveTask(SH.t); return closeSheet(); }
    case "f-del": if (!SH.del) { SH.del = true; return rerenderTask(); } deleteTask(SH.t.id); closeSheet(); return toast("Задача удалена");
    /* сон */
    case "sl-act": SH.act = d.v; setSheet(sleepForm()); return bindDial();
    case "sl-step": SH[SH.act] = ((SH[SH.act] + (+d.v)) % 1440 + 1440) % 1440; setSheet(sleepForm()); return bindDial();
    case "sl-q": SH.q = d.v; setSheet(sleepForm()); return bindDial();
    case "sl-save": { const s = SH; saveDay(s.k, (x) => { x.sleep = { bed: fmtHM(s.bed), wake: fmtHM(s.wake), q: s.q }; }); closeSheet(); return toast("Сон сохранён, энергия пересчитана"); }
    /* цели */
    case "gopen": return openGoal(d.id);
    case "gnew": return openGoal(null);
    case "g-stage": SH.g.stage = +d.v; return rerenderGoal();
    case "g-kind": SH.g.kind = d.v; return rerenderGoal();
    case "g-hab": { readGoal(); const hs = SH.g.habits = SH.g.habits || []; const i = hs.indexOf(d.v); if (i >= 0) hs.splice(i, 1); else hs.push(d.v); return setSheet(goalForm()); }
    case "g-sadd": { readGoal(); const v = $("#g-new").value.trim(); if (!v) return; SH.g.subtasks = SH.g.subtasks || []; SH.g.subtasks.push({ id: uid(), title: v, done: false }); setSheet(goalForm()); return $("#g-new").focus(); }
    case "g-sdel": readGoal(); SH.g.subtasks.splice(+d.i, 1); return setSheet(goalForm());
    case "g-stog": {
      readGoal(); const s = SH.g.subtasks[+d.i]; if (!s) return; s.done = !s.done; s.doneAt = s.done ? nowISO() : null;
      if (SH.g.id && S.goals[SH.g.id]) { const st = clone(S.goals[SH.g.id]); const o = (st.subtasks || []).find((x) => x.id === s.id); if (o) { o.done = s.done; o.doneAt = s.doneAt; saveGoal(st, (s.done ? "Выполнен шаг «" : "Снята отметка «") + o.title + "»"); SH.g.history = clone(S.goals[SH.g.id].history); } }
      return setSheet(goalForm());
    }
    case "g-save": {
      readGoal(); const g = SH.g; if (!g.title) { toast("Напиши название цели"); return $("#g-title").focus(); }
      const old = g.id ? S.goals[g.id] : null; if (!g.id) { g.id = uid(); g.createdAt = nowISO(); g.order = 50; }
      const diff = goalDiff(old, g); saveGoal(g, diff); closeSheet(); return toast(old ? "Цель сохранена" : "Цель создана");
    }
    case "g-arch": { readGoal(); const g = SH.g; g.archived = !g.archived; saveGoal(g, g.archived ? "Перенесена в архив" : "Возвращена из архива"); closeSheet(); return; }
    case "g-del": if (!SH.del) { SH.del = true; return rerenderGoal(); } deleteGoal(SH.g.id); closeSheet(); return toast("Цель удалена");
    /* итоги и настройки */
    case "sn": S.statsN = +d.v; return renderView();
    case "hedit": return openHabit(d.k);
    case "hnew": return openHabit(null);
    case "h-sched": { readHabit(); const t = d.v; SH.x.sched = t === "every" ? { t, n: 2 } : t === "cycle" ? { t, p: "11010", a: c.today } : { t: "daily" }; return setSheet(habitForm()); }
    case "h-act": readHabit(); SH.x.active = SH.x.active === false; return setSheet(habitForm());
    case "h-save": {
      readHabit(); const x = SH.x; if (!x.name) return toast("Напиши название");
      if (!x.key) x.key = "h_" + uid();
      saveSettings((s) => { s.habits = s.habits || clone(DEFAULT_SETTINGS.habits); const i = s.habits.findIndex((h) => h.key === x.key); if (i >= 0) s.habits[i] = x; else s.habits.push(x); });
      closeSheet(); return toast("Привычка сохранена");
    }
    case "h-del": if (!SH.del) { SH.del = true; return setSheet(habitForm()); } { const key = SH.x.key; saveSettings((s) => { s.habits = (s.habits || []).filter((h) => h.key !== key); }); closeSheet(); return toast("Привычка удалена"); }
    case "sdel": return saveSettings((s) => { s.spheres = (s.spheres || []).filter((_, i) => i !== +d.i); });
    case "sadd": { const v = $("#newSphere").value.trim(); if (!v) return; if (S.st.spheres.includes(v)) return toast("Такая сфера уже есть"); return saveSettings((s) => { s.spheres = [...(s.spheres || []), v]; }); }
    case "gopast": { const v = $("#pastDay").value; if (!v) return; S.dayKey = v > c.today ? c.today : v; S.scrolled = false; return go("day"); }
    case "mreset": return saveSettings((s) => { s.model = { bias: [0, 0, 0, 0], n: 0 }; });
    case "export": { const data = JSON.stringify({ settings: S.st, days: S.days, tasks: S.tasks, goals: S.goals }, null, 1); navigator.clipboard.writeText(data).then(() => toast("Скопировано"), () => toast("Буфер обмена недоступен")); return; }
    /* claude */
    case "cl-mode": SH.mode = d.v; setSheet(claudeForm()); if (d.v !== "ask" && !SH.out && !SH.busy) runReview(d.v); return;
    case "cl-run": return runReview(SH.mode);
    case "cl-q": { const i = $("#cl-in"); if (i) { i.value = d.v; i.focus(); } return; }
    case "cl-send": { const i = $("#cl-in"); const v = i ? i.value : ""; if (i) i.value = ""; return sendAsk(v); }
  }
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.a === "target") {
    const k = el.dataset.k, v = el.value; if (v === "") return;
    if (el.id.startsWith("u-")) return saveSettings((s) => { s.usual = { ...(s.usual || {}), [k]: v }; });
    return saveSettings((s) => { s.targets = { ...(s.targets || {}), [k]: el.type === "number" ? parseFloat(v) : v }; });
  }
  if (el.id === "f-dated" && SH && SH.kind === "task") { SH.t.date = el.value || SH.t.date; rerenderTask(); }
  if ((el.id === "f-dur" || el.id === "f-start") && SH && SH.kind === "task") { readTask(); refreshSlot(); }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && SH) closeSheet();
  if (ev.key === "Enter" && ev.target.id === "g-new") { ev.preventDefault(); $("[data-a=g-sadd]").click(); }
  if (ev.key === "Enter" && ev.target.id === "newSphere") { ev.preventDefault(); $("[data-a=sadd]").click(); }
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && ev.target.id === "cl-in") { ev.preventDefault(); $("[data-a=cl-send]").click(); }
});

function feel(v) {
  const k = logicalNow().key, nm = logicalNow().min; const e0 = energyDay(k, ctx(), { noFeel: true }); const p = e0.at(Math.floor(nm / 5) * 5);
  if (!p || p.idx == null) return toast("По модели сейчас время сна. Отметь, когда проснёшься.");
  const pred = p.idx, err = FEEL_T[v] - pred; const b = bucketOf(Math.max(0, (nm - e0.wake) / 60));
  saveDay(k, (x) => { x.feel = [...(x.feel || []), { t: fmtHM(nm), v, pred, err }].slice(-12); });
  saveSettings((s) => { const m = s.model || { bias: [0, 0, 0, 0], n: 0 }; const bias = (m.bias || [0, 0, 0, 0]).slice(); bias[b] = clamp((bias[b] || 0) + 0.2 * (FEEL_T[v] - (pred)), -20, 20); s.model = { bias, n: (m.n || 0) + 1 }; });
  toast(Math.abs(err) < 8 ? "Совпало с прогнозом" : err > 0 ? "Ты бодрее прогноза, модель подстроилась" : "Ты ниже прогноза, модель подстроилась");
}

/* старт */
(function start() {
  document.documentElement.lang = "ru";
  const v = location.hash.slice(1); if (VIEWS.includes(v)) S.view = v;
  boot();
  setInterval(() => { const t = logicalNow().key; if (S.view === "day" || S.view === "now") { if (S.dayKey > t) S.dayKey = t; dirty(); if (!SH) renderView(); } }, 60000);
})();
