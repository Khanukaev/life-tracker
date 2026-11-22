// Runs the ORIGINAL functions from reference/legacy.js on every fixture and writes
// golden/expected/<fixture>.json. The Python port (pytest) and later the client copy
// (vitest) are compared against these files.
//
//   node golden/run-legacy.mjs          # regenerate
//   node golden/run-legacy.mjs --check  # fail if the committed expectations are stale
//
// The legacy script is executed unmodified inside a `vm` sandbox. The harness only:
// freezes the clock, stubs the DOM, skips the UI boot IIFE, and exposes `S`.

process.env.TZ = "UTC"; // fixture "now" is local wall-clock time

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const legacySrc = readFileSync(join(here, "../reference/legacy.js"), "utf8");
const bootStart = legacySrc.indexOf("(function start() {");
if (bootStart < 0) throw new Error("boot IIFE not found");
const script = new vm.Script(
  legacySrc.slice(0, bootStart) +
    "\nglobalThis.__S = S; globalThis.__dirty = dirty;\n",
  { filename: "legacy.js" },
);

const noop = () => {};
const fakeEl = () => ({ style: {}, classList: { toggle: noop }, setAttribute: noop, appendChild: noop });

function load(nowIso) {
  const RealDate = Date;
  const fixed = new RealDate(nowIso + ":00").getTime();
  class FrozenDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  }
  const ctx = {
    Date: FrozenDate, Math, JSON, Object, Array, String, Number, Map, Set, Promise, console,
    setTimeout, clearTimeout, setInterval: noop, requestAnimationFrame: noop,
    document: {
      addEventListener: noop, getElementById: () => null, querySelector: () => null,
      querySelectorAll: () => [], createElement: fakeEl, body: fakeEl(), documentElement: {},
    },
    window: { addEventListener: noop, scrollTo: noop },
    location: { hash: "" }, history: { replaceState: noop }, navigator: {},
    claude: { use: () => Promise.reject(new Error("no claude in harness")) },
  };
  vm.createContext(ctx);
  script.runInContext(ctx);
  return ctx;
}

const r6 = (x) => (x == null ? x : Math.round(x * 1e6) / 1e6);
const stripHtml = (s) => s.replace(/<[^>]+>/g, "");

function probe(fx) {
  const g = load(fx.now);
  const S = g.__S;
  S.st = g.withDefaults(fx.settings);
  S.days = fx.days; S.tasks = fx.tasks; S.goals = fx.goals; S.reviews = [];
  g.__dirty();
  const c = g.ctx();
  const today = c.today;
  const ln = g.logicalNow();
  const out = { meta: { today, nowMin: ln.min, startDate: c.st.startDate } };
  const back = (n) => Array.from({ length: n }, (_, i) => g.addDays(today, -i));

  out.nights = {};
  for (let i = -10; i <= 1; i++) { const k = g.addDays(today, i); out.nights[k] = g.nightFor(k, c); }

  out.energy = {};
  for (const k of [g.addDays(today, -1), today, g.addDays(today, 1)]) {
    const e = g.energyDay(k, c);
    out.energy[k] = {
      wake: e.wake, bed: e.bed, avg: e.avg, max: e.max, maxAt: e.maxAt, min: e.min, minAt: e.minAt,
      acro: r6(e.acro), train: e.train && { start: e.train.start, end: e.train.end, score: r6(e.train.score) },
      windows: e.windows.map((w) => [w.zone, w.start, w.end, w.avg]),
      factors: e.factors.map((f) => [f.key, f.val, f.note]),
      pts: e.pts.map((p) => [p.m, p.idx, p.zone, r6(p.raw), r6(p.mel), r6(p.cort), r6(p.mot), r6(p.alert)]),
    };
  }
  out.energyNoFeel = g.energyDay(today, c, { noFeel: true }).pts.map((p) => p.idx);

  const habits = c.st.habits;
  out.habits = {};
  for (const h of habits) {
    const days = back(45);
    out.habits[h.key] = {
      status: Object.fromEntries(days.map((k) => [k, g.habitStatus(h, k, c)])),
      due: Object.fromEntries(days.map((k) => [k, g.habitDue(h, k, c)])),
      streak: g.streakOf([h.key], c),
      streakYesterday: g.streakOf([h.key], c, g.addDays(today, -1)),
      best: g.bestStreak([h.key], c),
      rate7: g.habitRate(h, c, 7), rate30: g.habitRate(h, c, 30),
      missRun: g.missRun(h, c),
    };
  }
  out.spheres = {};
  for (const s of c.st.spheres) {
    const keys = g.activeHabits(c.st).filter((x) => x.sphere === s).map((x) => x.key);
    if (keys.length) out.spheres[s] = { keys, streak: g.streakOf(keys, c), best: g.bestStreak(keys, c) };
  }
  out.goals = {};
  for (const goal of Object.values(fx.goals)) {
    out.goals[goal.id] = { progress: g.goalProgress(goal, c), overdue: g.goalOverdue(goal, c) };
  }
  out.dayScore = {};
  for (const k of back(14)) {
    const sc = g.dayScore(k, c);
    out.dayScore[k] = sc && { pct: sc.pct, W: sc.W, items: sc.items.map((x) => [x.key, x.w, r6(x.v)]) };
  }
  out.tasks = {
    overdue: Object.fromEntries(Object.values(fx.tasks).map((t) => [t.id, g.isOverdue(t, c)])),
    buckets: Object.fromEntries(Object.entries(g.taskBuckets()).map(([b, ts]) => [b, ts.map((t) => t.id)])),
  };
  out.slots = [];
  for (const k of [today, g.addDays(today, 1)])
    for (const dur of [30, 90])
      for (const en of ["focus", "steady", "recharge"]) {
        const s = g.suggestSlot(k, dur, en);
        out.slots.push([k, dur, en, s && { start: s.start, end: s.end, fit: r6(s.fit), avg: s.avg, zone: s.zone }]);
      }
  out.weakSpots = { 7: g.weakSpots(c, 7).map(stripHtml), 30: g.weakSpots(c, 30).map(stripHtml) };
  out.energyLeft = [...stripHtml(g.energyLeft()).matchAll(/(Focus|Steady|Recharge)(.*?) задач \/ (.*?) окна/g)]
    .map((m) => [m[1], m[2], m[3]]);

  // feel(): capture what it would write instead of touching a database.
  out.feel = {};
  for (const v of ["low", "ok", "high"]) {
    let day = null, st = null, msg = null;
    g.saveDay = (k, mut) => { const d = JSON.parse(JSON.stringify(S.days[k] || {})); d.h = d.h || {}; mut(d); day = d.feel; };
    g.saveSettings = (mut) => { const s = JSON.parse(JSON.stringify(S.st)); mut(s); st = s.model; };
    g.toast = (m) => { msg = m; };
    g.feel(v);
    out.feel[v] = { feel: day && day[day.length - 1], model: st && { bias: st.bias.map(r6), n: st.n }, msg };
  }
  out.format = {
    fmtHM: [-30, 0, 59, 61, 1439, 1440, 1501, 1745.6].map((m) => g.fmtHM(m)),
    fmtDur: [0, 5, 60, 61, 125.4, 600].map((m) => g.fmtDur(m)),
    taskMin: ["00:00", "04:59", "05:00", "23:30", "", null].map((s) => g.taskMin(s)),
    fmtDate: [today, "2026-01-01"].map((k) => [g.fmtDate(k), g.fmtDate(k, "short")]),
  };
  return out;
}

const fixturesDir = join(here, "fixtures");
const expectedDir = join(here, "expected");
mkdirSync(expectedDir, { recursive: true });
const check = process.argv.includes("--check");
let stale = 0;
for (const f of readdirSync(fixturesDir).filter((x) => x.endsWith(".json")).sort()) {
  const fx = JSON.parse(readFileSync(join(fixturesDir, f), "utf8"));
  const text = JSON.stringify(probe(fx), null, 1) + "\n";
  const path = join(expectedDir, f);
  if (check) {
    let old = ""; try { old = readFileSync(path, "utf8"); } catch {}
    if (old !== text) { console.error(`stale: ${f}`); stale++; }
  } else {
    writeFileSync(path, text);
    console.log(`expected/${f}`);
  }
}
if (stale) process.exit(1);
