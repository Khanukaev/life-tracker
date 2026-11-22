import { useEffect, useState } from "preact/hooks";
import { Check, Empty, Icon, Sec, useLongPress } from "../components/ui";
import { dayKey, setHabitValue, toggleTask } from "../lib/actions";
import { runs, smooth } from "../lib/chart";
import { addDays, dur, hhmm, longDate, relDay, toMin, weekdayShort, ZONE_COLOR, ZONE_NAME } from "../lib/format";
import { haptic } from "../lib/haptic";
import { dayDate, goTab, openDay, openSheet, push } from "../lib/router";
import { prefetch, resource } from "../lib/store";
import type { DayTask, DayView, HabitRow } from "../lib/types";
import { glassesNeed } from "../domain/score";

const HH = 48; // px per hour on the timeline
const y = (m: number) => ((m - 300) / 60) * HH;
const ZONE_HINT: Record<string, string> = {
  focus: "Самое сложное — сюда.",
  steady: "Рутина и обычные дела.",
  recharge: "Отдых и восстановление.",
};

export function DayScreen() {
  const date = dayDate.value;
  const key = dayKey(date);
  const res = resource<DayView>(key).value;
  const d = res.data;

  useEffect(() => {
    if (!d) return;
    prefetch(dayKey(addDays(d.date, -1)));
    prefetch(dayKey(addDays(d.date, 1)));
    prefetch("/views/now");
  }, [d?.date]);

  if (!d) return <DaySkeleton error={res.error} />;
  const iso = d.date;
  const title = d.relation === "today" ? "Сегодня" : relDay(iso, d.today);
  const nav = (n: number) => {
    haptic.light();
    const next = addDays(iso, n);
    openDay(next === d.today ? null : next);
  };

  return (
    <div class="page">
      <header class="head">
        <div class="head-row">
          <h1 class="h1">{title}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            {d.energy_now != null && (
              <button class="energy-pill" onClick={() => goTab("now")}>
                <span class="zd" style={{ background: ZONE_COLOR[d.energy_zone ?? "steady"] ?? "var(--steady)" }} />
                <span class="mono">{d.energy_now}</span>
                <span style={{ color: "var(--muted)" }}>{d.energy_zone ? ZONE_NAME[d.energy_zone] : "ср."}</span>
              </button>
            )}
            <button class="ib" aria-label="Разбор от Claude" onClick={() => openSheet("claude")}>
              <Icon name="spark" />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", margin: "0 0 0 -12px" }}>
          <button class="ib" aria-label="Предыдущий день" style={{ color: "var(--muted)" }} onClick={() => nav(-1)}>
            <Icon name="left" size={18} />
          </button>
          <span style={{ fontSize: "15px", color: "var(--muted)" }}>{longDate(iso)}</span>
          <button class="ib" aria-label="Следующий день" style={{ color: "var(--dim)" }} onClick={() => nav(1)}>
            <Icon name="right" size={18} />
          </button>
          {d.relation !== "today" && (
            <button class="btn" style={{ height: "28px", fontSize: "13px" }} onClick={() => openDay(null)}>
              К сегодня
            </button>
          )}
        </div>
      </header>

      <main class="main" style={{ paddingTop: "12px" }}>
        {d.score && <ScoreCard d={d} />}
        <SleepRow d={d} />
        {d.critical.length > 0 && <Critical d={d} k={key} />}
        {d.relation !== "future" && <Habits d={d} date={date} />}
        <Timeline d={d} />
      </main>
    </div>
  );
}

function ScoreCard({ d }: { d: DayView }) {
  const s = d.score!;
  const [pi, setPi] = useState(0);
  const [open, setOpen] = useState(false);
  const phrase = d.phrases.length ? d.phrases[pi % d.phrases.length] : null;
  return (
    <section class="card">
      <div style={{ padding: "20px 20px 18px" }}>
        <div class="s">Рейтинг выкладывания</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "6px" }}>
          <div>
            <div class="mono" style={{ fontSize: "64px", lineHeight: "64px", fontWeight: 500, letterSpacing: "-0.05em" }}>
              {s.pct}
              <span style={{ fontSize: "28px", color: "var(--muted)", letterSpacing: 0 }}>%</span>
            </div>
            <div style={{ marginTop: "10px", fontSize: "13px", color: "var(--muted)" }}>
              {s.delta == null ? (
                "первый день в трекере"
              ) : (
                <>
                  <span class="mono" style={{ color: "var(--text)" }}>
                    {s.delta > 0 ? "+" : s.delta < 0 ? "−" : "±"}
                    {Math.abs(s.delta)}
                  </span>{" "}
                  к вчера
                </>
              )}
              {s.avg7 != null && (
                <>
                  {" "}
                  · среднее <span class="mono" style={{ color: "var(--text)" }}>{s.avg7}%</span>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", height: "92px" }} role="img" aria-label="Рейтинг за 7 дней">
            {s.week.map((w, i) => {
              const cur = i === s.week.length - 1;
              return (
                <div key={w.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <div
                    style={{
                      width: "12px",
                      height: `${w.pct == null ? 2 : Math.max(3, Math.round(w.pct * 0.95))}px`,
                      borderRadius: "6px",
                      background: cur ? "var(--accent)" : "var(--fill-2)",
                      opacity: w.pct == null ? 0.4 : 1,
                    }}
                  />
                  <span style={{ fontSize: "10px", color: cur ? "var(--text)" : "var(--muted)" }}>{weekdayShort(w.date)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {phrase && (
          <button
            class="plain"
            style={{ marginTop: "18px", fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}
            onClick={() => {
              haptic.selection();
              setPi(pi + 1);
            }}
          >
            {phrase}
          </button>
        )}
      </div>
      {d.relation === "today" && s.gains.length > 0 && (
        <>
          <button class="plain row" aria-expanded={open} onClick={() => setOpen(!open)} style={{ borderTop: "1px solid var(--line)", minHeight: "50px" }}>
            <span class="t" style={{ flex: 1, fontSize: "15px" }}>
              Как поднять рейтинг
            </span>
            <span class="mono s" style={{ color: "var(--text)" }}>
              +{s.gains_total}
            </span>
            <Icon name="down" size={16} style={{ color: "var(--muted)", transform: open ? "rotate(180deg)" : "none" }} />
          </button>
          {open && (
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "15px" }}>
              {s.gains.map((g) => (
                <div key={g.ref} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <span>{g.label}</span>
                  <span class="mono">+{g.points}</span>
                </div>
              ))}
              <div class="s" style={{ paddingTop: "10px", borderTop: "1px solid var(--line)" }}>
                Ключевые привычки и критичные задачи весят ×3, остальные задачи ×2, прочее ×1.
                {s.bed_gain > 0 && (
                  <>
                    {" "}
                    Отбой в норму даст <span class="mono" style={{ color: "var(--text)" }}>+{s.bed_gain}</span> к завтрашнему дню.
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const QUALITY: Record<string, string> = { bad: "Плохо", ok: "Нормально", good: "Хорошо" };

function SleepRow({ d }: { d: DayView }) {
  const open = () => openSheet("sleep", { date: d.date });
  if (d.sleep) {
    return (
      <button class="card row plain" style={{ minHeight: "60px", marginTop: "-16px" }} onClick={open}>
        <Icon name="moon" size={20} style={{ color: "var(--muted)" }} />
        <span class="t" style={{ flex: 1 }}>
          Сон
        </span>
        <span class="s">
          <span class="mono" style={{ color: "var(--text)" }}>
            {dur(d.sleep.duration_min)}
          </span>{" "}
          · {QUALITY[d.sleep.quality]}
        </span>
        <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
      </button>
    );
  }
  if (d.sleep_planned) {
    return (
      <div class="card row" style={{ marginTop: "-16px" }}>
        <Icon name="moon" size={20} style={{ color: "var(--muted)" }} />
        <span class="s" style={{ flex: 1 }}>
          Сон по плану: отбой {d.sleep_planned.bed}, {String(d.sleep_planned.need_h).replace(".", ",")} ч. Отметишь утром.
        </span>
      </div>
    );
  }
  return (
    <div class="card row" style={{ marginTop: "-16px", minHeight: "60px" }}>
      <Icon name="moon" size={20} style={{ color: "var(--muted)" }} />
      <span class="col-text">
        <span class="t">Как спал?</span>
        <span class="s">От этого считается энергия на день</span>
      </span>
      <button class="btn acc" onClick={open}>
        Отметить
      </button>
    </div>
  );
}

function taskMeta(t: DayTask): string {
  const parts: string[] = [];
  if (t.start_time) {
    const s = toMin(t.start_time)!;
    parts.push(`${t.start_time}–${hhmm(s + t.duration_min)}`);
  } else parts.push("Без времени");
  parts.push(ZONE_NAME[t.energy] ?? "");
  return parts.join(" · ");
}

function Critical({ d, k }: { d: DayView; k: string }) {
  const done = d.critical.filter((t) => t.done).length;
  return (
    <section>
      <Sec title="Главное сегодня" end={<span class="mono">{`${done} / ${d.critical.length}`}</span>} />
      <div class="card list" style={{ borderColor: "rgba(255,45,85,0.32)" }}>
        {d.critical.map((t) => (
          <div class="row" key={t.id}>
            <Check on={t.done} variant="crit" label={`Выполнить: ${t.title}`} onClick={() => toggleTask(t, [k])} />
            <button class="plain col-text" onClick={() => openSheet("task", { id: t.id })}>
              <span class="t" style={t.done ? { color: "var(--muted)", textDecoration: "line-through" } : undefined}>
                {t.title}
              </span>
              <span class="s mono">{taskMeta(t)}</span>
            </button>
          </div>
        ))}
      </div>
      {d.critical_overload && (
        <div class="s" style={{ display: "flex", gap: "8px", margin: "10px 4px 0", color: "var(--soft)" }}>
          <Icon name="warn" size={16} />
          Когда всё важно — ничего не важно. Критичных больше трёх: оставь самое главное.
        </div>
      )}
    </section>
  );
}

function Habits({ d, date }: { d: DayView; date: string | null }) {
  const done = d.habits.filter((h) => h.status === "done").length;
  const counted = d.habits.filter((h) => h.status !== "rest").length;
  if (!d.habits.length) {
    return (
      <section>
        <Sec title="Привычки" />
        <Empty text="Привычек пока нет. Добавь первую — из шаблона или свою." action="Создать привычку" onAction={() => openSheet("habit", {})} />
      </section>
    );
  }
  return (
    <section>
      <Sec title="Привычки" end={<span class="mono" style={{ color: "var(--text)" }}>{`${done} / ${counted}`}</span>} />
      <div class="card list">
        {d.habits.map((h) => (
          <HabitLine key={h.id} h={h} d={d} date={date} />
        ))}
        <button class="row plain add" style={{ minHeight: "48px" }} onClick={() => openSheet("habit", {})}>
          <Icon name="plus" size={18} style={{ margin: "0 4px" }} />
          <span style={{ fontSize: "15px" }}>Добавить привычку</span>
        </button>
      </div>
    </section>
  );
}

function Streak({ n }: { n: number }) {
  return n > 1 ? <span class="s mono">{n} дн</span> : null;
}

function HabitLine({ h, d, date }: { h: HabitRow; d: DayView; date: string | null }) {
  const set = (v: any) => setHabitValue(date, d.date, h, v);
  const missed = h.status === "missed";
  const name = (
    <span class="t" style={h.status === "rest" ? { color: "var(--muted)" } : undefined}>
      {h.name}
    </span>
  );

  if (h.type === "bedtime") {
    return (
      <div class="row">
        <Check on={h.status === "done"} variant="auto" label={`${h.name}: ${h.status}`} />
        <span class="col-text">
          {name}
          <span class="s">{h.status === "done" ? "Вовремя" : missed ? "Позже нормы" : "Отметится сам из сна"}</span>
        </span>
        <Streak n={h.streak} />
      </div>
    );
  }

  if (h.status === "rest" && h.type === "check") {
    return (
      <div class="row">
        <Check on={false} variant="rest" label={`${h.name}: отдых по графику`} />
        <span class="col-text">
          {name}
          <span class="s">Сегодня отдых по графику</span>
        </span>
        <button class="btn ghost" onClick={() => set(true)}>
          Сделал
        </button>
      </div>
    );
  }

  if (h.type === "water") {
    const need = glassesNeed(h.config);
    const g = h.value ?? 0;
    return (
      <div class="row">
        <span style={{ width: "26px", display: "inline-flex", justifyContent: "center" }}>
          <span class="mono" style={{ fontSize: "13px", color: "var(--text)" }}>
            {g}
          </span>
        </span>
        <span class="col-text" style={{ gap: "6px" }}>
          {name}
          <span style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            {Array.from({ length: need }, (_, i) => (
              <span key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: i < g ? "var(--accent)" : "var(--fill-2)" }} />
            ))}
          </span>
        </span>
        <button class="step" aria-label="Минус стакан" onClick={() => { haptic.light(); set(Math.max(0, g - 1) || null); }}>
          −
        </button>
        <button class="step" aria-label="Плюс стакан" onClick={() => { haptic.light(); set(g + 1); }}>
          +
        </button>
      </div>
    );
  }

  if (h.type === "minutes") {
    return <MinutesLine h={h} name={name} set={set} />;
  }

  if (h.type === "dual") {
    const v = h.value ?? { a: false, b: false };
    const labels: string[] = h.config.labels ?? ["1", "2"];
    const flip = (k: "a" | "b") => {
      haptic.selection();
      const next = { ...v, [k]: !v[k] };
      set(next.a || next.b ? next : null);
    };
    return (
      <div class="row">
        <Check on={h.status === "done"} label={`${h.name}: ${h.status}`} />
        <span class="col-text">
          {name}
          <span class="s">{h.status === "rest" ? "По графику отдых" : "Обе отметки — и день засчитан"}</span>
        </span>
        <button class={`btn${v.a ? " tint" : ""}`} onClick={() => flip("a")}>
          {labels[0]}
        </button>
        <button class={`btn${v.b ? " tint" : ""}`} onClick={() => flip("b")}>
          {labels[1]}
        </button>
      </div>
    );
  }

  const on = h.status === "done";
  return (
    <button class="row plain" onClick={() => { if (!on) haptic.light(); set(on ? null : true); }}>
      <Check on={on} label={`${h.name}: ${on ? "выполнено" : "не выполнено"}`} />
      <span class="col-text">
        {name}
        {missed && <span class="s">Пропущено</span>}
        {h.status === "rest" && <span class="s">По графику отдых</span>}
      </span>
      <Streak n={h.streak} />
    </button>
  );
}

function MinutesLine({ h, name, set }: { h: HabitRow; name: preact.JSX.Element; set: (v: any) => void }) {
  const target = Number(h.config.target_min);
  const step = Number(h.config.step_min ?? 10);
  const m = h.value ?? 0;
  const lp = useLongPress(() => {
    haptic.light();
    set(Math.max(0, m - step) || null);
  });
  const dash = Math.min(1, m / target) * 69.1;
  const ring = m > 0;
  return (
    <div class="row">
      <span style={{ width: "26px", height: "26px", position: "relative", flex: "none" }}>
        <svg viewBox="0 0 26 26" aria-hidden="true" style={{ width: "26px", height: "26px", transform: "rotate(-90deg)" }}>
          <circle cx="13" cy="13" r="11" style={{ fill: "none", stroke: "var(--fill)", strokeWidth: 3 }} />
          {ring && <circle cx="13" cy="13" r="11" style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 3, strokeLinecap: "round", strokeDasharray: `${dash.toFixed(1)} 69.1` }} />}
        </svg>
      </span>
      <span class="col-text">
        {name}
        <span class="s mono">
          {m} / {target} мин
        </span>
      </span>
      <button
        class="step"
        aria-label={`Плюс ${step} минут, удерживай — минус`}
        onPointerDown={lp.onPointerDown}
        onPointerUp={lp.onPointerUp}
        onPointerLeave={lp.onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (lp.wasLong()) return;
          haptic.light();
          set(m + step);
        }}
      >
        +{step} мин
      </button>
    </div>
  );
}

interface Block {
  key: string;
  cls: string;
  top: number;
  h: number;
  left: string;
  width: string;
  title: string;
  meta: string;
  warn?: boolean;
  onClick: () => void;
}

function Timeline({ d }: { d: DayView }) {
  const tl = d.timeline;
  const isToday = d.relation === "today";
  const now = d.now_min ?? -1;
  const blocks: Block[] = [];

  // Morning sleep (until wake-up).
  if (tl.wake > 300) {
    const real = d.sleep;
    blocks.push({
      key: "sleep-am", cls: `sleep${isToday && now > tl.wake ? " past" : ""}`, top: 2, h: Math.max(24, y(Math.min(tl.wake, 1740)) - 4),
      left: "82px", width: "calc(100% - 82px)", title: "Сон",
      meta: real ? `${real.bed} → ${real.wake} · ${dur(real.duration_min)}` : `оценка · подъём ${hhmm(tl.wake)}`,
      onClick: () => openSheet("sleep", { date: d.date }),
    });
  }

  // Timed tasks, overlapping ones side by side.
  const timed = d.tasks
    .filter((t) => t.start_time)
    .map((t) => ({ t, s: toMin(t.start_time)! < 300 ? toMin(t.start_time)! + 1440 : toMin(t.start_time)!, e: 0, col: 0, n: 1 }))
    .map((x) => ({ ...x, e: x.s + x.t.duration_min }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster: typeof timed = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols: number[] = [];
    for (const x of cluster) {
      let i = cols.findIndex((end) => end <= x.s);
      if (i < 0) {
        i = cols.length;
        cols.push(0);
      }
      x.col = i;
      cols[i] = x.e;
    }
    cluster.forEach((x) => (x.n = cols.length));
    cluster = [];
  };
  for (const x of timed) {
    if (cluster.length && x.s >= clusterEnd) flush();
    cluster.push(x);
    clusterEnd = Math.max(clusterEnd, x.e);
  }
  flush();
  for (const x of timed) {
    const t = x.t;
    const past = d.relation === "past" || (isToday && x.e < now) || t.done;
    const cls = [t.importance === "critical" && !t.done ? "crit" : "", past ? "past" : "", t.done ? "done" : ""].join(" ");
    const w = `calc((100% - 82px) / ${x.n} - ${x.n > 1 ? 4 : 0}px)`;
    blocks.push({
      key: t.id, cls, top: y(x.s) + 2, h: Math.max(24, (t.duration_min / 60) * HH - 4),
      left: `calc(82px + (100% - 82px) * ${x.col / x.n})`, width: w, title: t.title,
      meta: t.low_energy ? "Мало энергии для Focus" : `${t.start_time}–${hhmm(x.e)} · ${t.importance === "critical" ? "Критичная" : ZONE_NAME[t.energy]}`,
      warn: t.low_energy,
      onClick: () => openSheet("task", { id: t.id }),
    });
  }

  for (const raw of tl.free) {
    // Today the past is not "free": an open slot starts no earlier than now.
    const g = isToday ? { ...raw, start: Math.max(raw.start, Math.ceil(now / 15) * 15) } : raw;
    const len = g.end - g.start;
    if (len < 20) continue;
    blocks.push({
      key: `free-${g.start}`, cls: "free", top: y(g.start) + 3, h: Math.max(20, y(g.end) - y(g.start) - 6),
      left: "82px", width: "calc(100% - 82px)",
      title: `Свободно · ${dur(len)}${g.zone ? ` · ${ZONE_NAME[g.zone]}` : ""}`,
      meta: "Нажми, чтобы поставить задачу",
      onClick: () => openSheet("task", { date: d.date, start: hhmm(Math.ceil(g.start / 15) * 15), dur: Math.min(60, len) }),
    });
  }

  if (tl.bed < 1740) {
    blocks.push({
      key: "bed", cls: "plan", top: y(tl.bed) + 2, h: Math.max(24, y(1740) - y(tl.bed) - 4), left: "82px", width: "calc(100% - 82px)",
      title: d.score?.bed_gain ? `Отбой · норма ${hhmm(tl.bed)}` : `Отбой · ${hhmm(tl.bed)}`,
      meta: d.score?.bed_gain ? `Даст +${d.score.bed_gain} к завтрашнему дню` : "По плану",
      onClick: () => openSheet("sleep", { date: addDays(d.date, 1) }),
    });
  }

  const curve = runs(tl.curve, (v, i) => [3 + (v / 100) * 20, (i * 15 * HH) / 60 + 0]);
  const untimed = d.tasks.filter((t) => !t.start_time && !t.done);
  const nowCard = tl.now;

  return (
    <section>
      <Sec title="Лента дня" end="05:00 — 05:00" />
      {nowCard && (
        <div class="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: "14px", marginBottom: "8px", borderColor: "rgba(255,45,85,0.45)" }}>
          <span style={{ width: "12px", alignSelf: "stretch", borderRadius: "6px", background: ZONE_COLOR[nowCard.zone] }} />
          <span class="col-text">
            <span class="s">Сейчас · до {hhmm(nowCard.until)}</span>
            <span style={{ fontSize: "20px", fontWeight: 600 }}>{ZONE_NAME[nowCard.zone]}</span>
            <span class="s" style={{ color: "var(--soft)" }}>
              {ZONE_HINT[nowCard.zone]}
              {nowCard.next_zone ? ` Дальше ${ZONE_NAME[nowCard.next_zone]}.` : ""}
            </span>
          </span>
          {nowCard.idx != null && (
            <span class="mono" style={{ fontSize: "28px", fontWeight: 500 }}>
              {nowCard.idx}
            </span>
          )}
        </div>
      )}
      {untimed.length > 0 && (
        <button class="card row plain" style={{ marginBottom: "20px", minHeight: "50px" }} onClick={() => push("tasks", { view: "today" })}>
          <span class="t" style={{ flex: 1, fontSize: "15px" }}>
            Без времени
          </span>
          <span class="s">{untimed.length} {untimed.length === 1 ? "задача" : untimed.length < 5 ? "задачи" : "задач"}</span>
          <span class="btn" style={{ height: "28px", fontSize: "13px" }}>
            В слот
          </span>
        </button>
      )}
      <div style={{ display: "flex", gap: "16px", margin: "0 4px 14px", fontSize: "13px", color: "var(--soft)" }}>
        {(["focus", "steady", "recharge"] as const).map((z) => (
          <span key={z} style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
            <span style={{ width: "12px", height: "12px", borderRadius: "4px", background: ZONE_COLOR[z] }} />
            {ZONE_NAME[z]}
          </span>
        ))}
      </div>
      <div style={{ position: "relative", height: `${24 * HH}px` }}>
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i}>
            <div class="mono" style={{ position: "absolute", left: 0, top: `${i * HH}px`, width: "40px", fontSize: "12px", lineHeight: "12px", marginTop: "-6px", color: "var(--muted)" }}>
              {i % 2 === 0 ? `${String((5 + i) % 24).padStart(2, "0")}:00` : ""}
            </div>
            <div style={{ position: "absolute", left: "82px", right: 0, top: `${i * HH}px`, borderTop: `1px solid ${i % 2 === 0 ? "var(--line)" : "var(--line-faint)"}` }} />
          </div>
        ))}
        {tl.zones.map((z) => {
          const cur = isToday && now >= z.start && now < z.end;
          const past = d.relation === "past" || (isToday && z.end <= now);
          return (
            <div
              key={z.start}
              style={{
                position: "absolute", left: "46px", width: "26px", top: `${y(z.start) + 1}px`, height: `${Math.max(2, y(z.end) - y(z.start) - 2)}px`,
                borderRadius: "9px", background: ZONE_COLOR[z.zone], opacity: cur ? 1 : past ? 0.35 : 0.75,
                boxShadow: cur ? "0 0 0 2px #000, 0 0 0 4px rgba(255,45,85,0.5)" : "none",
              }}
            />
          );
        })}
        <svg viewBox={`0 0 26 ${24 * HH}`} aria-hidden="true" style={{ position: "absolute", left: "46px", top: 0, width: "26px", height: `${24 * HH}px`, overflow: "visible" }}>
          {curve.map((pts, i) => (
            <path key={i} d={smooth(pts)} style={{ fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }} />
          ))}
        </svg>
        {blocks.map((b) => (
          <button key={b.key} class={`blk ${b.cls}`} style={{ top: `${b.top}px`, height: `${b.h}px`, left: b.left, width: b.width }} onClick={b.onClick}>
            <b>{b.title}</b>
            {b.h >= 40 && (
              <span>
                {b.warn && <Icon name="warn" size={14} style={{ color: "var(--text)" }} />}
                {b.meta}
              </span>
            )}
          </button>
        ))}
        {isToday && now >= 300 && now < 1740 && (
          <>
            <div style={{ position: "absolute", left: "42px", right: 0, top: `${y(now)}px`, borderTop: "2px solid var(--accent)", zIndex: 2 }} />
            <div class="mono" style={{ position: "absolute", left: 0, top: `${y(now) - 9}px`, fontSize: "12px", lineHeight: "18px", padding: "0 5px", borderRadius: "5px", background: "var(--accent)", color: "#fff", zIndex: 3 }}>
              {hhmm(now)}
            </div>
          </>
        )}
      </div>
      {d.tasks.length === 0 && d.relation !== "past" && (
        <div style={{ marginTop: "16px" }}>
          <Empty text="На этот день задач нет. Свободное окно на ленте — нажми, чтобы поставить задачу." action="Создать задачу" onAction={() => openSheet("task", { date: d.date })} />
        </div>
      )}
    </section>
  );
}

function DaySkeleton({ error }: { error: string | null }) {
  return (
    <div class="page">
      <header class="head">
        <h1 class="h1">Сегодня</h1>
      </header>
      <main class="main" style={{ paddingTop: "12px" }}>
        {error ? (
          <div class="card empty">
            <span class="t">Не удалось загрузить</span>
            <span class="s">{error}</span>
          </div>
        ) : (
          <>
            <div class="card skel" style={{ height: "200px" }} />
            <div class="card skel" style={{ height: "60px" }} />
            <div class="card skel" style={{ height: "260px" }} />
          </>
        )}
      </main>
    </div>
  );
}
