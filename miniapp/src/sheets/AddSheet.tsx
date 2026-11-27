/** «+» form: a new task or habit (AddFull / AddHabit / AddHabitCycle / AddEmptyName) and the
 * same form filled in to edit (EditTask). The cursor is in the name at once; «Готово» stays
 * inactive until there is a name; no time = the app puts the task into a fitting energy zone. */

import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Sheet } from "../components/ui";
import { Chevron } from "../components/icons";
import {
  createHabit, createTask, deleteHabit, deleteTask, dueOn, today, updateHabit, updateTask,
  type HabitDraft, type TaskDraft,
} from "../lib/actions";
import { addDays, durLabel, parseDate, shortDate } from "../lib/format";
import { haptic } from "../lib/haptic";
import { closeSheet, closeSheetNow, current, pop } from "../lib/router";
import { resource } from "../lib/store";
import type { Habit, Schedule, Task } from "../lib/types";
import { findTask } from "../screens/Detail";

const DURATIONS = [null, 15, 30, 45, 60, 90, 120, 180] as const;
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function Chips<T>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="k-field">
      <span class="k-cap">{label}</span>
      <div role="group" aria-label={label} class="k-chips">
        {options.map(([v, t]) => (
          <button
            key={t}
            class="k-chip"
            aria-pressed={v === value}
            onClick={() => {
              haptic.selection();
              onChange(v);
            }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  return (
    <div class="k-lr">
      <span class="t">
        <span>{label}</span>
        <span class="k-cap">{sub}</span>
      </span>
      <button
        class="k-switch"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => {
          haptic.selection();
          onChange(!on);
        }}
      >
        <i />
      </button>
    </div>
  );
}

/** A row that opens the system time picker; tapping a set value again lets you clear it. */
function TimeRow({ label, sub, value, empty, onChange, disabled }: { label: string; sub?: string; value: string | null; empty: string; onChange: (v: string | null) => void; disabled?: boolean }) {
  return (
    <label class="k-lr" style={disabled ? { opacity: 0.4 } : undefined}>
      <span class="t">
        <span>{label}</span>
        {sub && <span class="k-cap">{sub}</span>}
      </span>
      <span class="v">{value ?? empty}</span>
      {value && !disabled ? (
        <button
          class="k-btnreset"
          aria-label={`Убрать: ${label}`}
          style={{ position: "relative", zIndex: 2, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: "#8e8e93" }}
          onClick={(e) => {
            e.preventDefault();
            haptic.light();
            onChange(null);
          }}
        >
          ×
        </button>
      ) : (
        <Chevron color="#636366" />
      )}
      {!disabled && (
        <input
          class="k-native"
          type="time"
          aria-label={label}
          value={value ?? ""}
          onChange={(e) => onChange((e.target as HTMLInputElement).value || null)}
        />
      )}
    </label>
  );
}

function Card({ children }: { children: ComponentChildren }) {
  return <div class="k-card clip">{children}</div>;
}

function Stepper({ value, onChange, label, min = 1, max = 999 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number }) {
  const set = (v: number) => {
    haptic.light();
    onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <span class="k-step">
      <button aria-label={`Меньше: ${label}`} onClick={() => set(value - 1)}>
        −
      </button>
      <span class="k-n">{value}</span>
      <button aria-label={`Больше: ${label}`} onClick={() => set(value + 1)}>
        +
      </button>
    </span>
  );
}

function cycleIndex(s: Schedule | undefined, t: string, len: number): number {
  if (!s?.anchor || !len) return 0;
  const days = Math.round((parseDate(t).getTime() - parseDate(s.anchor).getTime()) / 86_400_000);
  return ((days % len) + len) % len;
}

export function AddSheet({ taskId, habitId }: { taskId?: string; habitId?: string }) {
  const t0 = today();
  const task: Task | undefined = taskId ? findTask(taskId) ?? resource<Task>(`/tasks/${taskId}`).value.data : undefined;
  const habit: Habit | undefined = habitId ? resource<Habit[]>("/habits").value.data?.find((h) => h.id === habitId) : undefined;
  const editing = !!(task || habit);

  const [type, setType] = useState<"task" | "habit">(habit ? "habit" : "task");
  const [switched, setSwitched] = useState(false); // animate the fields only on a switch, not on open
  const [name, setName] = useState(task?.title ?? habit?.name ?? "");
  // task
  const [date, setDate] = useState<string | null>(task ? task.date : t0);
  const [time, setTime] = useState<string | null>(task?.start_time ?? null);
  const [durMin, setDur] = useState<number | null>(task ? task.duration_min : null);
  const [durOpen, setDurOpen] = useState(false);
  const [remind, setRemind] = useState<string | null>(task?.remind_at ?? null);
  const [important, setImportant] = useState(task?.important ?? false);
  const [fresh, setFresh] = useState(task?.fresh ?? false);
  // habit
  const [freq, setFreq] = useState<Schedule["kind"]>(habit?.schedule.kind ?? "daily");
  const initialPat = habit?.schedule.pattern ? habit.schedule.pattern.split("").map(Number) : [1, 0, 1, 1, 0];
  const [pat, setPat] = useState<number[]>(initialPat);
  const [cycToday, setCycToday] = useState(cycleIndex(habit?.schedule, t0, initialPat.length));
  const [kind, setKind] = useState<"check" | "count">(habit?.type === "count" ? "count" : "check");
  const [norm, setNorm] = useState<number>(Number(habit?.config.norm) || 8);
  const [hRemind, setHRemind] = useState<string | null>(habit?.remind_at ?? null);

  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) input.current?.focus({ preventScroll: true });
  }, []);

  const trimmed = name.trim();
  const cycleOk = freq !== "cycle" || (pat.length >= 2 && pat.includes(1));
  const ok = !!trimmed && (type === "task" || cycleOk);
  const custom = date && date !== t0 && date !== addDays(t0, 1);

  const schedule = (): Schedule =>
    freq === "cycle" ? { kind: "cycle", pattern: pat.join(""), anchor: addDays(t0, -cycToday) } : { kind: freq };

  const submit = async () => {
    if (!ok) return;
    let saved: boolean;
    if (type === "task") {
      const draft: TaskDraft = {
        title: trimmed, date, start_time: date ? time : null, duration_min: durMin ?? 30,
        important, fresh, remind_at: remind,
      };
      saved = task ? await updateTask(task, draft) : await createTask(draft);
    } else {
      const config = kind === "count" ? { norm, step: 1 } : {};
      if (habit) {
        const changes: Partial<HabitDraft> = { name: trimmed, remind_at: hRemind };
        if (habit.type !== "bedtime") Object.assign(changes, { schedule: schedule(), ...(habit.type === "count" ? { config: { ...habit.config, norm } } : {}) });
        saved = await updateHabit(habit.id, changes);
      } else {
        saved = await createHabit({ name: trimmed, type: kind, config, schedule: schedule(), remind_at: hRemind });
      }
    }
    if (saved) closeSheet();
  };

  const remove = () => {
    closeSheetNow();
    if (task) deleteTask(task);
    else if (habit) deleteHabit(habit);
    const scr = current.value;
    if (scr && (scr.name === "task" || scr.name === "habit") && scr.params?.id === (taskId ?? habitId)) pop();
  };

  const weeks = Array.from({ length: 14 }, (_, k) => ({
    on: pat[(cycToday + k) % pat.length] === 1,
    d: WD[parseDate(addDays(t0, k)).getUTCDay()]!,
  }));

  return (
    <Sheet label={editing ? (task ? "Изменить задачу" : "Изменить привычку") : "Новое дело"} cls="k-full">
      <div class="k-formhead">
        <button style={{ color: "#aeaeb2" }} onClick={closeSheet}>
          Отмена
        </button>
        <h2>{editing ? "Изменить" : "Новое дело"}</h2>
        <button aria-disabled={!ok} style={{ fontWeight: 600, color: ok ? "#f5f5f7" : "#48484a" }} onClick={() => void submit()}>
          {editing ? "Сохранить" : "Готово"}
        </button>
      </div>
      {!editing && (
        <div role="group" aria-label="Что это" class="k-type">
          <i class="k-type-ind" aria-hidden="true" style={{ transform: type === "habit" ? "translate3d(calc(100% + 2px), 0, 0)" : "none" }} />
          {(["task", "habit"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={type === v}
              onClick={() => {
                if (v === type) return;
                haptic.selection();
                setSwitched(true);
                setType(v);
              }}
            >
              {v === "task" ? "Задача" : "Привычка"}
            </button>
          ))}
        </div>
      )}
      <label for="k-name" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Название
      </label>
      <input
        id="k-name"
        ref={input}
        class="k-input"
        enterKeyHint="done"
        maxLength={type === "task" ? 200 : 80}
        placeholder={type === "task" ? "Например, дз по матанализу" : "Например, вода"}
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {/* The fields change with the type: a new block appears smoothly (keyed remount). */}
      <div key={type} class={`k-swap${switched ? " anim" : ""}`}>
      {type === "task" ? (
        <>
          <div class="k-field">
            <span class="k-cap">Когда</span>
            <div role="group" aria-label="Когда" class="k-chips">
              {([[t0, "Сегодня"], [addDays(t0, 1), "Завтра"], [null, "Без даты"]] as [string | null, string][]).map(([v, t]) => (
                <button
                  key={t}
                  class="k-chip"
                  aria-pressed={date === v}
                  onClick={() => {
                    haptic.selection();
                    setDate(v);
                  }}
                >
                  {t}
                </button>
              ))}
              <label class="k-chip" aria-pressed={!!custom} style={{ display: "inline-flex", alignItems: "center" }}>
                {custom ? shortDate(date!) : "Выбрать…"}
                <input
                  class="k-native"
                  type="date"
                  aria-label="Выбрать дату"
                  min={t0}
                  value={date ?? ""}
                  onChange={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v) setDate(v);
                  }}
                />
              </label>
            </div>
          </div>
          <Card>
            <TimeRow label="Время" sub={time ? undefined : "подберём по энергии"} value={date ? time : null} empty="Без времени" onChange={setTime} disabled={!date} />
            <button class="k-btnreset k-lr" aria-expanded={durOpen} onClick={() => setDurOpen(!durOpen)}>
              <span class="t">
                <span>Длительность</span>
              </span>
              <span class="v">{durLabel(durMin)}</span>
              <Chevron dir={durOpen ? "down" : "right"} color="#636366" />
            </button>
            {durOpen && (
              <div class="k-chips" style={{ padding: "4px 16px 14px 18px" }}>
                {DURATIONS.map((v) => (
                  <button
                    key={String(v)}
                    class="k-chip"
                    style={{ height: "36px", padding: "0 12px", fontSize: "14px" }}
                    aria-pressed={durMin === v}
                    onClick={() => {
                      haptic.selection();
                      setDur(v);
                    }}
                  >
                    {durLabel(v)}
                  </button>
                ))}
              </div>
            )}
            <TimeRow label="Напоминание" value={remind} empty="нет" onChange={setRemind} />
          </Card>
          <Card>
            <Switch label="Важное" sub="поднимется наверх списка" on={important} onChange={setImportant} />
            <Switch label="Нужна свежая голова" sub="поставим на пик энергии" on={fresh} onChange={setFresh} />
          </Card>
          {task && (
            <button class="k-btnreset k-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "52px", fontSize: "16px", flex: "none" }} onClick={remove}>
              Удалить задачу
            </button>
          )}
        </>
      ) : (
        <>
          {habit?.type !== "bedtime" && (
            <Chips
              label="Как часто"
              options={[["daily", "Каждый день"], ["weekdays", "По будням"], ["cycle", "Цикл"]]}
              value={freq}
              onChange={setFreq}
            />
          )}
          {freq === "cycle" && habit?.type !== "bedtime" && (
            <div class="k-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", flex: "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "16px" }}>Цикл</span>
                <span class="k-cap">1 — делаю, 0 — отдых</span>
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {pat.map((v, i) => (
                  <button
                    key={i}
                    class={`k-cyc${v ? " on" : ""}`}
                    aria-pressed={!!v}
                    aria-label={`День ${i + 1}${v ? ", делаю" : ", отдых"}`}
                    style={i === cycToday ? { boxShadow: "0 0 0 2px #0a0a0d, 0 0 0 3.5px #f5f5f7" } : undefined}
                    onClick={() => {
                      haptic.selection();
                      setPat(pat.map((x, j) => (j === i ? 1 - x : x)));
                    }}
                  >
                    <b class="k-n">{v}</b>
                    <small class="k-n">{i + 1}</small>
                  </button>
                ))}
                <button
                  class="k-cyc edit"
                  aria-label="Убрать последний день"
                  onClick={() => {
                    if (pat.length <= 2) return;
                    haptic.light();
                    setPat(pat.slice(0, -1));
                    setCycToday(Math.min(cycToday, pat.length - 2));
                  }}
                >
                  −
                </button>
                <button
                  class="k-cyc edit"
                  aria-label="Добавить день"
                  onClick={() => {
                    if (pat.length >= 31) return;
                    haptic.light();
                    setPat([...pat, 0]);
                  }}
                >
                  +
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.09)", paddingTop: "12px" }}>
                <span style={{ flex: 1, fontSize: "16px" }}>Сегодня — день цикла</span>
                <span class="k-step">
                  <button aria-label="Меньше: день цикла" onClick={() => setCycToday((cycToday - 1 + pat.length) % pat.length)}>
                    −
                  </button>
                  <span class="k-n">{cycToday + 1}</span>
                  <button aria-label="Больше: день цикла" onClick={() => setCycToday((cycToday + 1) % pat.length)}>
                    +
                  </button>
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span class="k-cap">Ближайшие две недели</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  {weeks.map((w, k) => (
                    <span key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flex: 1 }}>
                      <i style={{ display: "block", width: "100%", aspectRatio: "1", borderRadius: 4, background: w.on ? "#69ff79" : "rgba(255,255,255,0.08)", boxShadow: k === 0 ? "0 0 0 1.5px #f5f5f7" : undefined }} />
                      <span style={{ fontSize: "11px", color: "#8e8e93" }}>{w.d}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {!habit && (
            <Chips
              label="Как отмечать"
              options={[["check", "Галочка"], ["count", "Количество"]]}
              value={kind}
              onChange={setKind}
            />
          )}
          <Card>
            {kind === "count" && habit?.type !== "bedtime" && (
              <div class="k-lr">
                <span style={{ flex: 1, fontSize: "16px" }}>Норма в день</span>
                <Stepper value={norm} onChange={setNorm} label="норма" max={1440} />
              </div>
            )}
            <TimeRow label="Напоминание" value={hRemind} empty="нет" onChange={setHRemind} />
          </Card>
          {!habit && freq !== "daily" && !dueOn(schedule(), t0) && (
            <p class="k-cap" style={{ margin: "-4px 4px 0" }}>
              Сегодня по графику день отдыха — привычка появится в «Сегодня» в следующий рабочий день.
            </p>
          )}
          {habit && (
            <button class="k-btnreset k-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "52px", fontSize: "16px", flex: "none" }} onClick={remove}>
              Удалить привычку
            </button>
          )}
        </>
      )}
      </div>
    </Sheet>
  );
}
