/** «Сегодня»: list and «По часам», every state from the design-v2 Today* artboards. */

import { useEffect, useMemo, useState } from "preact/hooks";
import { BOLT, CHECK, Chevron, ClaudeLogo, FoldCheck, Moon } from "../components/icons";
import { Row, type RowItem } from "../components/Row";
import { countNorm } from "../domain/score";
import { applyPlan, dayKey, nextValue, OVERDUE_KEY, scheduleLabel, setHabitValue, toggleTask } from "../lib/actions";
import { holds } from "../lib/fold";
import { addDays, dur, hhmm, toMin } from "../lib/format";
import { haptic } from "../lib/haptic";
import { canEdit, online } from "../lib/net";
import { dayDate, dayMode, goTab, openDay, openSheet, push } from "../lib/router";
import { refresh, resource } from "../lib/store";
import type { DayTask, DayView, Habit, HabitRow, Me, Review, Settings } from "../lib/types";

const WEEKDAY = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
export const ZONE_LABEL: Record<string, string> = { focus: "Пик", steady: "Нейтрально", recharge: "Восстановление", sleep: "Сон" };
export const ZONE_COLOR: Record<string, string> = { focus: "#a082ff", steady: "#64a0ff", recharge: "#7c7c8a", sleep: "#7c7c8a" };

interface OverdueView {
  counts: { overdue: number };
  items: DayTask[];
}

/** Skeletons only when loading takes longer than ~0.5 s: otherwise the screen just blinks. */
function useSlow(active: boolean, ms = 500): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return setSlow(false);
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active]);
  return slow;
}

const flashed = new Set<string>(); // the 100 % flash plays once per day

export function TodayScreen() {
  const key = dayKey(useDayParam());
  const e = resource<DayView>(key).value;
  const d = e.data;
  const me = resource<Me>("/me").value.data;
  const settings = resource<Settings>("/settings").value.data;
  const habitsMeta = resource<Habit[]>("/habits").value.data;
  const isToday = !d || d.relation === "today";
  const overdue = isToday ? resource<OverdueView>(OVERDUE_KEY).value.data : undefined;
  const slow = useSlow(!d && e.loading);

  if (!d) {
    return (
      <div class="k-page">
        <div class="k-bg" aria-hidden="true" />
        <Header d={undefined} me={me} empty={false} />
        <main class="k-main">
          {!online.value && <OfflineBanner />}
          {e.error && !e.loading && online.value ? (
            <section class="k-card" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <span style={{ fontSize: "16px" }}>Не получилось загрузить день</span>
              <button class="k-pillbtn" style={{ alignSelf: "flex-start" }} onClick={() => void refresh(key)}>
                Повторить
              </button>
            </section>
          ) : (slow || !online.value) ? (
            <Skeleton />
          ) : null}
        </main>
      </div>
    );
  }

  const visibleHabits = d.habits.filter((h) => h.status !== "rest"); // cycle rest days: not shown at all
  const empty = visibleHabits.length === 0 && d.tasks.length === 0;
  const hours = dayMode.value === "hours" && isToday;
  const remindOf = new Map((habitsMeta ?? []).map((h) => [h.id, h.remind_at]));

  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <Header d={d} me={me} empty={empty && isToday} />
      <main class="k-main">
        {!online.value && <OfflineBanner />}
        {hours ? (
          <>
            {!d.sleep && <SleepAsk d={d} empty={empty} />}
            <DayHours d={d} habits={visibleHabits} remindOf={remindOf} settings={settings} />
          </>
        ) : (
          <>
            {d.relation !== "future" && <ScoreBlock d={d} habits={visibleHabits} empty={empty} />}
            {isToday && !d.sleep && <SleepAsk d={d} empty={empty} />}
            {isToday && d.plan && d.plan.items?.length ? <PlanCard plan={d.plan} /> : null}
            {d.sleep && <Stats d={d} settings={settings} />}
            {empty && (
              <section class="k-sum">
                <p class="k-motto">{isToday ? "Здесь будет твой день" : "В этот день ничего не было"}</p>
              </section>
            )}
            {visibleHabits.length > 0 && <HabitsCard d={d} habits={visibleHabits} />}
            {overdue && overdue.counts.overdue > 0 && overdue.items[0] && (
              <button class="k-btnreset k-card k-overdue" aria-label={`Просрочено: ${overdue.counts.overdue}. Открыть план`} onClick={() => goTab("plan")}>
                <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffb340", flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span class="k-cap">Просрочено · {overdue.counts.overdue}</span>
                  <span style={{ fontSize: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {overdue.items[0].title}
                  </span>
                </span>
                <Chevron color="#636366" />
              </button>
            )}
            {d.tasks.length > 0 && <TasksCard tasks={d.tasks} />}
          </>
        )}
      </main>
    </div>
  );
}

/** null = today; any other date comes from the router. */
function useDayParam(): string | null {
  return dayDate.value;
}

// ---------- header ----------

function Header({ d, me, empty }: { d: DayView | undefined; me: Me | undefined; empty: boolean }) {
  const isToday = !d || d.relation === "today";
  const title = isToday ? "Сегодня" : WEEKDAY[new Date(`${d.date}T12:00:00Z`).getUTCDay()]!;
  const approx = isToday && !!d && !d.sleep;
  const energy = d?.energy_now;
  const showEnergy = !!d && energy != null && (d.sleep || !empty) && d.relation !== "future";
  const go = (delta: number) => {
    if (!d) return;
    haptic.selection();
    const next = addDays(d.date, delta);
    openDay(next === d.today ? null : next);
  };
  return (
    <header class="k-head">
      <div class="k-headrow">
        <h1 class="k-h1">{title}</h1>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {showEnergy && (
            <button
              class="k-btnreset k-energy"
              aria-label={`Энергия ${isToday ? "сегодня" : "в этот день"}${approx ? " примерно" : ":"} ${energy} из 100`}
              onClick={() => isToday && openSheet("energy")}
            >
              <span class="k-n">
                <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 14, height: 14, fill: "#c9b8ff" }}>
                  <path d={BOLT} />
                </svg>
                {approx ? "≈" : ""}
                {energy}
              </span>
            </button>
          )}
          <button class="k-btnreset k-avatar" aria-label="Профиль и настройки" onClick={() => push("profile")}>
            <span>{(me?.first_name ?? " ").slice(0, 1).toUpperCase()}</span>
          </button>
        </span>
      </div>
      <div class="k-headrow" style={{ marginTop: "4px" }}>
        {empty || !d ? (
          <span class="k-date" style={{ minHeight: "44px", display: "flex", alignItems: "center" }}>
            {d?.date_label ?? ""}
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", marginLeft: "-12px" }}>
            <button class="k-btnreset k-arrow" aria-label="Предыдущий день" onClick={() => go(-1)}>
              <Chevron dir="left" size={18} />
            </button>
            <span class="k-date">{d.date_label}</span>
            <button class="k-btnreset k-arrow" aria-label="Следующий день" onClick={() => go(1)}>
              <Chevron size={18} />
            </button>
          </div>
        )}
        {isToday ? (
          <div class="k-seg" role="group" aria-label="Вид">
            {(["list", "hours"] as const).map((m) => (
              <button
                key={m}
                aria-pressed={dayMode.value === m}
                onClick={() => {
                  haptic.selection();
                  dayMode.value = m;
                }}
              >
                {m === "list" ? "Список" : "По часам"}
              </button>
            ))}
          </div>
        ) : (
          <button class="k-btnreset k-totoday" onClick={() => openDay(null)}>
            К сегодня
          </button>
        )}
      </div>
    </header>
  );
}

function OfflineBanner() {
  return (
    <div class="k-offline" role="status">
      <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, color: "#aeaeb2" }}>
        <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.4-1.8M2 9.5a15 15 0 0 1 4.3-2.6M22 9.5A15 15 0 0 0 11 6M12 20h.01" />
      </svg>
      <span>Нет связи. Показываю последние данные — отметить и изменить можно будет, когда появится сеть</span>
    </div>
  );
}

// ---------- score with the progress glow ----------

function ScoreBlock({ d, habits, empty }: { d: DayView; habits: HabitRow[]; empty: boolean }) {
  const pct = d.score?.pct ?? 0;
  const total = habits.length + d.tasks.length;
  const bed = bedResult(d);
  const done =
    habits.filter((h) => (h.type === "bedtime" ? bed === "done" : h.status === "done")).length + d.tasks.filter((t) => t.done).length;
  const n = empty ? 8 : Math.min(total, 24);
  const on = empty ? 0 : total ? Math.round((done / total) * n) : 0;
  // Glow: none below 75 %, green at 75–99 %, green-cyan at 100 % with one short flash.
  const level = empty ? 0 : pct >= 100 ? 2 : pct >= 75 ? 1 : 0;
  const flash = useMemo(() => level === 2 && !flashed.has(d.date) && !!flashed.add(d.date), [level === 2, d.date]);
  const barGlow = level === 2 ? "0 0 16px rgba(105,255,121,0.85)" : level === 1 ? "0 0 12px rgba(105,255,121,0.61)" : undefined;
  return (
    <section class="k-score">
      {level > 0 && (
        <div
          aria-hidden="true"
          class="k-glow"
          style={{
            background:
              level === 2
                ? "radial-gradient(200px 130px at 22% 62%, rgba(105,255,121,0.28), transparent 70%), radial-gradient(180px 110px at 82% 62%, rgba(92,225,230,0.23), transparent 70%)"
                : "radial-gradient(200px 130px at 22% 62%, rgba(105,255,121,0.19), transparent 70%), radial-gradient(180px 110px at 82% 62%, rgba(105,255,121,0.16), transparent 70%)",
          }}
        />
      )}
      {flash && (
        <div
          aria-hidden="true"
          class="k-glow k-dayflash"
          style={{
            background:
              "radial-gradient(240px 160px at 24% 60%, rgba(105,255,121,0.45), transparent 70%), radial-gradient(220px 140px at 80% 60%, rgba(92,225,230,0.38), transparent 70%)",
          }}
        />
      )}
      <span class="k-lab">Итог дня</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
        <span
          class="k-n k-pct"
          style={level ? { textShadow: level === 2 ? "0 0 46px rgba(105,255,121,0.70)" : "0 0 34px rgba(105,255,121,0.48)" } : undefined}
        >
          {pct}
          <small>%</small>
        </span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", paddingBottom: "8px" }}>
          <span class="k-bars" role="img" aria-label={`Сделано ${done} из ${total}`}>
            {Array.from({ length: n }, (_, i) => (
              <i key={i} class={i < on ? "on" : ""} style={i < on && barGlow ? { boxShadow: barGlow } : undefined} />
            ))}
          </span>
          <span class="k-cap k-n">{empty ? "пока пусто" : `${done} из ${total} дел`}</span>
        </div>
      </div>
    </section>
  );
}

function SleepAsk({ d, empty }: { d: DayView; empty: boolean }) {
  return (
    <section class="k-card k-ask">
      <Moon />
      <span class="txt">
        <span style={{ fontSize: "16px", fontWeight: 500 }}>Как ты спал?</span>
        <span class="k-cap" style={{ lineHeight: "17px" }}>
          {empty ? "Отметь сон — появится балл энергии" : "Отметь сон — энергия посчитается точнее"}
        </span>
      </span>
      <button class="k-pillbtn" onClick={() => canEdit() && openSheet("sleep", { date: d.date })}>
        Отметить
      </button>
    </section>
  );
}

function planRange(start: string | null | undefined, durMin = 30): string {
  if (!start) return "днём";
  const s = toMin(start)!;
  return durMin >= 60 ? `${start}–${hhmm(s + durMin)}` : start;
}

function PlanCard({ plan }: { plan: Review }) {
  const at = new Date(plan.at);
  return (
    <section class="k-sum claude">
      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <ClaudeLogo />
        <span style={{ flex: 1, fontSize: "15px", fontWeight: 600 }}>План на сегодня</span>
        <span class="k-cap k-n">{`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`}</span>
      </span>
      <ol class="k-plan">
        {plan.items!.map((it, i) => (
          <li key={i}>
            <span class="k-n">{planRange(it.start, it.dur)}</span>
            <span>
              {it.title}
              {it.note ? ` — ${it.note}` : ""}
            </span>
          </li>
        ))}
      </ol>
      <span class="k-pair">
        <button class="pri" onClick={() => void applyPlan(plan)}>
          Добавить в день
        </button>
        <button class="sec" onClick={() => push("claude")}>
          Подробнее
        </button>
      </span>
    </section>
  );
}

function zoneAt(d: DayView, min: number) {
  return d.timeline.zones.find((z) => z.start <= min && min < z.end) ?? null;
}

function Stats({ d, settings }: { d: DayView; settings: Settings | undefined }) {
  const s = d.sleep!;
  const need = (settings?.sleep_need_h ?? 8) * 60;
  const sleepCap = d.relation === "today" ? (s.duration_min >= need - 10 ? "сон, в норме" : "сон, меньше нормы") : `сон, отбой в ${s.bed}`;
  let eb: string;
  let ec: string;
  if (d.relation === "today") {
    const z = d.now_min != null ? zoneAt(d, d.now_min) : null;
    if (!z) [eb, ec] = ["Сон", "энергия сейчас"];
    else if (z.zone === "focus") [eb, ec] = [`Пик до ${hhmm(z.end)}`, "энергия сейчас"];
    else if (z.zone === "recharge") [eb, ec] = ["Восстановление", `энергия, с ${hhmm(z.start)}`];
    else [eb, ec] = ["Нейтрально", `энергия, до ${hhmm(z.end)}`];
  } else {
    const main = [...d.timeline.zones].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    [eb, ec] = [ZONE_LABEL[main?.zone ?? "steady"] ?? "Нейтрально", "энергия днём"];
  }
  const isToday = d.relation === "today";
  return (
    <section class="k-card k-stats">
      <button class="k-btnreset k-stat" onClick={() => isToday && canEdit() && openSheet("sleep", { date: d.date })}>
        <b class="k-n">{dur(s.duration_min)}</b>
        <span class="k-cap">{sleepCap}</span>
      </button>
      <button class="k-btnreset k-stat" onClick={() => isToday && openSheet("energy")}>
        <b>{eb}</b>
        <span class="k-cap">{ec}</span>
      </button>
    </section>
  );
}

// ---------- cards with folding ----------

interface Entry {
  id: string;
  item: RowItem;
  closed: boolean;
  counts: boolean; // closed and actually done (a missed bedtime is closed, not done)
  tick?: () => void;
  open: () => void;
}

function FoldCard({ title, entries }: { title: string; entries: Entry[] }) {
  const [unfolded, setUnfolded] = useState(false);
  const h = holds.value;
  const open = entries.filter((x) => !x.closed || h[x.id]);
  const closed = entries.filter((x) => x.closed && !h[x.id]);
  const list = unfolded ? [...open, ...closed] : open;
  return (
    <section class="k-card clip">
      <div class="k-cardhead">
        <h2 class="k-h2">{title}</h2>
        <span class="k-n">
          {entries.filter((x) => x.counts).length} из {entries.length}
        </span>
      </div>
      {list.map((x) => (
        <Row key={x.id} item={x.item} onTick={x.tick} onOpen={x.open} phase={h[x.id]} />
      ))}
      {closed.length > 0 && (
        <button
          class={`k-btnreset k-fold${open.length || unfolded ? "" : " only"}`}
          aria-expanded={unfolded}
          onClick={() => {
            haptic.selection();
            setUnfolded(!unfolded);
          }}
        >
          <FoldCheck />
          <span class="k-n" style={{ flex: 1, fontSize: "15px" }}>
            {open.length ? `Отмечено · ${closed.length}` : `Всё отмечено · ${closed.length}`}
          </span>
          <span style={{ fontSize: "15px", color: "#8e8e93" }}>{unfolded ? "Скрыть" : "Показать"}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 14, height: 14, fill: "none", stroke: "#636366", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", transform: `rotate(${unfolded ? 180 : 0}deg)`, transition: "transform .2s ease-out" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </section>
  );
}

/** The bedtime row shows last night (the one that ended this morning): its score item is 1
 * exactly when the user went to bed by the target. Not logged yet → undecided. */
export function bedResult(d: DayView): "done" | "miss" | undefined {
  if (!d.sleep) return undefined;
  const v = d.score?.items.find((x) => x.kind === "sleep")?.v;
  return v == null ? undefined : v >= 1 ? "done" : "miss";
}

export function habitMeta(h: HabitRow, d: DayView): string {
  if (h.type === "bedtime") return d.sleep ? `прошлая ночь, лёг в ${d.sleep.bed}` : "отметится, когда отметишь сон";
  if (h.type === "count") return `${Number(h.value) || 0} из ${countNorm(h.config)}`;
  return scheduleLabel(h.schedule);
}

function HabitsCard({ d, habits }: { d: DayView; habits: HabitRow[] }) {
  const sorted = [...habits.filter((h) => h.type === "bedtime"), ...habits.filter((h) => h.type !== "bedtime")];
  const entries: Entry[] = sorted.map((h) => {
    const result = h.type === "bedtime" ? bedResult(d) : undefined;
    const done = h.type === "bedtime" ? result === "done" : h.status === "done";
    return {
      id: h.id,
      closed: h.type === "bedtime" ? !!result : done,
      counts: done,
      item: { kind: h.type === "bedtime" ? "auto" : h.type, title: h.name, meta: habitMeta(h, d), done, regular: h.type !== "bedtime", result },
      tick: h.type === "bedtime" ? undefined : () => setHabitValue(d.date, h, nextValue(h)),
      open: () => push("habit", { id: h.id }),
    };
  });
  return <FoldCard title="Привычки" entries={entries} />;
}

export function taskMeta(t: DayTask | (DayTask & { overdue?: boolean })): string {
  const parts: string[] = [];
  if (t.important) parts.push("важное");
  if (t.fresh) parts.push("свежая голова");
  if (!parts.length && t.description) parts.push(t.description.split("\n")[0]!);
  if (t.overdue && !t.done) parts.unshift("просрочено");
  if (!t.date) parts.push("без даты");
  return parts.join(", ");
}

function TasksCard({ tasks }: { tasks: DayTask[] }) {
  const entries: Entry[] = tasks.map((t) => ({
    id: t.id,
    closed: t.done,
    counts: t.done,
    item: { kind: "check", title: t.title, meta: taskMeta(t), done: t.done, alert: t.important, late: t.overdue, right: t.start_time ?? undefined },
    tick: () => toggleTask(t),
    open: () => push("task", { id: t.id }),
  }));
  return <FoldCard title="Задачи" entries={entries} />;
}

// ---------- «По часам» ----------

const PX = 46 / 60; // 46 px per hour, as in TodayHoursGlass
const REVEAL_MS = 520; // the day unrolls from the top: delay grows with the position

interface HourItem {
  id: string;
  title: string;
  start: number;
  dur: number;
  done: boolean;
  important: boolean;
  tick?: () => void;
  open: () => void;
  moon?: boolean;
  meta?: string;
}

function wave(y0: number, y1: number): string {
  let p = `M58 ${y0.toFixed(1)}`;
  let y = y0;
  let k = 0;
  while (y < y1 - 0.5) {
    const ny = Math.min(y1, y + 46);
    p += ` Q${k % 2 ? 60.2 : 55.8} ${((y + ny) / 2).toFixed(1)} 58 ${ny.toFixed(1)}`;
    y = ny;
    k++;
  }
  return p;
}

function DayHours({ d, habits, remindOf, settings }: { d: DayView; habits: HabitRow[]; remindOf: Map<string, string | null>; settings: Settings | undefined }) {
  const tl = d.timeline;
  const startH = Math.floor(tl.wake / 60);
  const endH = Math.max(startH + 4, Math.ceil(tl.bed / 60));
  const top = d.sleep ? 72 : 0;
  const y = (m: number) => (m - startH * 60) * PX;
  const night = (s: string | null) => {
    const m = toMin(s);
    return m == null ? null : m < 300 ? m + 1440 : m;
  };

  // Items with a time keep it; the rest the app places into a fitting energy zone
  // (a task that needs a fresh head goes to the peak).
  const timed: HourItem[] = [];
  const free: (HourItem & { zone: string })[] = [];
  for (const t of d.tasks) {
    const it: HourItem = { id: t.id, title: t.title, start: 0, dur: t.duration_min || 30, done: t.done, important: t.important, tick: () => toggleTask(t), open: () => push("task", { id: t.id }) };
    const s = night(t.start_time);
    if (s != null) timed.push({ ...it, start: s });
    else free.push({ ...it, zone: t.fresh ? "focus" : "steady" });
  }
  for (const h of habits) {
    if (h.type === "bedtime") continue;
    const it: HourItem = {
      id: h.id, title: h.type === "count" ? `${h.name}, ${Number(h.value) || 0} из ${countNorm(h.config)}` : h.name,
      start: 0, dur: h.type === "count" ? 5 : 10, done: h.status === "done", important: false,
      tick: () => setHabitValue(d.date, h, nextValue(h)), open: () => push("habit", { id: h.id }),
    };
    const s = night(remindOf.get(h.id) ?? null);
    if (s != null) timed.push({ ...it, start: s });
    else free.push({ ...it, zone: "steady" });
  }
  const nowMin = d.relation === "today" && d.now_min != null ? Math.ceil(d.now_min / 5) * 5 : 0;
  const cursor = new Map<string, number>();
  for (const it of free) {
    const zones = tl.zones.filter((z) => z.zone === it.zone && z.end > nowMin);
    const z = zones[0] ?? tl.zones.find((x) => x.end > nowMin) ?? tl.zones[0];
    const at = Math.max(cursor.get(z?.zone ?? "") ?? 0, z ? Math.max(z.start, nowMin) : nowMin || tl.wake);
    timed.push({ ...it, start: at });
    cursor.set(z?.zone ?? "", at + it.dur + 5);
  }
  const bedtime = habits.find((h) => h.type === "bedtime");
  if (bedtime && settings) {
    const b = night(settings.bed_target)!;
    timed.push({ id: bedtime.id, title: bedtime.name, start: b, dur: 0, done: false, important: false, moon: true, meta: `${settings.bed_target} · засчитается завтра`, open: () => push("habit", { id: bedtime.id }) });
  }
  timed.sort((a, b) => a.start - b.start);
  const groups: { top: number; items: HourItem[] }[] = [];
  for (const it of timed) {
    const t = Math.max(0, y(it.start));
    const g = groups[groups.length - 1];
    if (g && t < g.top + g.items.length * 49 + 6) g.items.push(it);
    else groups.push({ top: t, items: [it] });
  }
  const last = groups[groups.length - 1];
  const height = Math.max((endH - startH) * 46 + 60, last ? last.top + last.items.length * 49 + 20 : 0) + top;
  const zoneName = (m: number) => ZONE_LABEL[zoneAt(d, m)?.zone ?? ""] ?? "";
  const zoneColor = (m: number) => ZONE_COLOR[zoneAt(d, m)?.zone ?? "steady"] ?? "#64a0ff";
  const zones = tl.zones
    .map((z) => ({ ...z, s: Math.max(z.start, startH * 60), e: Math.min(z.end, endH * 60) }))
    .filter((z) => z.e > z.s);

  return (
    <section aria-label="День по часам" class="k-hours" style={{ height: `${height}px` }}>
      {d.sleep && (
        <div aria-label="Сон этой ночью" style={{ position: "absolute", left: 0, right: 0, top: 0, height: "72px" }}>
          <svg aria-hidden="true" width="80" height="72" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <line x1="58" y1="4" x2="58" y2="72" stroke="#636366" stroke-width="2" stroke-dasharray="1.5 4" stroke-linecap="round" />
          </svg>
          <svg viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", left: "30px", top: "14px", width: 16, height: 16, fill: "#636366" }}>
            <path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z" />
          </svg>
          <div style={{ position: "absolute", left: "84px", right: 0, top: "8px", display: "flex", flexDirection: "column", gap: "1px" }}>
            <span class="k-n" style={{ fontSize: "15px", lineHeight: "20px", color: "#8e8e93" }}>
              Сон {dur(d.sleep.duration_min).replace(/ м$/, " мин")}
            </span>
            <span class="k-n" style={{ fontSize: "12px", lineHeight: "16px", color: "#636366" }}>
              {d.sleep.bed}–{d.sleep.wake} · {{ bad: "спалось плохо", ok: "спалось нормально", good: "спалось хорошо" }[d.sleep.quality]}
            </span>
          </div>
        </div>
      )}
      <div style={{ position: "absolute", left: 0, right: 0, top: `${top}px`, bottom: 0 }}>
        <svg aria-hidden="true" width="80" height={height - top} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {zones.map((z, i) => (
            <path
              key={i}
              class="k-wave"
              pathLength={1}
              style={{ "--d": `${Math.round((y(z.s) / Math.max(1, height)) * REVEAL_MS)}ms`, "--len": `${Math.round(((y(z.e) - y(z.s)) / Math.max(1, height)) * REVEAL_MS)}ms` }}
              d={wave(y(z.s), y(z.e))}
              stroke={ZONE_COLOR[z.zone] ?? "#7c7c8a"}
              stroke-width="2"
              fill="none"
              stroke-linecap="round"
            />
          ))}
          {d.relation === "today" && d.now_min != null && d.now_min >= startH * 60 && d.now_min <= endH * 60 && (
            <circle cx="58" cy={y(d.now_min).toFixed(1)} r="4.5" fill="#f5f5f7" />
          )}
        </svg>
        {Array.from({ length: endH - startH + 1 }, (_, i) => {
          const h = startH + i;
          return (
            <span key={h} class="lbl k-n k-reveal" style={{ top: `${i * 46 - 7}px`, "--d": `${Math.round(((i * 46) / Math.max(1, height)) * REVEAL_MS)}ms` }}>
              {h === 24 ? "24:00" : hhmm(h * 60)}
            </span>
          );
        })}
        {zones
          .filter((z) => y(z.e) - y(z.s) > 70)
          .map((z, i) => (
            <span key={i} class="zone k-reveal-fade" style={{ top: `${((y(z.s) + y(z.e)) / 2).toFixed(1)}px`, color: ZONE_COLOR[z.zone], "--d": `${Math.round((((y(z.s) + y(z.e)) / 2) / Math.max(1, height)) * REVEAL_MS)}ms` }}>
              {ZONE_LABEL[z.zone]}
            </span>
          ))}
        {groups.map((g, gi) => (
          <div key={gi} class="k-hblock k-reveal" style={{ top: `${g.top}px`, "--d": `${Math.round((g.top / Math.max(1, height)) * REVEAL_MS) + 60}ms` }}>
            {g.items.map((it) => (
              <div key={it.id} class="k-hitem">
                {it.moon ? (
                  <span class="k-hdot" style={{ color: "#aeaeb2" }}>
                    <svg viewBox="0 0 18 18" aria-hidden="true" style={{ width: 18, height: 18, fill: "none", stroke: "#aeaeb2", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }}>
                      <circle cx="9" cy="9" r="8" stroke-dasharray="2.4 2.4" />
                      <path transform="translate(0.74 -0.74)" d="M11.8 10.6A3.6 3.6 0 1 1 7.4 6.2a2.9 2.9 0 0 0 4.4 4.4z" />
                    </svg>
                  </span>
                ) : (
                  <button
                    class={`k-btnreset k-hdot${it.done ? " done" : ""}`}
                    aria-label={`${it.done ? "Снять отметку" : "Отметить"}: ${it.title}`}
                    onClick={it.tick}
                    style={it.done ? undefined : { boxShadow: it.important ? "inset 0 0 0 1.8px #ff453a, 0 0 8px rgba(255,69,58,0.35)" : `inset 0 0 0 1.6px ${zoneColor(it.start)}` }}
                  >
                    {it.done && (
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 12, height: 12, fill: "none", stroke: "#000", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }}>
                        <path d={CHECK} />
                      </svg>
                    )}
                  </button>
                )}
                <button class="k-btnreset" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }} onClick={it.open}>
                  <span class="t" style={{ color: it.done ? "#8e8e93" : "#f5f5f7" }}>
                    {it.title}
                  </span>
                  <span class="m k-n">{it.meta ?? `${hhmm(it.start)}–${hhmm(it.start + it.dur)} · ${zoneName(it.start)}`}</span>
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- loading ----------

function SkRows({ widths }: { widths: string[] }) {
  return (
    <>
      {widths.map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "56px", padding: "0 18px", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : undefined }}>
          <span aria-hidden="true" class="k-sk" style={{ width: 28, height: 28, borderRadius: 14 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
            <span aria-hidden="true" class="k-sk" style={{ width: w, height: 14 }} />
            <span aria-hidden="true" class="k-sk" style={{ width: "30%", height: 10 }} />
          </div>
        </div>
      ))}
    </>
  );
}

function Skeleton() {
  return (
    <>
      <p role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Загружаю день
      </p>
      <section style={{ padding: "4px 4px 2px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <span aria-hidden="true" class="k-sk" style={{ width: 120, height: 64, borderRadius: 14 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", paddingBottom: "8px" }}>
          <span aria-hidden="true" class="k-sk" style={{ width: 132, height: 10, borderRadius: 3 }} />
          <span aria-hidden="true" class="k-sk" style={{ width: 70, height: 12 }} />
        </div>
      </section>
      <section class="k-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <span aria-hidden="true" class="k-sk" style={{ width: "100%", height: 14 }} />
        <span aria-hidden="true" class="k-sk" style={{ width: "86%", height: 14 }} />
        <span aria-hidden="true" class="k-sk" style={{ width: "60%", height: 14 }} />
      </section>
      <section class="k-card clip">
        <div style={{ padding: "16px 18px 8px" }}>
          <span aria-hidden="true" class="k-sk" style={{ width: 90, height: 16 }} />
        </div>
        <SkRows widths={["62%", "48%", "70%", "55%", "40%"]} />
      </section>
      <section class="k-card clip">
        <div style={{ padding: "16px 18px 8px" }}>
          <span aria-hidden="true" class="k-sk" style={{ width: 90, height: 16 }} />
        </div>
        <SkRows widths={["62%", "48%", "70%"]} />
      </section>
    </>
  );
}

