/** «Итоги» (Results*) and their details: Sleep*, Habits*, Tasks* — week or month. */

import type { ComponentChildren } from "preact";
import { Chevron, ClaudeLogo } from "../components/icons";
import { splitSummary } from "../components/Markdown";
import { toggleTask, updateHabit } from "../lib/actions";
import { addDays, hhmm, parseDate, plural, relDay } from "../lib/format";
import { haptic } from "../lib/haptic";
import { canEdit, online } from "../lib/net";
import { goTab, openSheet, period, push } from "../lib/router";
import { refresh, resource } from "../lib/store";
import type { ResultsView, Settings, Task } from "../lib/types";
import { wasOn } from "./Plan";

const GREEN = "#69ff79";
const GREY = "rgba(255,255,255,0.12)";
const MONTH_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export const resultsKey = (p: "week" | "month") => `/views/results?period=${p}`;

// ---------- shared bits ----------

/** **bold** markers from the server's short summaries. */
export function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((s, i) => (s.startsWith("**") && s.endsWith("**") ? <b key={i}>{s.slice(2, -2)}</b> : s))}
    </>
  );
}

export function PageHead({ title, sub, end }: { title: string; sub?: string; end?: ComponentChildren }) {
  return (
    <header class="k-head" style={end ? { display: "flex", alignItems: "center", justifyContent: "space-between" } : undefined}>
      <div>
        <h1 class="k-h1">{title}</h1>
        {sub && <p class="k-sub" style={{ marginTop: "2px" }}>{sub}</p>}
      </div>
      {end}
    </header>
  );
}

export function OfflineBanner({ text }: { text: string }) {
  return (
    <div class="k-offline" role="status">
      <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, color: "#aeaeb2" }}>
        <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.4-1.8M2 9.5a15 15 0 0 1 4.3-2.6M22 9.5A15 15 0 0 0 11 6M12 20h.01" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

export function ResultsError({ retry: run, what = "итоги" }: { retry: () => void; what?: string }) {
  const retry = () => {
    haptic.light();
    run();
  };
  return (
    <section class="k-card" role="alert" style={{ marginTop: "40px", padding: "28px 22px 22px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "10px" }}>
      <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 28, height: 28, color: "#aeaeb2" }}>
        <path d="M12 8v5M12 16.5v.5" />
        <circle cx="12" cy="12" r="9" />
      </svg>
      <h2 class="k-h2" style={{ fontSize: "20px", lineHeight: "26px" }}>
        Не получилось загрузить {what}
      </h2>
      <p class="k-lead" style={{ fontSize: "16px", lineHeight: "22px" }}>
        Сервер не ответил. Проверь интернет и попробуй ещё раз — отметки за сегодня не потеряются.
      </p>
      <button class="k-btn" style={{ marginTop: "8px", width: "auto", height: "48px", padding: "0 22px", borderRadius: "14px" }} onClick={retry}>
        Повторить
      </button>
    </section>
  );
}

const sk = (w: number | string, h: number, extra: Record<string, string | number> = {}) => (
  <i class="k-sk" style={{ display: "block", width: w, height: h, ...extra }} />
);

export function SkCard() {
  return (
    <section aria-busy="true" aria-label="Загружается" style={{ padding: "4px 0 4px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {sk(150, 16, { marginLeft: 4 })}
      {sk(140, 64, { marginLeft: 4, borderRadius: 12 })}
      <div class="k-sum" style={{ gap: "12px" }}>
        {sk("100%", 14)}
        {sk("80%", 14)}
        {sk("60%", 20, { marginTop: 4 })}
      </div>
      <div class="k-card clip">
        {[0, 1, 2].map((i) => (
          <div key={i} class="k-row3" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.09)" : undefined }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              {sk(72, 14)}
              {sk(96, 28)}
            </span>
            {sk(116, 32)}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Smooth line through points (Catmull-Rom → cubic Bézier), as in the artboards. */
function smooth(P: [number, number][]): string {
  if (!P.length) return "";
  let d = `M${P[0]![0].toFixed(1)},${P[0]![1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i]!;
    const p1 = P[i]!;
    const p2 = P[i + 1]!;
    const p3 = P[i + 2] ?? p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function spark(vals: number[], w: number, h: number): { d: string; last: [number, number] } {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const P = vals.map((v, i): [number, number] => [vals.length > 1 ? (i * w) / (vals.length - 1) : w, h - ((v - lo) / span) * h]);
  return { d: smooth(P), last: P[P.length - 1]! };
}

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const nights = (n: number) => `${n} ${plural(n, "ночь", "ночи", "ночей")}`;
const daysW = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;
const prevGen = (r: ResultsView) => (r.period === "week" ? "прошлой недели" : MONTH_GEN[parseDate(addDays(r.start, -1)).getUTCMonth()]!);

/** Day cells of the period: leading blanks for a month, future days faint. */
function periodCells(r: ResultsView): ({ ok: boolean | null; future?: boolean } | null)[] {
  const out: ({ ok: boolean | null; future?: boolean } | null)[] = [];
  if (r.period === "month") for (let i = 0; i < (parseDate(r.start).getUTCDay() + 6) % 7; i++) out.push(null);
  const n = Math.round((parseDate(r.end).getTime() - parseDate(r.start).getTime()) / 86_400_000) + 1;
  for (let i = 0; i < n; i++) {
    const d = r.habits.days[i];
    out.push(d ? { ok: d.ok } : { ok: null, future: true });
  }
  return out;
}

function useResults() {
  const p = period.value;
  return { p, e: resource<ResultsView>(resultsKey(p)).value };
}

/** `animKey` remounts the content (e.g. week ↔ month), so it appears like any new screen. */
function Shell({ title, sub, end, animKey, children }: { title: string; sub?: string; end?: ComponentChildren; animKey?: string; children: ComponentChildren }) {
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <PageHead title={title} sub={sub} end={end} />
      <main class="k-main" key={animKey}>
        {children}
      </main>
    </div>
  );
}

function savedAt(at: number): string {
  if (!at) return "раньше";
  const d = new Date(at);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `${relDay(iso, t).toLowerCase()} в ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------- «Итоги» ----------

export function ResultsScreen() {
  const { p, e } = useResults();
  const r = e.data;
  const seg = (
    <div class="k-seg" role="group" aria-label="Период" style={{ width: "168px" }}>
      {(["week", "month"] as const).map((v) => (
        <button
          key={v}
          aria-pressed={p === v}
          onClick={() => {
            haptic.selection();
            period.value = v;
          }}
        >
          {v === "week" ? "Неделя" : "Месяц"}
        </button>
      ))}
    </div>
  );
  let body: ComponentChildren;
  if (!r) body = e.error && !e.loading && online.value ? <ResultsError retry={() => void refresh(resultsKey(p))} /> : <SkCard />;
  else if (r.empty) body = <EmptyResults r={r} />;
  else body = <ResultsBody r={r} />;
  return (
    <Shell title="Итоги" end={seg} animKey={p}>
      {!online.value && r && <OfflineBanner text={`Нет связи. Показываю итоги, сохранённые ${savedAt(e.at)}`} />}
      {body}
    </Shell>
  );
}

function NoteLine({ r }: { r: ResultsView }) {
  const month = MONTH_NOM[parseDate(r.start).getUTCMonth()]!;
  const filled = !!r.note;
  const line = filled
    ? `Твоя заметка, ${WD_FULL[new Date(r.note!.updated_at).getDay()]}`
    : r.period === "week" ? "Запиши, как прошла неделя" : `Запиши, как прошёл ${month}`;
  return (
    <button
      class="k-btnreset k-noteline"
      onClick={() => canEdit() && openSheet("note", { kind: r.period, anchor: r.start })}
    >
      <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, color: "#aeaeb2" }}>
        <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
      </svg>
      <span style={{ flex: 1, fontSize: "15px" }}>{line}</span>
      <span style={{ fontSize: "15px", color: "#aeaeb2" }}>{filled ? "Изменить" : "Написать"}</span>
    </button>
  );
}

export function claudeAt(iso: string): string {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const n = new Date();
  const t = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  return `${relDay(day, t).toLowerCase()} в ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ResultsBody({ r }: { r: ResultsView }) {
  const W = r.period === "week";
  const trend = r.trend.filter((x): x is number => x != null);
  const t = trend.length > 1 ? spark(trend, 124, 36) : null;
  const review = r.review;
  return (
    <>
      <section style={{ padding: "4px 4px 6px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <span class="k-lab">{W ? "Итог недели, с понедельника" : `Средний итог за ${MONTH_NOM[parseDate(r.start).getUTCMonth()]}`}</span>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
          <span class="k-n k-pct">
            {r.avg ?? "—"}
            <small>%</small>
          </span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", paddingBottom: "6px" }}>
            {t && (
              <svg viewBox="0 0 132 40" role="img" aria-label={`Итог за ${trend.length} ${W ? "недель" : "месяцев"}`} style={{ width: 132, height: 40, overflow: "visible" }}>
                <path d={t.d} fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                <circle cx={t.last[0].toFixed(1)} cy={t.last[1].toFixed(1)} r="4" fill="#f5f5f7" stroke="#000" stroke-width="2" />
              </svg>
            )}
            {r.avg != null && r.prev_avg != null && <span class="k-cap k-n">{sign(r.avg - r.prev_avg)} к {r.prev_name}</span>}
          </div>
        </div>
        <div class={`k-sum${review ? " claude" : ""}`} style={{ margin: "0 -4px", gap: 0, padding: 0, overflow: "hidden" }}>
          {review ? (
            <button class="k-btnreset" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "16px 18px 4px" }} onClick={() => push("review", { id: review.id })}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ClaudeLogo />
                <span style={{ fontSize: "13px", color: "#aeaeb2" }}>Claude, {claudeAt(review.at)}</span>
              </span>
              <span class="k-motto" style={{ fontSize: "16px" }}>
                {splitSummary(review.text)[0]}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px", minHeight: "40px", fontSize: "15px", fontWeight: 500, color: "#aeaeb2" }}>
                Читать разбор
                <Chevron />
              </span>
            </button>
          ) : (
            <div style={{ padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {r.lead && (
                <p class="k-sumtext">
                  <Bold text={r.lead} />
                </p>
              )}
              <p class="k-motto">{r.motto}</p>
              {!r.claude_connected && (
                <button class="k-btnreset k-cap" style={{ fontSize: "14px", color: "#aeaeb2", display: "flex", alignItems: "center", gap: "6px", minHeight: "32px" }} onClick={() => push("claude")}>
                  <ClaudeLogo size={14} />
                  Подключи Claude — он напишет разбор словами
                </button>
              )}
            </div>
          )}
          <NoteLine r={r} />
        </div>
      </section>
      <div class="k-card clip">
        <HabitsRow r={r} />
        <div class="k-div" />
        <TasksRow r={r} />
        <div class="k-div" />
        <SleepRow r={r} />
      </div>
    </>
  );
}

function Row3({ label, value, children, onClick }: { label: string; value: ComponentChildren; children: ComponentChildren; onClick?: () => void }) {
  return (
    <button class="k-btnreset k-row3" onClick={onClick} disabled={!onClick}>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        <span class="k-lab">{label}</span>
        <span class="k-tv k-n">{value}</span>
      </span>
      <span style={{ width: 116, flex: "none" }}>{children}</span>
      {onClick && <Chevron color="#636366" />}
    </button>
  );
}

function HabitCells({ r }: { r: ResultsView }) {
  const W = r.period === "week";
  const size = W ? 13 : 7;
  return (
    <span
      role="img"
      aria-label={`Дни ${W ? "недели" : MONTH_GEN[parseDate(r.start).getUTCMonth()]}: зелёный — сделал больше половины привычек`}
      style={{ display: "grid", gridTemplateColumns: `repeat(7, ${size}px)`, gap: W ? "3px" : "2px", justifyContent: "end" }}
    >
      {periodCells(r).map((c, i) => (
        <i
          key={i}
          style={{
            display: "block", width: size, height: size, borderRadius: W ? 3 : 1.5,
            background: !c ? "transparent" : c.ok ? GREEN : c.future || c.ok === null ? "rgba(255,255,255,0.04)" : GREY,
          }}
        />
      ))}
    </span>
  );
}

function HabitsRow({ r }: { r: ResultsView }) {
  return (
    <Row3 label="Привычки" value={<>{r.habits.pct ?? "—"}<small>%</small></>} onClick={() => push("res-habits")}>
      <HabitCells r={r} />
    </Row3>
  );
}

function TaskBars({ r }: { r: ResultsView }) {
  const groups = [r.tasks.important, r.tasks.normal].filter(([, p]) => p > 0);
  return (
    <span role="img" aria-label={`Задачи по важности: сделано ${r.tasks.done} из ${r.tasks.total}`} style={{ display: "flex", flexDirection: "column", gap: "6px", width: 116 }}>
      {groups.map(([k, p], gi) => (
        <span key={gi} style={{ display: "flex", gap: r.period === "week" ? "3px" : "1px", height: 6 }}>
          {Array.from({ length: p }, (_, i) => (
            <i key={i} style={{ display: "block", flex: 1, borderRadius: 2, background: i < k ? GREEN : GREY }} />
          ))}
        </span>
      ))}
    </span>
  );
}

function TasksRow({ r }: { r: ResultsView }) {
  return (
    <Row3 label="Задачи" value={<>{r.tasks.done}<small>из {r.tasks.total}</small></>} onClick={() => push("res-tasks")}>
      <TaskBars r={r} />
    </Row3>
  );
}

function SleepRow({ r }: { r: ResultsView }) {
  const beds = r.sleep.nights.filter((n) => n).map((n) => n!.bed).slice(-7);
  const all = [...beds, r.sleep.goal_bed];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const y = (b: number) => 2 + ((b - lo) / (hi - lo || 1)) * 26;
  const P = beds.map((b, i): [number, number] => [beds.length > 1 ? (i * 116) / (beds.length - 1) : 58, y(b)]);
  const avg = r.sleep.avg_dur;
  return (
    <Row3
      label="Сон"
      value={avg != null ? <>{Math.floor(avg / 60)}<small>ч</small> {avg % 60}<small>м</small></> : "—"}
      onClick={() => push("res-sleep")}
    >
      <svg viewBox="0 0 116 32" role="img" aria-label="Время отбоя по дням относительно нормы" style={{ width: 116, height: 32, overflow: "visible" }}>
        <line x1="0" y1={y(r.sleep.goal_bed).toFixed(1)} x2="116" y2={y(r.sleep.goal_bed).toFixed(1)} stroke="rgba(255,255,255,0.28)" stroke-width="1" stroke-dasharray="3 3" />
        {P.length > 1 && <path d={smooth(P)} fill="none" stroke="#8fa6e0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />}
      </svg>
    </Row3>
  );
}

function EmptyResults({ r }: { r: ResultsView }) {
  const W = r.period === "week";
  const empty = (
    <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7, 13px)", gap: "3px" }}>
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ display: "block", width: 13, height: 13, borderRadius: 3, background: "rgba(255,255,255,0.06)" }} />
      ))}
    </span>
  );
  return (
    <>
      <section style={{ padding: "4px 0 4px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <span class="k-lab" style={{ padding: "0 4px" }}>{W ? "Средний итог недели" : "Средний итог месяца"}</span>
        <span class="k-n k-pct" style={{ padding: "0 4px", color: "#3a3a3c" }}>—</span>
        <div class="k-sum">
          <p class="k-sumtext">Итоги появятся, когда будет что считать. Отметь первую привычку или задачу на «Сегодня» — завтра здесь будет первый итог.</p>
          <p class="k-motto">Начни с одного дела сегодня.</p>
          <button class="k-btn" style={{ height: 48, marginTop: 4, borderRadius: 14 }} onClick={() => goTab("today")}>
            Отметить первое дело
          </button>
        </div>
      </section>
      <div class="k-card clip">
        {["Привычки", "Задачи", "Сон"].map((l, i) => (
          <div key={l}>
            {i > 0 && <div class="k-div" />}
            <div class="k-row3" style={{ minHeight: 72 }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span class="k-lab">{l}</span>
                <span class="k-tv k-n" style={{ color: "#48484a" }}>—</span>
              </span>
              {empty}
            </div>
          </div>
        ))}
      </div>
      <p class="k-cap" style={{ margin: "0 4px" }}>
        Сон появится после первой ночи: отбой и подъём приложение берёт из отметок сна.
      </p>
    </>
  );
}

// ---------- details ----------

function Detail({ title, render }: { title: string; render: (r: ResultsView) => ComponentChildren }) {
  const { p, e } = useResults();
  const r = e.data;
  return (
    <Shell title={title} sub={r?.label}>
      {!online.value && r && <OfflineBanner text={`Нет связи. Показываю итоги, сохранённые ${savedAt(e.at)}`} />}
      {!r ? (e.error && !e.loading && online.value ? <ResultsError retry={() => void refresh(resultsKey(p))} /> : <SkCard />) : render(r)}
    </Shell>
  );
}

function Hero({ label, value, unit, cap, lead, motto }: { label: string; value: ComponentChildren; unit?: string; cap: string; lead: string; motto: string }) {
  return (
    <section style={{ padding: "4px 0 4px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <span class="k-lab" style={{ padding: "0 4px" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "12px", padding: "0 4px" }}>
        <span class="k-n k-big">
          {value}
          {unit && <small>{unit}</small>}
        </span>
        <span class="k-cap k-n">{cap}</span>
      </div>
      {(lead || motto) && (
        <div class="k-sum">
          {lead && (
            <p class="k-sumtext">
              <Bold text={lead} />
            </p>
          )}
          {motto && <p class="k-motto">{motto}</p>}
        </div>
      )}
    </section>
  );
}

function Stats({ a, b }: { a: [string, string]; b: [string, string] }) {
  return (
    <div class="k-stats" style={{ borderTop: "1px solid rgba(255,255,255,0.09)" }}>
      {[a, b].map(([v, c]) => (
        <div key={c} class="k-stat">
          <b class="k-n">{v}</b>
          <span class="k-cap">{c}</span>
        </div>
      ))}
    </div>
  );
}

/** Axis labels of a month: 1, 8, 15, today («сег.»), the last day — without crowding. */
function monthTicks(r: ResultsView, total: number): number[] {
  const t = Math.round((parseDate(r.today).getTime() - parseDate(r.start).getTime()) / 86_400_000);
  const base = [0, 7, 14, total - 1].filter((i) => t < 0 || t >= total || Math.abs(i - t) >= 4);
  return [...base, ...(t >= 0 && t < total ? [t] : [])].sort((a, b) => a - b);
}

const sinceWord = (r: ResultsView, n: number, what: (n: number) => string) => (r.period === "week" ? `за ${what(n)}, с понедельника` : `за ${what(n)}`);

export function ResultsSleep() {
  const settings = resource<Settings>("/settings").value.data;
  return (
    <Detail
      title="Сон"
      render={(r) => {
        const s = r.sleep;
        const W = r.period === "week";
        let cap = sinceWord(r, s.n, nights);
        if (!W && s.avg_bed != null && s.prev_avg_bed != null) {
          const d = s.avg_bed - s.prev_avg_bed;
          cap = d === 0 ? `как в ${MONTH_GEN[parseDate(addDays(r.start, -1)).getUTCMonth()]}` : `на ${Math.abs(d)} ${plural(Math.abs(d), "минуту", "минуты", "минут")} ${d > 0 ? "позже" : "раньше"} ${prevGen(r)}`;
        }
        const total = Math.round((parseDate(r.end).getTime() - parseDate(r.start).getTime()) / 86_400_000) + 1;
        const X = (i: number) => (W ? 20 + i * 46.67 : 8 + i * (304 / Math.max(1, total - 1)));
        const Y = (b: number) => Math.max(8, Math.min(168, 56 + ((b - s.goal_bed) / 60) * 56));
        const pts = s.nights.map((n, i) => (n ? { x: X(i), y: Y(n.bed), bed: n.bed, i } : null)).filter((p) => p) as { x: number; y: number; bed: number; i: number }[];
        const line = smooth(pts.map((p) => [p.x, p.y]));
        const lastP = pts[pts.length - 1];
        const area = pts.length > 1 ? `${line} L${lastP!.x.toFixed(1)},176 L${pts[0]!.x.toFixed(1)},176 Z` : "";
        const need = (settings?.sleep_need_h ?? 8) * 60;
        const todayIdx = s.nights.length - 1;
        return (
          <>
            <Hero label="Средний отбой" value={s.avg_bed != null ? hhmm(s.avg_bed) : "—"} cap={cap} lead={s.lead} motto={s.motto} />
            <section class="k-card clip">
              <div style={{ padding: "16px 18px 0" }}>
                <h2 class="k-h2">{W ? "Отбой и сон" : "Отбой"}</h2>
                <p class="k-cap" style={{ margin: "2px 0 0" }}>
                  {W ? "Во сколько лёг и сколько спал" : "Во сколько ложился каждый день"}
                </p>
              </div>
              <div role="img" aria-label={`Время отбоя по дням, норма ${hhmm(s.goal_bed)}`} style={{ position: "relative", height: 176, margin: "12px 18px 0" }}>
                <svg viewBox="0 0 320 176" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="sf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="#2f56b0" stop-opacity="0.05" />
                      <stop offset="1" stop-color="#2f56b0" stop-opacity="0.45" />
                    </linearGradient>
                  </defs>
                  {area && <path d={area} fill="url(#sf)" />}
                  <line x1="0" y1="56" x2="320" y2="56" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 4" />
                  {pts.length > 1 && <path d={line} fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-linecap="round" />}
                </svg>
                <span class="k-n" style={{ position: "absolute", right: 0, top: 38, fontSize: "11px", color: "#636366" }}>
                  норма {hhmm(s.goal_bed)}
                </span>
                {pts.map((p) => {
                  const pct = (v: number) => `${((v / 320) * 100).toFixed(2)}%`;
                  const last = p === lastP;
                  const label = W || last;
                  const sz = W ? 7 : 5;
                  return (
                    <span key={p.i}>
                      <span style={{ position: "absolute", left: pct(p.x), top: p.y, width: sz, height: sz, margin: `-${sz / 2}px 0 0 -${sz / 2}px`, borderRadius: "50%", background: W || last ? "#f5f5f7" : "rgba(255,255,255,0.85)" }} />
                      {label && (
                        <span class="k-n" style={{ position: "absolute", left: pct(p.x), top: p.bed > s.goal_bed ? p.y + 9 : p.y - 24, transform: "translateX(-50%)", fontSize: "11px", color: p.i === todayIdx || !W ? "#f5f5f7" : "#8e8e93", fontWeight: p.i === todayIdx || !W ? 500 : 400 }}>
                          {hhmm(p.bed)}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              {W ? (
                <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 18px 0", padding: "10px 0 14px", borderTop: "1px solid rgba(255,255,255,0.09)" }}>
                  {WD.map((d, i) => {
                    const n = s.nights[i];
                    const future = i >= s.nights.length;
                    const isT = addDays(r.start, i) === r.today;
                    return (
                      <span key={d} style={{ width: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                        <span style={{ fontSize: "12px", color: future ? "#48484a" : isT ? "#f5f5f7" : "#8e8e93" }}>{isT ? "сег." : d}</span>
                        <span class="k-n" style={{ fontSize: "13px", color: !n ? "#48484a" : n.dur >= need ? "#f5f5f7" : "#aeaeb2" }}>
                          {n ? `${Math.floor(n.dur / 60)}:${String(n.dur % 60).padStart(2, "0")}` : "—"}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div style={{ position: "relative", height: 34, margin: "6px 18px 0", borderTop: "1px solid rgba(255,255,255,0.09)" }}>
                  {monthTicks(r, total).map((i) => {
                    const iso = addDays(r.start, i);
                    const isT = iso === r.today;
                    return (
                      <span key={i} style={{ position: "absolute", left: `${((X(i) / 320) * 100).toFixed(2)}%`, top: 10, transform: "translateX(-50%)", fontSize: "12px", color: isT ? "#f5f5f7" : iso > r.today ? "#48484a" : "#8e8e93", whiteSpace: "nowrap" }}>
                        {isT ? "сег." : `${parseDate(iso).getUTCDate()} ${MONTH_GEN[parseDate(iso).getUTCMonth()]!.slice(0, 3)}`}
                      </span>
                    );
                  })}
                </div>
              )}
              <Stats
                a={[s.avg_dur != null ? `${Math.floor(s.avg_dur / 60)} ч ${s.avg_dur % 60} м` : "—", "сон в среднем"]}
                b={[s.avg_wake != null ? hhmm(s.avg_wake) : "—", "подъём в среднем"]}
              />
            </section>
          </>
        );
      }}
    />
  );
}

const statusBg = (s: string) =>
  s === "done" ? { bg: GREEN, bd: "none" } : s === "future" || s === "nodata" ? { bg: "transparent", bd: "inset 0 0 0 1px rgba(255,255,255,0.08)" } : s === "rest" ? { bg: "rgba(255,255,255,0.03)", bd: "none" } : { bg: "rgba(255,255,255,0.08)", bd: "none" };

export function ResultsHabits() {
  return (
    <Detail
      title="Привычки"
      render={(r) => {
        const h = r.habits;
        const W = r.period === "week";
        const daysIn = r.habits.days.length;
        const cap = W ? sinceWord(r, daysIn, daysW) : h.pct != null && h.prev_pct != null ? `${sign(h.pct - h.prev_pct)} к ${r.prev_name}` : `за ${daysW(daysIn)}`;
        const weak = h.lines.find((l) => l.id === h.weak_id);
        const lead = (W ? 0 : (parseDate(r.start).getUTCDay() + 6) % 7);
        const total = Math.round((parseDate(r.end).getTime() - parseDate(r.start).getTime()) / 86_400_000) + 1;
        return (
          <>
            <Hero label="Привычки сделаны" value={h.pct ?? "—"} unit="%" cap={cap} lead={h.lead} motto={h.motto} />
            <section class="k-card clip">
              {W ? (
                <>
                  <div style={{ padding: "16px 18px 6px" }}>
                    <h2 class="k-h2">По дням</h2>
                    <p class="k-cap" style={{ margin: "2px 0 0" }}>Квадрат — день: сделал привычку или нет</p>
                  </div>
                  <div style={{ padding: "4px 16px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", height: 26 }}>
                      <span style={{ width: 104, flex: "none" }} />
                      {WD.map((d, i) => {
                        const iso = addDays(r.start, i);
                        return (
                          <span key={d} style={{ flex: 1, textAlign: "center", fontSize: "12px", color: iso === r.today ? "#f5f5f7" : iso > r.today ? "#48484a" : "#8e8e93" }}>
                            {d}
                          </span>
                        );
                      })}
                      <span style={{ width: 44, flex: "none" }} />
                    </div>
                    {h.lines.map((l) => (
                      <button key={l.id} class="k-btnreset" style={{ display: "flex", alignItems: "center", gap: "4px", minHeight: 52, width: "100%" }} onClick={() => push("habit", { id: l.id })}>
                        <span style={{ width: 104, flex: "none", display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
                          <span style={{ fontSize: "15px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                          <span class="k-cap k-n" style={{ fontSize: "12px", lineHeight: "15px", color: l.streak > 0 ? "#d1d1d6" : "#8e8e93" }}>
                            {l.streak > 0 ? `серия ${l.streak}, рекорд ${l.best}` : "серии нет"}
                          </span>
                        </span>
                        {Array.from({ length: 7 }, (_, i) => {
                          const c = statusBg(l.cells[i] ?? "future");
                          return (
                            <span key={i} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                              <i style={{ display: "block", width: 18, height: 18, borderRadius: 4, background: c.bg, boxShadow: c.bd }} />
                            </span>
                          );
                        })}
                        <span class="k-n" style={{ width: 44, flex: "none", textAlign: "right", fontSize: "14px", fontWeight: 600, color: l.done * 2 < l.of ? "#8fa6e0" : "#f5f5f7" }}>
                          {l.done}/{l.of}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div class="k-cap" style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", margin: "8px 18px 14px" }}>
                    <Legend bg={GREEN} t="сделал" />
                    <Legend bg="rgba(255,255,255,0.08)" t="не сделал" />
                    <Legend bg="transparent" bd="inset 0 0 0 1px rgba(255,255,255,0.15)" t="ещё впереди" />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ padding: "16px 18px 4px" }}>
                    <h2 class="k-h2">По дням</h2>
                    <p class="k-cap" style={{ margin: "2px 0 0" }}>Календарь {MONTH_GEN[parseDate(r.start).getUTCMonth()]} для каждой привычки</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "18px 12px", padding: "12px 18px 4px" }}>
                    {h.lines.map((l) => (
                      <button key={l.id} class="k-btnreset" style={{ display: "flex", flexDirection: "column", gap: "8px" }} onClick={() => push("habit", { id: l.id })}>
                        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "6px", width: "100%" }}>
                          <span style={{ fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                          <span class="k-n" style={{ fontSize: "13px", fontWeight: 600, color: l.done * 2 < l.of ? "#8fa6e0" : "#f5f5f7", flex: "none" }}>
                            {l.done}/{l.of}
                          </span>
                        </span>
                        <span role="img" aria-label={`${l.name}: сделано ${l.done} дней из ${l.of}`} style={{ display: "grid", gridTemplateColumns: "repeat(7, 11px)", gap: "3px" }}>
                          {Array.from({ length: lead }, (_, i) => <i key={`l${i}`} style={{ display: "block", width: 11, height: 11 }} />)}
                          {Array.from({ length: total }, (_, i) => {
                            const c = statusBg(l.cells[i] ?? "future");
                            return <i key={i} style={{ display: "block", width: 11, height: 11, borderRadius: 2.5, background: c.bg, boxShadow: c.bd }} />;
                          })}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div style={{ height: 14 }} />
                </>
              )}
              <Stats
                a={[`${h.marks_done} из ${h.marks_total}`, W ? "отметок с понедельника" : "отметок за месяц"]}
                b={[daysW(h.record), h.record_name ? `рекорд серии, ${h.record_name.toLowerCase()}` : "рекорд серии"]}
              />
            </section>
            {weak && (
              <section class="k-card clip">
                <div style={{ padding: "16px 18px 12px" }}>
                  <h2 class="k-h2">Проседает: {weak.name.toLowerCase()}</h2>
                  <p class="k-lead" style={{ marginTop: 4, fontSize: "15px", lineHeight: "21px" }}>{h.weak_text}</p>
                </div>
                {!weak.remind_at && weak.type !== "bedtime" && (
                  <button
                    class="k-btnreset k-lr"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.09)", minHeight: 56, padding: "0 18px" }}
                    onClick={() => void updateHabit(weak.id, { remind_at: "15:00" }).then((ok) => ok && haptic.success())}
                  >
                    <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20 }}>
                      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" />
                    </svg>
                    <span style={{ flex: 1, fontSize: "16px", fontWeight: 500 }}>Напоминать о «{weak.name.toLowerCase()}» в 15:00</span>
                  </button>
                )}
              </section>
            )}
          </>
        );
      }}
    />
  );
}

function Legend({ bg, bd, t }: { bg: string; bd?: string; t: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <i style={{ width: 10, height: 10, borderRadius: 2.5, background: bg, boxShadow: bd }} />
      {t}
    </span>
  );
}

function TaskLine({ t, sub, assign }: { t: Task; sub?: string; assign?: boolean }) {
  return (
    <div class="k-lr" style={{ gap: "4px", paddingLeft: 6 }}>
      <button class="k-btnreset k-tick" aria-label={`Выполнить: ${t.title}`} onClick={() => toggleTask(t)}>
        <span class={t.done ? "done" : ""} />
      </button>
      <button class="k-btnreset" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", minHeight: 44, justifyContent: "center" }} onClick={() => push("task", { id: t.id })}>
        <span style={{ fontSize: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
        {sub && <span class="k-cap">{sub}</span>}
      </button>
      {assign && (
        <button class="k-btnreset k-pchip" style={{ fontSize: "14px", margin: "4px 0" }} onClick={() => canEdit() && openSheet("assign", { id: t.id, task: t })}>
          Назначить день
        </button>
      )}
    </div>
  );
}

export function ResultsTasks() {
  return (
    <Detail
      title="Задачи"
      render={(r) => {
        const t = r.tasks;
        const d = t.prev_done != null ? t.done - t.prev_done : null;
        const cap = d == null ? "" : d === 0 ? `как ${r.period === "week" ? "на прошлой неделе" : `в ${MONTH_GEN[parseDate(addDays(r.start, -1)).getUTCMonth()]!.replace(/я$/, "е")}`}` : `на ${Math.abs(d)} ${d > 0 ? "больше" : "меньше"} ${prevGen(r)}`;
        const groups: [string, [number, number]][] = [["Важные", t.important], ["Обычные", t.normal]];
        return (
          <>
            <Hero label="Задач сделано" value={t.done} unit={` из ${t.total}`} cap={cap} lead={t.lead} motto={t.motto} />
            <section class="k-card clip">
              <div style={{ padding: "16px 18px 4px" }}>
                <h2 class="k-h2">По важности</h2>
                <p class="k-cap" style={{ margin: "2px 0 0" }}>Деление — одна задача: зелёная сделана, серая нет</p>
              </div>
              <div style={{ padding: "10px 18px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {groups.filter(([, [, p]]) => p > 0).map(([n, [k, p]]) => (
                  <div key={n} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "16px" }}>{n}</span>
                      <span class="k-n" style={{ fontSize: "15px", color: k < p ? "#aeaeb2" : "#f5f5f7" }}>{k} из {p}</span>
                    </span>
                    <span role="img" aria-label={`${n}: сделано ${k} из ${p}`} style={{ display: "flex", gap: p > 30 ? "1px" : "4px", height: 10 }}>
                      {Array.from({ length: p }, (_, i) => (
                        <i key={i} style={{ display: "block", flex: 1, height: "100%", borderRadius: 3, background: i < k ? GREEN : GREY }} />
                      ))}
                    </span>
                  </div>
                ))}
                {!t.total && <span class="k-cap">Задач с датой в этом периоде не было</span>}
              </div>
            </section>
            {t.overdue.length > 0 && (
              <section class="k-card clip">
                <div class="k-cardhead" style={{ paddingBottom: 4 }}>
                  <h2 class="k-h2">Просрочены</h2>
                  <span class="k-n">{t.overdue.length}</span>
                </div>
                {t.overdue.map((x) => <TaskLine key={x.id} t={x} sub={wasOn(x.date!)} />)}
              </section>
            )}
            {t.inbox.length > 0 && (
              <section class="k-card clip">
                <div class="k-cardhead" style={{ paddingBottom: 4 }}>
                  <h2 class="k-h2">Без даты</h2>
                  <span class="k-n">{t.inbox.length}</span>
                </div>
                {t.inbox.map((x) => <TaskLine key={x.id} t={x} assign />)}
              </section>
            )}
          </>
        );
      }}
    />
  );
}

