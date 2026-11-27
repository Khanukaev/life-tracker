/** Energy forecast for the day plus «Как ты себя чувствуешь?» (EnergySheetGlass). */

import { useState } from "preact/hooks";
import { Sheet } from "../components/ui";
import { MOON } from "../components/icons";
import { sendFeel } from "../lib/actions";
import { hhmm } from "../lib/format";
import { resource } from "../lib/store";
import type { NowView } from "../lib/types";

const COLOR: Record<string, string> = { focus: "#a082ff", steady: "#64a0ff", recharge: "#9696a0", sleep: "#9696a0" };
const FEEL: ["low" | "ok" | "high", string][] = [["low", "Плохо"], ["ok", "Нормально"], ["high", "Хорошо"]];
const DAY0 = 300; // the curve starts at 05:00, one point every 5 minutes
const X0 = 8;
const X1 = 310;
const yOf = (v: number) => 130 - v * 1.37;

function titleOf(nv: NowView): [string, string] {
  const until = nv.window ? hhmm(nv.window.end) : null;
  if (nv.zone === "focus") return ["Сейчас пик энергии", until ? `До ${until} — лучшее время для сложного` : "Лучшее время для сложного"];
  if (nv.zone === "steady") return ["Сейчас ровная энергия", until ? `До ${until} — подойдут обычные дела` : "Подойдут обычные дела"];
  if (nv.zone === "recharge") return ["Время восстановиться", until ? `До ${until} — лучше без сложного` : "Лучше без сложного"];
  return ["Сейчас время сна", "Энергия появится после подъёма"];
}

export function EnergySheet() {
  const nv = resource<NowView>("/views/now").value.data;
  const [picked, setPicked] = useState<string | null>(null);
  if (!nv) {
    return (
      <Sheet label="Энергия">
        <div style={{ height: "420px" }} role="status" aria-label="Загружаю энергию" />
      </Sheet>
    );
  }
  const [title, sub] = titleOf(nv);
  const pts = nv.curve;
  let i0 = pts.findIndex((v) => v != null);
  let i1 = pts.length - 1 - [...pts].reverse().findIndex((v) => v != null);
  if (i0 < 0) [i0, i1] = [0, pts.length - 1];
  const span = Math.max(1, i1 - i0);
  const x = (i: number) => X0 + ((i - i0) / span) * (X1 - X0);
  const xMin = (m: number) => x((m - DAY0) / 5);
  const zoneAt = (m: number) => nv.windows.find((w) => w.start <= m && m < w.end)?.zone ?? "recharge";

  let line = "";
  let first: number | null = null;
  let lastX = X0;
  for (let i = i0; i <= i1; i++) {
    const v = pts[i];
    if (v == null) continue;
    line += `${line ? " L" : "M"}${x(i).toFixed(1)},${yOf(v).toFixed(1)}`;
    first ??= x(i);
    lastX = x(i);
  }
  const area = line ? `${line} L${lastX.toFixed(1)},130 L${(first ?? X0).toFixed(1)},130 Z` : "";
  const stops = Array.from({ length: 13 }, (_, k) => {
    const i = i0 + Math.round((span * k) / 12);
    return { o: (k / 12).toFixed(3), c: COLOR[zoneAt(DAY0 + i * 5)] ?? "#9696a0" };
  });
  const nowIn = nv.now_min >= DAY0 + i0 * 5 && nv.now_min <= DAY0 + i1 * 5;
  const nowIdx = Math.round((nv.now_min - DAY0) / 5);
  const nowV = pts[nowIdx] ?? nv.idx;
  const wake = DAY0 + i0 * 5;
  const bed = DAY0 + i1 * 5;
  const mid = [0.25, 0.5, 0.75].map((f) => Math.round((wake + (bed - wake) * f) / 60) * 60);
  const current = picked ?? nv.last_feel?.v ?? null;

  return (
    <Sheet label="Энергия">
      <div>
        <h2 style={{ margin: 0, fontSize: "24px", lineHeight: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h2>
        <p class="k-cap" style={{ margin: "4px 0 0", fontSize: "15px" }}>
          {sub}
        </p>
      </div>
      <div class="k-card" style={{ padding: "16px 16px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "18px" }}>
          {([["Среднее", nv.avg, null, "#f5f5f7"], ["Максимум", nv.max, nv.max_at, "#a082ff"], ["Минимум", nv.min, nv.min_at, "#aeaeb2"]] as const).map(([l, v, at, c]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span class="k-cap" style={{ fontSize: "14px" }}>
                {l}
              </span>
              <span class="k-n" style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <b style={{ fontSize: "32px", lineHeight: "36px", fontWeight: 500, letterSpacing: "-0.03em", color: c }}>{v ?? "—"}</b>
                {at != null && <span style={{ fontSize: "13px", color: "#aeaeb2", fontWeight: 500 }}>{hhmm(at)}</span>}
              </span>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 318 150" role="img" aria-label={`Энергия по часам: пик ${nv.max}${nv.max_at != null ? ` в ${hhmm(nv.max_at)}` : ""}, минимум ${nv.min}${nowV != null ? `, сейчас ${nowV}` : ""}`} style={{ width: "100%", height: "150px", display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id="eg" x1={X0} x2={X1} y1="0" y2="0" gradientUnits="userSpaceOnUse">
              {stops.map((s) => (
                <stop key={s.o} offset={s.o} stop-color={s.c} />
              ))}
            </linearGradient>
            <linearGradient id="ef" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity="1" />
              <stop offset="0.55" stop-color="#fff" stop-opacity="0.45" />
              <stop offset="1" stop-color="#fff" stop-opacity="0.04" />
            </linearGradient>
            <mask id="em">
              <rect x="0" y="0" width="318" height="130" fill="url(#ef)" />
            </mask>
          </defs>
          {[25, 50, 75].map((v) => (
            <line key={v} x1={X0} x2={X1} y1={yOf(v)} y2={yOf(v)} stroke="rgba(255,255,255,0.10)" stroke-width="1" stroke-dasharray="1.5 5" stroke-linecap="round" />
          ))}
          {area && <path d={area} fill="url(#eg)" opacity="0.75" mask="url(#em)" />}
          {line && <path d={line} fill="none" stroke="url(#eg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />}
          {nv.max_at != null && <circle cx={xMin(nv.max_at).toFixed(1)} cy={yOf(nv.max).toFixed(1)} r="4.5" fill="#a082ff" stroke="#1c1c20" stroke-width="2" />}
          {nowIn && nowV != null && (
            <>
              <line x1={xMin(nv.now_min).toFixed(1)} x2={xMin(nv.now_min).toFixed(1)} y1="2" y2="136" stroke="rgba(255,255,255,0.45)" stroke-width="1.2" stroke-dasharray="3 3" />
              <circle cx={xMin(nv.now_min).toFixed(1)} cy={yOf(nowV).toFixed(1)} r="9" fill="rgba(255,255,255,0.16)" />
              <circle cx={xMin(nv.now_min).toFixed(1)} cy={yOf(nowV).toFixed(1)} r="5.5" fill="#f5f5f7" stroke="#1c1c20" stroke-width="2" />
            </>
          )}
        </svg>
        <div class="k-n" style={{ position: "relative", height: "18px", marginTop: "8px", fontSize: "12px", color: "#8e8e93" }}>
          <span style={{ position: "absolute", left: "2.5%", transform: "translateX(-6px)", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 13, height: 13, fill: "none", stroke: "#8e8e93", strokeWidth: 2, strokeLinecap: "round" }}>
              <circle cx="12" cy="12" r="3.5" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
            </svg>
            {hhmm(wake)}
          </span>
          {mid.map((m) => (
            <span key={m} style={{ position: "absolute", left: `${(((xMin(m) - 8) / 302) * 95 + 2.5).toFixed(1)}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
              {hhmm(m)}
            </span>
          ))}
          <span style={{ position: "absolute", left: "97.5%", transform: "translateX(calc(-100% + 6px))", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 13, height: 13, fill: "#8e8e93" }}>
              <path d={MOON} />
            </svg>
            {hhmm(bed)}
          </span>
        </div>
      </div>
      <p class="k-cap" style={{ margin: "-4px 4px 0", fontSize: "14px", lineHeight: "19px" }}>
        Сколько энергии у тебя будет в каждый час, из 100. Считаем по сну этой и прошлых ночей.
      </p>
      <div>
        <div style={{ fontSize: "15px", color: "#aeaeb2", margin: "0 2px 8px" }}>Как ты себя чувствуешь?</div>
        <div class="k-feel">
          {FEEL.map(([v, t]) => (
            <button
              key={v}
              aria-pressed={current === v}
              onClick={() => {
                setPicked(v);
                void sendFeel(v);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <p class="k-cap" style={{ margin: "8px 2px 0" }}>
          Отметка поправит график на сегодня
        </p>
      </div>
    </Sheet>
  );
}
