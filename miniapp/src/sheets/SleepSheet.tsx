import { useRef, useState } from "preact/hooks";
import { Icon, Seg, Sheet, SheetHead } from "../components/ui";
import { dayKey } from "../lib/actions";
import { put } from "../lib/api";
import { hhmm, shortDate, toMin } from "../lib/format";
import { haptic } from "../lib/haptic";
import { closeSheet } from "../lib/router";
import { mutate, resource, setData } from "../lib/store";
import { toast } from "../lib/toast";
import type { DayView, Settings } from "../lib/types";

const C = 150;
const R = 112;
const ang = (m: number) => (m / 1440) * Math.PI * 2 - Math.PI / 2;
const pt = (m: number, r: number): [number, number] => [C + r * Math.cos(ang(m)), C + r * Math.sin(ang(m))];
const f1 = (n: number) => +n.toFixed(1);
const norm = (m: number) => ((m % 1440) + 1440) % 1440;

export function SleepSheet({ date }: { date: string }) {
  const today = resource<DayView>("/views/day").value.data?.today;
  const key = dayKey(date === today ? null : date);
  const day = resource<DayView>(key).value.data;
  const st = resource<Settings>("/settings").value.data;
  const [bed, setBed] = useState(() => toMin(day?.sleep?.bed ?? st?.usual_bed ?? "23:30")!);
  const [wake, setWake] = useState(() => toMin(day?.sleep?.wake ?? st?.usual_wake ?? "07:30")!);
  const [q, setQ] = useState(day?.sleep?.quality ?? "ok");
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<"bed" | "wake" | null>(null);
  const lastTick = useRef<number>(-1);

  const durMin = norm(wake - bed);
  const [sx, sy] = pt(bed, R);
  const [ex, ey] = pt(wake, R);
  const arc = `M${f1(sx)} ${f1(sy)} A${R} ${R} 0 ${durMin > 720 ? 1 : 0} 1 ${f1(ex)} ${f1(ey)}`;

  const target = toMin(st?.bed_target ?? "23:30")!;
  const lateBy = norm(bed - target);
  const late = lateBy > 0 && lateBy < 600;

  const toMinute = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 300 - C;
    const y = ((e.clientY - r.top) / r.height) * 300 - C;
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += 2 * Math.PI;
    return Math.round(((a / (2 * Math.PI)) * 1440) / 5) * 5 % 1440;
  };
  const dist = (a: number, b: number) => {
    const d = Math.abs(a - b) % 1440;
    return Math.min(d, 1440 - d);
  };
  const apply = (which: "bed" | "wake", m: number) => {
    const tick = Math.floor(m / 15);
    if (tick !== lastTick.current) {
      lastTick.current = tick;
      haptic.selection(); // every 15 minutes
    }
    if (which === "bed") setBed(m);
    else setWake(m);
  };
  const step = (which: "bed" | "wake", d: number) => {
    haptic.light();
    if (which === "bed") setBed(norm(bed + d));
    else setWake(norm(wake + d));
  };

  const save = async () => {
    const body = { bed: hhmm(bed), wake: hhmm(wake), quality: q };
    const res = await mutate({
      apply: () =>
        setData<DayView>(key, (d) => ({ ...d, sleep: { bed: body.bed, wake: body.wake, quality: q, duration_min: durMin } })),
      request: () => put(`/days/${date}/sleep`, body),
      refresh: [key, "/views/now", "/views/day", "/views/review"],
    });
    if (res !== undefined) {
      haptic.success();
      closeSheet();
      toast("Сон сохранён, энергия пересчитана");
    }
  };

  const steps = (which: "bed" | "wake") => (
    <div class="steps">
      {[-15, -5, 5, 15].map((d) => (
        <button key={d} aria-label={`${which === "bed" ? "Лёг" : "Встал"} ${d > 0 ? "+" : "−"}${Math.abs(d)} минут`} onClick={() => step(which, d)}>
          {d > 0 ? "+" : "−"}
          {Math.abs(d)}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet label="Сон">
      <SheetHead title="Как спал?" sub={`ночь на ${shortDate(date)}`} />
      <div class="sheet-body" style={{ gap: "20px", paddingTop: "12px" }}>
        <div style={{ position: "relative", width: "300px", height: "300px", margin: "0 auto", touchAction: "none" }}>
          <svg
            ref={svg}
            viewBox="0 0 300 300"
            role="img"
            aria-label={`Циферблат сна: лёг ${hhmm(bed)}, встал ${hhmm(wake)}`}
            style={{ width: "300px", height: "300px", display: "block" }}
            onPointerDown={(e) => {
              const m = toMinute(e);
              dragging.current = dist(m, bed) <= dist(m, wake) ? "bed" : "wake";
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              apply(dragging.current, m);
            }}
            onPointerMove={(e) => dragging.current && apply(dragging.current, toMinute(e))}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          >
            <circle cx={C} cy={C} r={R} style={{ fill: "none", stroke: "var(--fill)", strokeWidth: 34 }} />
            {Array.from({ length: 48 }, (_, i) => {
              const m = i * 30;
              const major = i % 2 === 0;
              const [x1, y1] = pt(m, 84);
              const [x2, y2] = pt(m, major ? 78 : 81);
              return <line key={i} x1={f1(x1)} y1={f1(y1)} x2={f1(x2)} y2={f1(y2)} style={{ stroke: major ? "#636366" : "#3a3a3c", strokeWidth: major ? 1.5 : 1, strokeLinecap: "round" }} />;
            })}
            {([["00", 0], ["06", 360], ["12", 720], ["18", 1080]] as const).map(([l, m]) => {
              const [x, y] = pt(m, 64);
              return (
                <text key={l} x={f1(x)} y={f1(y)} text-anchor="middle" dominant-baseline="central" style={{ font: "500 12px var(--mono)", fill: "var(--muted)" }}>
                  {l}
                </text>
              );
            })}
            <path d={arc} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 34, strokeLinecap: "round" }} />
            <circle cx={f1(sx)} cy={f1(sy)} r="15" style={{ fill: "#f5f5f7" }} />
            <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" transform={`translate(${f1(sx - 7.2)} ${f1(sy - 7.2)}) scale(0.6)`} style={{ fill: "none", stroke: "#000", strokeWidth: 2.6, strokeLinejoin: "round" }} />
            <circle cx={f1(ex)} cy={f1(ey)} r="15" style={{ fill: "#f5f5f7" }} />
            <g transform={`translate(${f1(ex - 7.2)} ${f1(ey - 7.2)}) scale(0.6)`} style={{ fill: "none", stroke: "#000", strokeWidth: 2.6, strokeLinecap: "round" }}>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </g>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div class="mono" style={{ fontSize: "34px", fontWeight: 500, letterSpacing: "-0.03em" }}>
              {Math.floor(durMin / 60)} ч {String(durMin % 60).padStart(2, "0")} м
            </div>
            <div class="s mono" style={{ marginTop: "4px" }}>
              {hhmm(bed)} → {hhmm(wake)}
            </div>
          </div>
        </div>
        <div class="s" style={{ textAlign: "center", marginTop: "-8px" }}>Перетащи ручки или уточни шагами</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
          <div class="colbox">
            <div class="s" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Icon name="moon" size={16} />
              Лёг
            </div>
            <div class="mono" style={{ fontSize: "26px", fontWeight: 500 }}>{hhmm(bed)}</div>
            {steps("bed")}
          </div>
          <div class="colbox">
            <div class="s" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Icon name="sun" size={16} />
              Встал
            </div>
            <div class="mono" style={{ fontSize: "26px", fontWeight: 500 }}>{hhmm(wake)}</div>
            {steps("wake")}
          </div>
        </div>
        <section>
          <div class="sec">Качество</div>
          <Seg label="Качество сна" options={[["bad", "Плохо"], ["ok", "Нормально"], ["good", "Хорошо"]]} value={q} onChange={setQ} />
          <div class="s" style={{ margin: "10px 4px 0" }}>
            {durMin < 180 || durMin > 900
              ? `Проверь время: сон ${Math.floor(durMin / 60)} ч ${durMin % 60} м.`
              : late
                ? `Позже твоей нормы отбоя (${hhmm(target)}) на ${Math.floor(lateBy / 60)} ч ${lateBy % 60} м — это снизит энергию днём.`
                : "В пределах твоей нормы отбоя — энергия днём будет выше."}
          </div>
        </section>
        <button class="save" onClick={save}>
          Сохранить
        </button>
      </div>
    </Sheet>
  );
}
