import { useState } from "preact/hooks";
import { Num } from "../components/Num";
import { Icon, Sec, Seg } from "../components/ui";
import { smooth } from "../lib/chart";
import { hhmm, parseDate, shortDate, weekdayShort } from "../lib/format";
import { haptic } from "../lib/haptic";
import { openSheet } from "../lib/router";
import { resource } from "../lib/store";
import type { ReviewView, Status } from "../lib/types";

const LV = ["var(--fill)", "#4a1420", "#8a1d36", "#c9244a", "#ff2d55"];
const lvl = (v: number) => (v < 20 ? 0 : v < 40 ? 1 : v < 60 ? 2 : v < 80 ? 3 : 4);
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DOT: Record<Status, string> = {
  done: "var(--accent)",
  missed: "var(--fill)",
  rest: "transparent",
  pending: "var(--fill-2)",
  nodata: "transparent",
  future: "transparent",
};

export function ReviewScreen() {
  const [period, setPeriod] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<string | null>(null);
  const key = `/views/review?period=${period}${anchor ? `&anchor=${anchor}` : ""}`;
  const d = resource<ReviewView>(key).value.data;
  const [all, setAll] = useState(false);

  const go = (a: string | null) => {
    haptic.light();
    setAnchor(a);
  };

  return (
    <div class="page">
      <header class="head head-end">
        <div>
          <h1 class="h1">Итоги</h1>
          <div class="subhead" style={{ display: "flex", alignItems: "center", gap: "2px", marginLeft: "-10px" }}>
            <button class="ib" style={{ width: "32px", height: "32px", color: "var(--muted)" }} aria-label="Предыдущий период" onClick={() => d && go(d.prev_anchor)}>
              <Icon name="left" size={16} />
            </button>
            <span>{d?.label ?? "…"}</span>
            <button
              class="ib"
              style={{ width: "32px", height: "32px", color: d?.next_anchor ? "var(--muted)" : "var(--dim)" }}
              aria-label="Следующий период"
              disabled={!d?.next_anchor}
              onClick={() => d?.next_anchor && go(d.next_anchor)}
            >
              <Icon name="right" size={16} />
            </button>
          </div>
        </div>
        <button class="ib" aria-label="Разбор от Claude" onClick={() => openSheet("claude")}>
          <Icon name="spark" />
        </button>
      </header>

      <main class="main">
        <Seg
          short
          label="Период"
          options={[
            ["month", "Месяц"],
            ["week", "Неделя"],
          ]}
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setAnchor(null);
          }}
        />
        {!d ? (
          <div class="card skel" style={{ height: "220px", marginTop: "-16px" }} />
        ) : (
          <>
            <ScoreBlock d={d} />
            <section>
              <Sec title="Где проседаешь" />
              <div class="card list">
                {d.alerts.length === 0 && (
                  <div class="row">
                    <span class="t">Провалов за период нет. Держи темп.</span>
                  </div>
                )}
                {(all ? d.alerts : d.alerts.slice(0, 3)).map((a) => (
                  <div class="row" key={a.kind + a.title} style={{ alignItems: "flex-start", paddingTop: "13px", paddingBottom: "13px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: a.severe ? "var(--accent)" : "var(--muted)", marginTop: "8px", flex: "none" }} />
                    <span class="col-text">
                      <span class="t">{a.title}</span>
                      {a.subtitle && <span class="s">{a.subtitle}</span>}
                    </span>
                  </div>
                ))}
                {d.alerts.length > 3 && (
                  <button class="plain row" style={{ color: "var(--muted)", fontSize: "15px" }} onClick={() => setAll(!all)}>
                    {all ? "Свернуть" : `Ещё ${d.alerts.length - 3}`}
                  </button>
                )}
              </div>
            </section>

            <section>
              <Sec title="Выполнение" />
              <div class="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", padding: "16px" }}>
                <div>
                  <div class="s">Привычки</div>
                  <div class="mono" style={{ fontSize: "24px", marginTop: "2px" }}>{d.habits_pct != null ? <><Num value={d.habits_pct} />%</> : "—"}</div>
                </div>
                <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: "14px" }}>
                  <div class="s">Задачи</div>
                  <div class="mono" style={{ fontSize: "24px", marginTop: "2px" }}>{d.tasks_pct != null ? <><Num value={d.tasks_pct} />%</> : "—"}</div>
                </div>
                <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: "14px" }}>
                  <div class="s">Закрыто</div>
                  <div class="mono" style={{ fontSize: "24px", marginTop: "2px" }}>{d.tasks_done}</div>
                </div>
              </div>
              {d.habits.length > 0 && (
                <div class="card list" style={{ marginTop: "8px" }}>
                  {d.habits.map((h) => (
                    <div class="row" key={h.id} style={{ flexWrap: "wrap", rowGap: "10px", paddingTop: "13px", paddingBottom: "13px" }}>
                      <span class="t" style={{ flex: 1 }}>{h.name}</span>
                      <span class="mono" style={{ fontSize: "15px" }}>{h.pct != null ? `${h.pct}%` : "—"}</span>
                      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: period === "week" ? "5px" : "2px", flexWrap: "wrap" }}>
                        {h.dots.map((s, i) => (
                          <span
                            key={i}
                            title={s}
                            style={{
                              width: period === "week" ? "18px" : "7px",
                              height: period === "week" ? "18px" : "14px",
                              borderRadius: period === "week" ? "6px" : "3px",
                              background: DOT[s],
                              boxShadow: s === "rest" ? "inset 0 0 0 1px var(--fill-2)" : "none",
                            }}
                          />
                        ))}
                        <span class="s mono" style={{ marginLeft: "auto", fontSize: "12px" }}>
                          серия {h.streak} · лучшая {h.best}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {d.spheres.length > 0 && (
              <section>
                <Sec title="Серии по сферам" end="дней" />
                <div class="card">
                  <table class="tbl">
                    <thead>
                      <tr>
                        <th>Сфера</th>
                        <th>Сейчас</th>
                        <th>Лучшая</th>
                        <th>Выполнено</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.spheres.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td class="mono">{s.streak}</td>
                          <td class="mono" style={{ color: "var(--muted)" }}>{s.best}</td>
                          <td class="mono">{s.pct != null ? `${s.pct}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <Bedtimes d={d} />

            <button class="btn lg card-btn" onClick={() => openSheet("claude")}>
              <Icon name="spark" />
              Разбор {period === "month" ? "месяца" : "недели"} от Claude
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function ScoreBlock({ d }: { d: ReviewView }) {
  if (d.period === "week") {
    return (
      <section class="card" style={{ padding: "18px 16px 16px", marginTop: "-16px" }}>
        <Head avg={d.avg} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "10px", alignItems: "end", height: "150px" }}>
          {d.scores.map((b, i) => {
            const last = i === d.scores.length - 1 || b.date === d.end;
            return (
              <div key={b.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                <span class="mono" style={{ fontSize: "11px", color: last ? "var(--text)" : "var(--muted)" }}>{b.pct ?? ""}</span>
                <span class="grow-y" style={{ "--i": i, width: "100%", height: `${b.pct == null ? 2 : Math.max(3, Math.round(b.pct * 1.1))}px`, borderRadius: "8px", background: b.pct == null ? "var(--fill)" : last ? "var(--accent)" : "var(--fill-2)" }} />
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>{weekdayShort(b.date)}</span>
              </div>
            );
          })}
        </div>
      </section>
    );
  }
  const first = parseDate(d.start).getUTCDay();
  const lead = (first + 6) % 7;
  return (
    <section class="card" style={{ padding: "18px 16px 16px", marginTop: "-16px" }}>
      <Head avg={d.avg} />
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
        <div style={{ flex: "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 20px)", gap: "4px", marginBottom: "4px" }}>
            {DOW.map((w) => (
              <span key={w} style={{ fontSize: "9px", lineHeight: "12px", textAlign: "center", color: "var(--muted)" }}>{w}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 20px)", gap: "4px" }} role="img" aria-label="Рейтинг по дням">
            {Array.from({ length: lead }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {d.scores.map((b, i) => (
              <span
                key={b.date}
                class="pop-in"
                title={`${shortDate(b.date)}${b.pct != null ? ` · ${b.pct}%` : ""}`}
                style={{
                  "--i": i,
                  width: "20px",
                  height: "20px",
                  borderRadius: "5px",
                  background: b.pct == null ? "transparent" : LV[lvl(b.pct)],
                  boxShadow: b.pct == null ? "inset 0 0 0 1px var(--line)" : b.date === d.best_day?.date ? "0 0 0 1.5px var(--card), 0 0 0 3px var(--text)" : "none",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "10px", fontSize: "10px", color: "var(--muted)" }}>
            меньше
            {LV.map((c) => (
              <span key={c} style={{ width: "9px", height: "9px", borderRadius: "2px", background: c }} />
            ))}
            больше
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px", paddingTop: "14px" }}>
          <div>
            <div class="mono" style={{ fontSize: "22px" }}>{d.days_70}</div>
            <div class="s">дней ≥ 70%</div>
          </div>
          <div>
            <div class="mono" style={{ fontSize: "22px" }}>{d.best_run_70}</div>
            <div class="s">лучшая серия</div>
          </div>
          {d.best_day && (
            <div>
              <div class="mono" style={{ fontSize: "22px" }}>{shortDate(d.best_day.date)}</div>
              <div class="s">лучший день · {d.best_day.pct}%</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Head({ avg }: { avg: number | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "14px" }}>
      <span class="t" style={{ fontWeight: 500 }}>Выкладывание</span>
      <span class="s">
        среднее <span class="mono" style={{ color: "var(--text)" }}>{avg != null ? <><Num value={avg} />%</> : "—"}</span>
      </span>
    </div>
  );
}

function Bedtimes({ d }: { d: ReviewView }) {
  const goal = d.bed_goal;
  const beds = d.nights.map((n) => n.bed).filter((b): b is number => b != null);
  const lo = Math.min(goal - 120, ...beds);
  const hi = Math.max(goal + 180, ...beds);
  const top = Math.floor(lo / 60) * 60;
  const bottom = Math.ceil(hi / 60) * 60;
  const yOf = (m: number) => 10 + ((m - top) / (bottom - top)) * 150;
  const ticks: number[] = [];
  const step = bottom - top > 360 ? 120 : 60;
  for (let m = top; m <= bottom; m += step) ticks.push(m);
  const pts = d.nights.map((n, i) => (n.bed != null ? ([52 + i * 20.5, yOf(n.bed)] as [number, number]) : null));
  const line = pts.filter((p): p is [number, number] => p !== null);
  const onTime = d.nights.filter((n) => n.on_time).length;
  return (
    <section>
      <Sec title="Отбой · 14 ночей" end={`норма ${hhmm(goal)}`} />
      <div class="card" style={{ padding: "14px 14px 14px 10px" }}>
        <div class="s" style={{ fontSize: "12px", margin: "0 0 6px 4px" }}>↑ раньше — вечер</div>
        <svg viewBox="0 0 330 180" role="img" aria-label={`Время отбоя за 14 ночей, вовремя ${onTime} из ${d.nights.length}`} style={{ width: "100%", height: "180px", display: "block", overflow: "visible" }}>
          <rect x="44" y={yOf(top)} width="286" height={Math.max(0, yOf(goal) - yOf(top))} rx="6" style={{ fill: "rgba(245,245,247,0.04)" }} />
          {ticks.map((m) => (
            <g key={m}>
              <line x1="44" x2="330" y1={yOf(m)} y2={yOf(m)} style={{ stroke: "var(--line)" }} />
              <text x="0" y={yOf(m) + 4} class="ax" style={{ fontSize: "12px", fill: "var(--subtle)" }}>{hhmm(m)}</text>
            </g>
          ))}
          <line x1="44" x2="330" y1={yOf(goal)} y2={yOf(goal)} style={{ stroke: "var(--accent)", strokeWidth: 1.25, strokeDasharray: "4 4" }} />
          {line.length > 1 && <path class="draw" pathLength={1} d={smooth(line)} style={{ fill: "none", stroke: "var(--faint)", strokeWidth: 1.75, strokeLinecap: "round" }} />}
          {d.nights.map((n, i) =>
            n.bed == null ? null : (
              <circle key={n.date} class="pop-in" cx={52 + i * 20.5} cy={yOf(n.bed)} r="5" style={{ "--i": i, fill: n.on_time ? "var(--text)" : "var(--card)", stroke: n.on_time ? "var(--text)" : "var(--muted)", strokeWidth: 1.75 }} />
            ),
          )}
        </svg>
        <div class="s" style={{ fontSize: "12px", margin: "4px 0 0 4px" }}>↓ позже — глубокая ночь</div>
        <div style={{ display: "flex", gap: "16px", margin: "12px 0 0 4px", fontSize: "12px", color: "var(--muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "var(--text)" }} />в норме
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "9px", height: "9px", borderRadius: "50%", border: "1.75px solid var(--muted)" }} />позже
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "14px", borderTop: "1.5px dashed var(--accent)" }} />норма
          </span>
        </div>
      </div>
    </section>
  );
}
