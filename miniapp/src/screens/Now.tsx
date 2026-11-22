import { Num } from "../components/Num";
import { Icon, Sec, Seg } from "../components/ui";
import { post } from "../lib/api";
import { runs, smooth } from "../lib/chart";
import { dur, hhmm, ZONE_DOT, ZONE_NAME } from "../lib/format";
import { haptic } from "../lib/haptic";
import { openSheet } from "../lib/router";
import { invalidateSoon, mutate, resource, setData } from "../lib/store";
import type { NowView } from "../lib/types";

const FEEL_T: Record<string, number> = { low: 30, ok: 58, high: 82 };
const ZONE_LINE: Record<string, string> = {
  focus: "Пик дня. Делай самое сложное — то, что вечером не потянешь.",
  steady: "Ровная энергия: рутина, переписка, обычные дела.",
  recharge: "Низкая энергия. Отдохни или займись лёгким.",
  sleep: "По модели сейчас время сна. Индекс считается для бодрствования.",
};

export function NowScreen() {
  const d = resource<NowView>("/views/now").value.data;
  if (!d) {
    return (
      <div class="page">
        <header class="head">
          <h1 class="h1">Сейчас</h1>
        </header>
        <main class="main">
          <div class="card skel" style={{ height: "220px" }} />
          <div class="card skel" style={{ height: "240px" }} />
        </main>
      </div>
    );
  }
  const z = d.zone;
  return (
    <div class="page">
      <header class="head head-end">
        <div>
          <h1 class="h1">Сейчас</h1>
          <div class="subhead">{hhmm(d.now_min)} · индекс энергии</div>
        </div>
        <button class="ib" aria-label="Разбор от Claude" onClick={() => openSheet("claude")}>
          <Icon name="spark" />
        </button>
      </header>
      <main class="main" style={{ paddingTop: "20px" }}>
        <section class="card" style={{ padding: "22px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span class="mono" style={{ fontSize: "88px", lineHeight: "84px", fontWeight: 500, letterSpacing: "-0.05em" }}>
              <Num value={d.idx} />
            </span>
            <span class="mono" style={{ fontSize: "20px", color: "var(--muted)" }}>
              /100
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px" }}>
            <span class="zd" style={{ background: ZONE_DOT[z] ?? "var(--dim)", width: "10px", height: "10px" }} />
            <span style={{ fontSize: "20px", fontWeight: 600 }}>{ZONE_NAME[z]}</span>
            {d.window && <span class="s">до {hhmm(d.window.end)}</span>}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>{ZONE_LINE[z]}</p>
          {!d.sleep_logged && (
            <div class="note" style={{ marginTop: "14px", background: "var(--raised)" }}>
              <span class="s grow" style={{ color: "var(--soft)" }}>
                Сон за сегодня не отмечен — модель взяла твой обычный режим.
              </span>
              <button class="btn" onClick={() => openSheet("sleep", { date: d.today })}>
                Отметить
              </button>
            </div>
          )}
          <div class="s" style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
            <span>Следующее окно Focus</span>
            <span class="mono" style={{ color: "var(--text)" }}>
              {d.next_focus ? `${hhmm(d.next_focus.start)}–${hhmm(d.next_focus.end)}` : "сегодня нет"}
            </span>
          </div>
        </section>

        <FeelBlock d={d} />
        <EnergyChart d={d} />

        <section>
          <Sec title="Окна на сегодня" />
          <div class="card list">
            {d.windows.map((w) => (
              <div class="row" key={w.start}>
                <span class="zd" style={{ background: ZONE_DOT[w.zone] }} />
                <span class="t" style={{ flex: 1 }}>
                  {ZONE_NAME[w.zone]}
                </span>
                {d.now_min >= w.start && d.now_min < w.end && (
                  <span class="s" style={{ marginRight: "6px" }}>
                    сейчас
                  </span>
                )}
                <span class="mono" style={{ fontSize: "15px", color: d.now_min >= w.end ? "var(--muted)" : undefined }}>
                  {hhmm(w.start)}–{hhmm(w.end)}
                </span>
              </div>
            ))}
            {d.train && (
              <div class="row">
                <Icon name="dumbbell" size={18} style={{ color: "var(--muted)" }} />
                <span class="t" style={{ flex: 1 }}>
                  Лучшее для тренировки
                </span>
                <span class="mono" style={{ fontSize: "15px" }}>
                  {hhmm(d.train.start)}–{hhmm(d.train.end)}
                </span>
              </div>
            )}
          </div>
        </section>

        <Factors d={d} />
        <Hormones d={d} />
      </main>
    </div>
  );
}

function FeelBlock({ d }: { d: NowView }) {
  const last = d.last_feel;
  const pred = d.idx;
  const note = last
    ? `Последняя отметка в ${last.t}: ${Math.abs(last.err ?? 0) < 8 ? "совпало с прогнозом" : (last.err ?? 0) > 0 ? "выше прогноза, модель подняла оценку" : "ниже прогноза, модель снизила оценку"}.`
    : "Модель сравнит ответ со своим прогнозом и со временем подстроится под тебя.";
  const pick = (v: string) =>
    mutate({
      apply: () =>
        setData<NowView>("/views/now", (x) => ({
          ...x,
          last_feel: { t: hhmm(x.now_min), v, pred, err: pred != null ? FEEL_T[v]! - pred : null },
        })),
      request: () => post<{ message: string }>("/feel", { v }),
      refresh: ["/views/now", "/views/day", "/settings"],
    }).then((r) => {
      if (r) {
        haptic.light();
        invalidateSoon("/views/now");
      }
    });
  return (
    <section>
      <Sec title="Как ты себя чувствуешь?" />
      <Seg
        label="Самочувствие"
        options={[
          ["low", "Низко"],
          ["ok", "Нормально"],
          ["high", "Бодро"],
        ]}
        value={(last?.v ?? "") as string}
        onChange={(v) => void pick(v)}
      />
      <div class="s" style={{ margin: "10px 4px 0" }}>
        {note}
      </div>
    </section>
  );
}

function EnergyChart({ d }: { d: NowView }) {
  const W = 330, T = 10, H = 150;
  const x = (i: number) => (i / (d.curve.length - 1)) * W;
  const yv = (v: number) => T + H - (v / 100) * H;
  // Draw every 15 minutes: 5-minute integer steps look jagged when smoothed.
  const lines = runs(
    d.curve.map((v, i) => (i % 3 === 0 ? v : null)).filter((_, i) => i % 3 === 0),
    (v, i) => [x(i * 3), yv(v)],
  );
  const nowI = Math.round((d.now_min - 300) / 5);
  const nowV = d.curve[nowI] ?? null;
  const nowX = x(Math.max(0, Math.min(d.curve.length - 1, nowI)));
  const hi = Math.max(45, d.q_hi);
  const lo = Math.max(0, d.q_lo);
  const band = (top: number, bottom: number) => yv(bottom) - yv(top) >= 14;
  const xl = [0, 4, 8, 12, 16, 20, 24].map((h) => ({ x: (h / 24) * W, l: String((5 + h) % 24).padStart(2, "0") }));
  return (
    <section>
      <Sec title="Энергия за день" />
      <div class="card" style={{ padding: "18px 14px 16px" }}>
        <svg viewBox="0 0 330 190" role="img" aria-label={`Энергия за день: максимум ${d.max}`} style={{ width: "100%", height: "190px", display: "block", overflow: "visible" }}>
          <rect x="0" y={yv(100)} width="330" height={yv(hi) - yv(100)} rx="6" style={{ fill: "rgba(255,45,85,0.10)" }} />
          <rect x="0" y={yv(hi)} width="330" height={yv(lo) - yv(hi)} style={{ fill: "rgba(31,58,122,0.30)" }} />
          <rect x="0" y={yv(lo)} width="330" height={yv(0) - yv(lo)} rx="6" style={{ fill: "rgba(72,72,74,0.14)" }} />
          {band(100, hi) && <text x="6" y={(yv(100) + yv(hi)) / 2 + 4} class="ax" style={{ fill: "var(--accent-text)" }}>Focus</text>}
          {band(hi, lo) && <text x="6" y={(yv(hi) + yv(lo)) / 2 + 4} class="ax" style={{ fill: "var(--steady-text)" }}>Steady</text>}
          {band(lo, 0) && <text x="6" y={(yv(lo) + yv(0)) / 2 + 4} class="ax">Recharge</text>}
          <line x1="0" x2="330" y1={yv(hi)} y2={yv(hi)} style={{ stroke: "var(--fill-2)", strokeDasharray: "2 4" }} />
          <line x1="0" x2="330" y1={yv(lo)} y2={yv(lo)} style={{ stroke: "var(--fill-2)", strokeDasharray: "2 4" }} />
          {lines.map((pts, i) => {
            const path = smooth(pts);
            return (
              <g key={i}>
                <path class="fade-in" d={`${path} L${pts[pts.length - 1]![0].toFixed(1)} ${T + H} L${pts[0]![0].toFixed(1)} ${T + H} Z`} style={{ fill: "rgba(245,245,247,0.07)" }} />
                <path class="draw" pathLength={1} d={path} style={{ fill: "none", stroke: "var(--text)", strokeWidth: 2.25, strokeLinecap: "round" }} />
              </g>
            );
          })}
          {nowV != null && (
            <>
              <line x1={nowX} x2={nowX} y1={yv(nowV)} y2={160} style={{ stroke: "var(--accent)", strokeWidth: 1.25, strokeDasharray: "2 3" }} />
              <circle class="pop-in" cx={nowX} cy={yv(nowV)} r="5" style={{ "--i": 12, fill: "var(--accent)", stroke: "var(--card)", strokeWidth: 2.5 }} />
              <rect x={nowX - 20} y={yv(nowV) - 32} width="40" height="20" rx="10" style={{ fill: "var(--accent)" }} />
              <text x={nowX} y={yv(nowV) - 18} text-anchor="middle" style={{ font: "500 11px var(--mono)", fill: "#fff" }}>{nowV}</text>
            </>
          )}
          {xl.map((t) => (
            <text key={t.l + t.x} x={t.x} y="182" text-anchor="middle" class="ax">{t.l}</text>
          ))}
        </svg>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--line)" }}>
          <div>
            <div class="s">Среднее</div>
            <Num class="mono" style={{ fontSize: "20px", marginTop: "2px", display: "block" }} value={d.avg} />
          </div>
          <div>
            <div class="s">Максимум</div>
            <div class="mono" style={{ fontSize: "20px", marginTop: "2px" }}>
              {d.max >= 0 ? d.max : "—"} <span style={{ fontSize: "12px", color: "var(--muted)" }}>{d.max_at != null ? hhmm(d.max_at) : ""}</span>
            </div>
          </div>
          <div>
            <div class="s">Минимум</div>
            <div class="mono" style={{ fontSize: "20px", marginTop: "2px" }}>
              {d.min <= 100 ? d.min : "—"} <span style={{ fontSize: "12px", color: "var(--muted)" }}>{d.min_at != null ? hhmm(d.min_at) : ""}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function factorNote(d: NowView, key: string, fallback: string): string {
  if (key === "debt") return `${dur(d.debt_h * 60)} за неделю`;
  if (key === "late") return `на ${dur(d.late_min)} позже нормы`;
  if (key === "irr" && d.irr_sd_h != null) return `середина сна гуляет на ${dur(d.irr_sd_h * 60)}`;
  if (key === "q") return `«${fallback.charAt(0).toUpperCase()}${fallback.slice(1)}»`;
  return fallback;
}

function Factors({ d }: { d: NowView }) {
  const rows = d.factors.map((f) => ({ ...f, note: factorNote(d, f.key, f.note) }));
  return (
    <section>
      <Sec title="Что влияет на индекс" end="баллы" />
      <div class="card list">
        {rows.length === 0 && d.personal === 0 && (
          <div class="row">
            <span class="s">Сон в норме — ничего не тянет индекс вниз.</span>
          </div>
        )}
        {rows.map((f) => (
          <div class="row" key={f.key}>
            <span class="col-text">
              <span class="t">{f.label === "Долг сна за 7 дней" ? "Долг сна" : f.label}</span>
              <span class="s">{f.note}</span>
            </span>
            <span class="mono" style={{ fontSize: "17px" }}>
              {f.val > 0 ? `+${f.val}` : `−${Math.abs(f.val)}`}
            </span>
          </div>
        ))}
        {d.personal_n > 0 && (
          <div class="row">
            <span class="col-text">
              <span class="t">Личная поправка</span>
              <span class="s">по твоим ответам о самочувствии</span>
            </span>
            <span class="mono" style={{ fontSize: "17px" }}>
              {d.personal > 0 ? `+${d.personal}` : d.personal < 0 ? `−${Math.abs(d.personal)}` : "0"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

const LOOK: [string, string, number, string, keyof NowView["hormones"]][] = [
  ["Бодрость", "#f5f5f7", 3, "none", "alertness"],
  ["Мотивация", "#ff2d55", 2.75, "none", "motivation"],
  ["Кортизол", "#a1a1a6", 2.25, "6 5", "cortisol"],
  ["Мелатонин", "#6d8ee8", 2.5, "1 5", "melatonin"],
];

function Hormones({ d }: { d: NowView }) {
  const h = d.hormones;
  const n = h.alertness.length;
  const x = (i: number) => (i / (n - 1)) * 330;
  const yh = (v: number) => 10 + 136 - v * 136;
  const hX = x(Math.max(0, Math.min(n - 1, (d.now_min - 300) / 15)));
  const nowKey: Record<string, string> = { alertness: "alertness", motivation: "motivation", cortisol: "cortisol", melatonin: "melatonin" };
  const peak = (h.now?.motivation ?? 0) > 0.6 && (h.now?.alertness ?? 0) > 0.6;
  return (
    <section>
      <Sec title="Гормоны и мотивация" end="оценка" />
      <div class="card" style={{ padding: "18px 14px 16px" }}>
        <svg viewBox="0 0 330 170" role="img" aria-label="Модельные кривые бодрости, мотивации, кортизола и мелатонина" style={{ width: "100%", height: "170px", display: "block", overflow: "visible" }}>
          <line x1="0" x2="330" y1="146" y2="146" style={{ stroke: "var(--line)" }} />
          <line x1="0" x2="330" y1="92" y2="92" style={{ stroke: "var(--line-faint)" }} />
          <line x1="0" x2="330" y1="38" y2="38" style={{ stroke: "var(--line-faint)" }} />
          <line x1={hX} x2={hX} y1="0" y2="146" style={{ stroke: "var(--accent)", strokeWidth: 1.25, strokeDasharray: "2 3" }} />
          {LOOK.map(([, c, w, dash, k], li) => (
            <path key={k} class={dash === "none" ? "draw" : "fade-in"} pathLength={dash === "none" ? 1 : undefined} d={smooth((h[k] as number[]).map((v, i) => [x(i), yh(v)]))} style={{ "--i": li, fill: "none", stroke: c, strokeWidth: w, strokeDasharray: dash === "none" ? undefined : dash, strokeLinecap: "round" }} />
          ))}
          {h.now &&
            LOOK.map(([, c, , , k]) => (
              <circle key={k} cx={hX} cy={yh(h.now![nowKey[k]!] ?? 0)} r="4" style={{ fill: c, stroke: "var(--card)", strokeWidth: 2 }} />
            ))}
          {[0, 4, 8, 12, 16, 20, 24].map((hh) => (
            <text key={hh} x={(hh / 24) * 330} y="164" text-anchor="middle" class="ax">
              {String((5 + hh) % 24).padStart(2, "0")}
            </text>
          ))}
        </svg>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px", marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--line)" }}>
          {LOOK.map(([name, c, , dash, k]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="22" height="6" aria-hidden="true" style={{ flex: "none" }}>
                <line x1="2" x2="20" y1="3" y2="3" style={{ stroke: c, strokeWidth: 3, strokeDasharray: dash, strokeLinecap: "round" }} />
              </svg>
              <span style={{ flex: 1, fontSize: "14px", color: "var(--soft)" }}>{name}</span>
              <span class="mono" style={{ fontSize: "14px" }}>
                {h.now ? Math.round((h.now[nowKey[k]!] ?? 0) * 100) : "—"}
              </span>
            </div>
          ))}
        </div>
        <p style={{ margin: "14px 2px 0", fontSize: "14px", lineHeight: "20px", color: "var(--soft)" }}>
          {peak ? "Мотивация и бодрость на пике — лучшее время для сложного." : "Сложное лучше ставить в окна Focus."} Мелатонин начнёт расти около {hhmm(h.melatonin_rise)}.
        </p>
      </div>
      <div class="s" style={{ margin: "10px 4px 0" }}>
        Модельная оценка по сну и режиму, не измерение.
      </div>
    </section>
  );
}
