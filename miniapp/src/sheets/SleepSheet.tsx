/** «Прошлая ночь» (SleepSheetGlass): drag the moon (bed) and the sun (wake) around the dial,
 * the duration counts itself; the rating «Плохо / Нормально / Хорошо» feeds the energy score. */

import { useRef, useState } from "preact/hooks";
import { Sheet } from "../components/ui";
import { MOON, SUN_RAYS } from "../components/icons";
import { dayKey, saveSleep } from "../lib/actions";
import { addDays, parseDate, toMin } from "../lib/format";
import { haptic } from "../lib/haptic";
import { closeSheet } from "../lib/router";
import { entry, resource } from "../lib/store";
import type { DayView, Settings } from "../lib/types";

const C = 140;
const R = 106;
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const QUALITY: ["bad" | "ok" | "good", string][] = [["bad", "Плохо"], ["ok", "Нормально"], ["good", "Хорошо"]];

const norm = (m: number) => ((m % 1440) + 1440) % 1440;
const fmt = (m: number) => `${Math.floor(norm(m) / 60)}:${String(norm(m) % 60).padStart(2, "0")}`;
const hhmm = (m: number) => `${String(Math.floor(norm(m) / 60)).padStart(2, "0")}:${String(norm(m) % 60).padStart(2, "0")}`;
const pos = (m: number): [number, number] => {
  const a = (m / 1440) * 2 * Math.PI;
  return [C + R * Math.sin(a), C - R * Math.cos(a)];
};

/** "Вт 24 – Ср 25 ноября": the night that ended on `iso`. */
function nightLabel(iso: string): string {
  const d = parseDate(iso);
  const p = parseDate(addDays(iso, -1));
  return `${WD[p.getUTCDay()]} ${p.getUTCDate()} – ${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

export function SleepSheet({ date }: { date: string }) {
  const today = entry<DayView>("/views/day").value.data?.today;
  const day = resource<DayView>(dayKey(date === today ? null : date)).value.data;
  const st = resource<Settings>("/settings").value.data;
  const [b, setB] = useState(() => toMin(day?.sleep?.bed ?? st?.usual_bed ?? "23:30")!);
  const [w, setW] = useState(() => toMin(day?.sleep?.wake ?? st?.usual_wake ?? "07:30")!);
  const [q, setQ] = useState<"bad" | "ok" | "good">(day?.sleep?.quality ?? "ok");
  const drag = useRef<"b" | "w" | null>(null);
  const tick = useRef(-1);

  const len = norm(w - b);
  const a0 = (b / 1440) * 360;
  const arc = (len / 1440) * 360;
  const [bX, bY] = pos(b);
  const [wX, wY] = pos(w);

  const angle = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    let a = Math.atan2(x, -y) / (2 * Math.PI);
    if (a < 0) a += 1;
    return (Math.round((a * 1440) / 5) * 5) % 1440;
  };
  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    const m = angle(e);
    const t = Math.floor(m / 15);
    if (t !== tick.current) {
      tick.current = t;
      haptic.selection(); // every 15 minutes
    }
    if (drag.current === "b") setB(m);
    else setW(m);
  };
  const down = (which: "b" | "w") => (e: PointerEvent) => {
    e.stopPropagation();
    drag.current = which;
    (e.currentTarget as HTMLElement).parentElement?.setPointerCapture(e.pointerId);
  };
  const key = (which: "b" | "w") => (e: KeyboardEvent) => {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 5 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -5 : 0;
    if (!d) return;
    e.preventDefault();
    if (which === "b") setB(norm(b + d));
    else setW(norm(w + d));
  };
  const save = async () => {
    if (len < 30) return;
    if (await saveSleep(date, { bed: hhmm(b), wake: hhmm(w), quality: q }, len)) closeSheet();
  };

  return (
    <Sheet label="Сон за прошлую ночь">
      <div style={{ textAlign: "center", marginTop: "-2px" }}>
        <h2 style={{ margin: 0, fontSize: "22px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.02em" }}>Прошлая ночь</h2>
        <p class="k-cap" style={{ margin: "2px 0 0", fontSize: "14px" }}>
          {nightLabel(date)}
        </p>
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
        {([["Лёг", b, true], ["Встал", w, false]] as const).map(([l, m, moon]) => (
          <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
            <span class="k-cap" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              {moon ? (
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, fill: "#8e8e93" }}>
                  <path d={MOON} />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, fill: "none", stroke: "#8e8e93", strokeWidth: 1.8, strokeLinecap: "round" }}>
                  <circle cx="12" cy="12" r="4" fill="#8e8e93" />
                  <path d={SUN_RAYS} />
                </svg>
              )}
              {l}
            </span>
            <span class="k-n" style={{ fontSize: "40px", lineHeight: "46px", fontWeight: 400, letterSpacing: "-0.03em" }}>
              {fmt(m)}
            </span>
          </div>
        ))}
      </div>
      <div
        data-own-drag
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        style={{ position: "relative", width: "280px", height: "280px", margin: "0 auto", touchAction: "none", flex: "none" }}
      >
        <div aria-hidden="true" style={{ position: "absolute", inset: "16px", borderRadius: "50%", background: "#222227" }} />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "16px",
            borderRadius: "50%",
            background: `conic-gradient(from ${a0}deg, #5a2dff 0deg, #5a2dff ${arc * 0.8}deg, #9a7dff ${arc * 0.92}deg, #f0b97a ${arc}deg, transparent ${arc}deg)`,
            WebkitMask: "radial-gradient(circle, transparent 90.5px, #000 91.0px, #000 121.0px, transparent 121.5px)",
            mask: "radial-gradient(circle, transparent 90.5px, #000 91.0px, #000 121.0px, transparent 121.5px)",
          }}
        />
        <div aria-hidden="true" style={{ position: "absolute", inset: "52px", borderRadius: "50%", background: "#121215", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5)" }} />
        <svg aria-hidden="true" viewBox="0 0 280 280" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {Array.from({ length: 48 }, (_, i) => {
            const a = (i / 48) * 2 * Math.PI;
            const major = i % 2 === 0;
            const r1 = 77;
            const r2 = major ? 71 : 73.1;
            return (
              <line
                key={i}
                x1={(C + r1 * Math.sin(a)).toFixed(1)}
                y1={(C - r1 * Math.cos(a)).toFixed(1)}
                x2={(C + r2 * Math.sin(a)).toFixed(1)}
                y2={(C - r2 * Math.cos(a)).toFixed(1)}
                stroke={major ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.14)"}
                stroke-width="1.4"
                stroke-linecap="round"
              />
            );
          })}
          {([["00", 140, 88], ["06", 196, 144], ["12", 140, 200], ["18", 84, 144]] as const).map(([t, x, y]) => (
            <text key={t} x={x} y={y} text-anchor="middle" font-size="12" font-weight="500" fill="#8e8e93" font-family="Geist, system-ui">
              {t}
            </text>
          ))}
        </svg>
        {([["b", bX, bY, "Лёг спать", b], ["w", wX, wY, "Встал", w]] as const).map(([k, x, y, label, m]) => (
          <div
            key={k}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuetext={fmt(m)}
            onPointerDown={down(k)}
            onKeyDown={key(k)}
            style={{ position: "absolute", left: `${x}px`, top: `${y}px`, width: 44, height: 44, margin: "-22px 0 0 -22px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", touchAction: "none" }}
          >
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#2c2c32", boxShadow: "0 1px 4px rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {k === "b" ? (
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16, fill: "#f5f5f7" }}>
                  <path d={MOON} />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 17, height: 17, fill: "none", stroke: "#f5f5f7", strokeWidth: 1.8, strokeLinecap: "round" }}>
                  <circle cx="12" cy="12" r="4" fill="#f5f5f7" />
                  <path d={SUN_RAYS} />
                </svg>
              )}
            </span>
          </div>
        ))}
      </div>
      <p class="k-n" style={{ margin: "-4px 0 0", textAlign: "center", fontSize: "20px", lineHeight: "26px" }}>
        {Math.floor(len / 60)} ч {len % 60 ? `${len % 60} мин ` : ""}
        <span style={{ fontSize: "15px", color: "#8e8e93" }}>сна</span>
      </p>
      <div>
        <div style={{ fontSize: "15px", color: "#aeaeb2", margin: "0 2px 8px" }}>Как спалось?</div>
        <div class="k-feel">
          {QUALITY.map(([v, t]) => (
            <button
              key={v}
              aria-pressed={q === v}
              style={{ fontSize: "16px" }}
              onClick={() => {
                haptic.selection();
                setQ(v);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <button class="k-save" onClick={() => void save()}>
        Сохранить
      </button>
    </Sheet>
  );
}
