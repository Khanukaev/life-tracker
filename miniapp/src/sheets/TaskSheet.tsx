import { useEffect, useState } from "preact/hooks";
import { Icon, Seg, Sheet, SheetHead } from "../components/ui";
import { deleteTask, saveTask, toggleTask, type TaskDraft } from "../lib/actions";
import { get } from "../lib/api";
import { addDays, durChip, hhmm, relDay, toMin, ZONE_NAME } from "../lib/format";
import { haptic } from "../lib/haptic";
import { closeSheet, openSheet } from "../lib/router";
import { resource } from "../lib/store";
import { toast } from "../lib/toast";
import type { DayView, Slot, Sphere, Task } from "../lib/types";

const DURS = [15, 30, 45, 60, 90, 120, 180];
const IMPS: [Task["importance"], string, string, string][] = [
  ["normal", "Обычная", "По умолчанию", "#636366"],
  ["important", "Важная", "Светлее в списках", "#d1d1d6"],
  ["critical", "Критичная", "Наверх и в «Главное»", "#ff2d55"],
];
const IMP_NOTE: Record<Task["importance"], string> = {
  normal: "Обычные задачи весят ×2 в рейтинге дня.",
  important: "Важная — метка и светлее в списках. Вес ×2.",
  critical: "Критичные идут первыми везде и весят ×3: невыполненная бьёт по рейтингу сильнее.",
};

interface Props {
  id?: string;
  date?: string;
  start?: string;
  dur?: number;
  inbox?: boolean;
}

export function TaskSheet(p: Props) {
  const today = resource<DayView>("/views/day").value.data?.today ?? new Date().toISOString().slice(0, 10);
  const spheres = resource<Sphere[]>("/spheres").value.data ?? [];
  const [loaded, setLoaded] = useState<Task | null>(null);
  const [f, setF] = useState<TaskDraft>({
    title: "", description: "", date: p.inbox ? null : (p.date ?? today), start_time: p.start ?? null,
    duration_min: p.dur ?? 60, energy: "steady", sphere_id: null, importance: "normal",
  });
  const [critCount, setCritCount] = useState(0);
  const [slot, setSlot] = useState<{ best: Slot | null; alternative: Slot | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!p.id) return;
    void get<Task>(`/tasks/${p.id}`).then((t) => {
      setLoaded(t);
      setF({ id: t.id, title: t.title, description: t.description, date: t.date, start_time: t.start_time, duration_min: t.duration_min, energy: t.energy, sphere_id: t.sphere_id, importance: t.importance });
    });
  }, [p.id]);

  // Critical tasks already on the chosen day (for "когда всё важно — ничего не важно").
  useEffect(() => {
    if (!f.date) return setCritCount(0);
    void get<Task[]>(`/tasks?date=${f.date}`).then((ts) =>
      setCritCount(ts.filter((t) => t.importance === "critical" && !t.done && t.id !== f.id).length),
    ).catch(() => {});
  }, [f.date]);

  // Best energy slot for this task type and duration.
  useEffect(() => {
    if (!f.date) return setSlot(null);
    const q = `/views/slot?date=${f.date}&dur=${f.duration_min}&energy=${f.energy}${f.id ? `&exclude=${f.id}` : ""}`;
    const t = setTimeout(() => void get<{ best: Slot | null; alternative: Slot | null }>(q).then(setSlot).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [f.date, f.duration_min, f.energy]);

  const set = (patch: Partial<TaskDraft>) => setF({ ...f, ...patch });
  const willOverload = f.importance === "critical" && critCount >= 3;
  useEffect(() => {
    if (willOverload) haptic.warning();
  }, [willOverload]);

  const dayView = resource<DayView>(f.date === today ? "/views/day" : `/views/day?date=${f.date}`).value.data;
  const startMin = toMin(f.start_time);
  const idxAtStart = startMin != null && dayView ? dayView.timeline.curve[Math.round(((startMin < 300 ? startMin + 1440 : startMin) - 300) / 15)] ?? null : null;
  const lowForFocus = f.energy === "focus" && idxAtStart != null && idxAtStart < 50;
  const best = slot?.alternative ?? slot?.best ?? null;

  const save = async () => {
    if (!f.title.trim()) {
      toast("Напиши название задачи");
      return;
    }
    setBusy(true);
    const ok = await saveTask({ ...f, title: f.title.trim() });
    setBusy(false);
    if (ok) {
      haptic.success();
      closeSheet();
      toast(f.id ? "Сохранено" : "Задача добавлена");
    }
  };

  const dateChips: [string | null, string][] = [
    [null, "Входящие"],
    [today, "Сегодня"],
    [addDays(today, 1), "Завтра"],
  ];
  const custom = f.date && !dateChips.some(([d]) => d === f.date);

  return (
    <Sheet label="Задача">
      <SheetHead title={f.id ? "Задача" : "Новая задача"} done="Готово" onDone={save} doneDisabled={busy} />
      <div class="sheet-body">
        <div class="grp">
          <label class="row">
            <span class="sr">Название</span>
            <input class="field" style={{ fontSize: "17px", fontWeight: 500 }} placeholder="Что сделать" value={f.title} autoFocus={!p.id} maxLength={200} onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="row" style={{ alignItems: "flex-start" }}>
            <span class="sr">Описание</span>
            <textarea class="field" rows={2} style={{ fontSize: "15px", color: "var(--muted)", resize: "none" }} placeholder="Подробности" value={f.description} maxLength={2000} onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })} />
          </label>
        </div>

        <section>
          <div class="sec">Важность</div>
          <div class="imp" role="radiogroup" aria-label="Важность">
            {IMPS.map(([id, label, desc, ring]) => {
              const on = f.importance === id;
              return (
                <button key={id} class={`${on ? "on" : ""}${id === "critical" ? " crit" : ""}`} role="radio" aria-checked={on} onClick={() => { haptic.selection(); set({ importance: id }); }}>
                  <span class="dot" style={{ borderColor: ring, background: on ? ring : "transparent" }} />
                  <span class="nm">{label}</span>
                  <span class="ds">{desc}</span>
                </button>
              );
            })}
          </div>
          {willOverload && (
            <div class="note" style={{ marginTop: "10px" }}>
              <Icon name="warn" size={18} style={{ color: "var(--accent)" }} />
              <div style={{ flex: 1 }}>
                <div class="t" style={{ fontWeight: 500 }}>Когда всё важно — ничего не важно</div>
                <div class="s" style={{ marginTop: "3px" }}>
                  На этот день уже {critCount} критичные. Эта станет {critCount + 1}-й — точно не просто важная?
                </div>
                <button class="btn" style={{ marginTop: "10px" }} onClick={() => set({ importance: "important" })}>
                  Сделать важной
                </button>
              </div>
            </div>
          )}
          <div class="s" style={{ margin: "10px 4px 0" }}>{IMP_NOTE[f.importance]}</div>
        </section>

        <section>
          <div class="sec">Когда</div>
          <div class="chips" style={{ marginBottom: "12px" }}>
            {dateChips.map(([d, label]) => (
              <button key={label} class={`chip${f.date === d ? " on" : ""}`} onClick={() => { haptic.selection(); set({ date: d, start_time: d ? f.start_time : null }); }}>
                {label}
              </button>
            ))}
            <label class={`chip${custom ? " on" : ""}`} style={{ position: "relative" }}>
              {custom ? relDay(f.date!, today) : "Дата…"}
              <input type="date" style={{ position: "absolute", inset: 0, opacity: 0 }} onChange={(e) => set({ date: (e.target as HTMLInputElement).value || null })} />
            </label>
          </div>
          {f.date && (
            <div class="grp">
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Время</span>
                {f.start_time && (
                  <button class="btn" style={{ height: "28px" }} onClick={() => set({ start_time: null })}>
                    Без времени
                  </button>
                )}
                <input type="time" class="pill-input" value={f.start_time ?? ""} onChange={(e) => set({ start_time: (e.target as HTMLInputElement).value || null })} />
              </div>
            </div>
          )}
          <div class="sec" style={{ marginTop: "16px" }}>Длительность</div>
          <div class="chips">
            {DURS.map((m) => (
              <button key={m} class={`chip${f.duration_min === m ? " on" : ""}`} onClick={() => { haptic.selection(); set({ duration_min: m }); }}>
                {durChip(m)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div class="sec">Тип энергии</div>
          <Seg label="Тип энергии" options={[["focus", "Focus"], ["steady", "Steady"], ["recharge", "Recharge"]]} value={f.energy} onChange={(v) => set({ energy: v })} />
          {f.date && (lowForFocus || best) && (
            <div class="note" style={{ marginTop: "10px", flexDirection: "column", gap: "10px" }}>
              {lowForFocus && (
                <div class="s" style={{ display: "flex", gap: "6px", alignItems: "center", color: "var(--soft)" }}>
                  <Icon name="warn" size={14} />В {f.start_time} энергия ~{idxAtStart} — низко для Focus
                </div>
              )}
              {best && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
                  <div style={{ flex: 1 }}>
                    <div class="s" style={{ fontSize: "12px" }}>{slot?.alternative ? "Лучше на следующий день" : "Лучший слот"}</div>
                    <div class="mono" style={{ fontSize: "13px", marginTop: "2px" }}>
                      {relDay(best.date, today)} {hhmm(best.start)}–{hhmm(best.end)} · {ZONE_NAME[best.zone ?? "steady"]} · ~{best.avg}
                    </div>
                  </div>
                  <button class="btn tint" onClick={() => { haptic.light(); set({ date: best.date, start_time: hhmm(best.start) }); }}>
                    Поставить
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <section>
          <div class="sec">Сфера</div>
          <div class="chips">
            {spheres.map((s) => (
              <button key={s.id} class={`chip${f.sphere_id === s.id ? " on" : ""}`} onClick={() => { haptic.selection(); set({ sphere_id: f.sphere_id === s.id ? null : s.id }); }}>
                {s.name}
              </button>
            ))}
            <button class="chip dashed" onClick={() => openSheet("sphere", {})}>+ Сфера</button>
          </div>
        </section>

        {loaded && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              class="btn lg"
              onClick={() => {
                toggleTask(loaded, ["/views/day", `/views/day?date=${loaded.date}`]);
                closeSheet();
              }}
            >
              {loaded.done ? "Вернуть в работу" : "Выполнено"}
            </button>
            <button
              class="btn lg danger"
              style={{ width: "auto", padding: "0 18px" }}
              onClick={async () => {
                if (!confirmDel) {
                  haptic.warning();
                  setConfirmDel(true);
                  return;
                }
                await deleteTask(loaded.id);
                closeSheet();
                toast("Задача удалена");
              }}
            >
              {confirmDel ? "Точно удалить?" : <Icon name="trash" />}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
