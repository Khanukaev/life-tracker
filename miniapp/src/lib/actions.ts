/** User actions. Each one updates the screen instantly and syncs in the background;
 * creations and deletions show «Отменить» for a few seconds. */

import { signal } from "@preact/signals";
import { countNorm, countStep, patchScore, statusAfter, streakAfter } from "../domain/score";
import { del, patch, post, put, uuid7 } from "./api";
import { hold, release } from "./fold";
import { addDays, parseDate, relDay, shortDate } from "./format";
import { haptic } from "./haptic";
import { canEdit } from "./net";
import { entry, invalidateSoon, keysWith, mutate, setData } from "./store";
import { toast } from "./toast";
import type { DayTask, DayView, Habit, HabitRow, Review, Schedule, Task } from "./types";

export const dayKey = (date: string | null) => (date ? `/views/day?date=${date}` : "/views/day");
export const OVERDUE_KEY = "/views/tasks?view=overdue";
const REFRESH = ["/views/day", "/views/now", "/views/review", "/views/tasks", "/views/profile"];

/** The user's logical today (from the cached day view), or the device date as a fallback. */
export function today(): string {
  const d = entry<DayView>("/views/day").value.data;
  if (d) return d.today;
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function rescore(d: DayView): DayView {
  return d.score ? { ...d, score: patchScore(d.score, d.habits, d.tasks, d.relation === "today") } : d;
}

/** Apply a change to every cached day view; returns their rollbacks. */
function eachDay(update: (d: DayView) => DayView): (() => void)[] {
  return keysWith("/views/day").map((k) => setData<DayView>(k, (d) => rescore(update(d))));
}

// ---------- first run ----------

const ADDED_KEY = "keel:added";
function readAdded(): boolean {
  try {
    return localStorage.getItem(ADDED_KEY) === "1";
  } catch {
    return false;
  }
}
/** The «+» hint shows until the first thing is added. */
export const addedOnce = signal(readAdded());
function markAdded(): void {
  addedOnce.value = true;
  try {
    localStorage.setItem(ADDED_KEY, "1");
  } catch {
    /* ignore */
  }
}

// ---------- habits ----------

/** What one tap on the row's circle does: a check toggles, a count adds one step and
 * starts over once the norm is reached. */
export function nextValue(row: HabitRow): any {
  if (row.type === "count") {
    const v = Number(row.value) || 0;
    return v >= countNorm(row.config) ? null : v + countStep(row.config);
  }
  return row.value ? null : true;
}

/** Habit value changed on a day: recompute status, streak and score locally. */
export function setHabitValue(iso: string, row: HabitRow, value: any): void {
  let becameDone = false;
  let undone = false;
  const v = value === 0 || value === false ? null : value;
  void mutate({
    apply: () =>
      keysWith("/views/day").map((k) =>
        setData<DayView>(k, (d) => {
          if (d.date !== iso) return d;
          const isToday = d.relation === "today";
          const habits = d.habits.map((h) => {
            if (h.id !== row.id) return h;
            const status = statusAfter(h, v, isToday);
            becameDone ||= status === "done" && h.status !== "done";
            undone ||= status !== "done" && h.status === "done";
            return { ...h, value: v, status, streak: streakAfter(h, status) };
          });
          return rescore({ ...d, habits });
        }),
      ),
    request: () => (v === null ? del(`/days/${iso}/habits/${row.id}`) : put(`/days/${iso}/habits/${row.id}`, { value: v })),
    refresh: REFRESH,
  });
  // `apply` ran synchronously above: feedback is instant, not after the network.
  if (becameDone) {
    haptic.success();
    hold(row.id);
  } else {
    haptic.light();
    if (undone) release(row.id);
  }
}

export interface HabitDraft {
  name: string;
  type: "check" | "count";
  config: Record<string, any>;
  schedule: Schedule;
  remind_at: string | null;
}

/** Is the habit scheduled on `iso` (client copy of `habit_due`, for the optimistic row)? */
export function dueOn(s: Schedule, iso: string): boolean {
  if (s.kind === "weekdays") {
    const wd = parseDate(iso).getUTCDay();
    return wd >= 1 && wd <= 5;
  }
  if (s.kind === "cycle" && s.pattern) {
    const anchor = s.anchor ?? iso;
    const days = Math.round((parseDate(iso).getTime() - parseDate(anchor).getTime()) / 86_400_000);
    const n = s.pattern.length;
    return s.pattern[((days % n) + n) % n] === "1";
  }
  return true;
}

export function scheduleLabel(s: Schedule): string {
  return s.kind === "weekdays" ? "по будням" : s.kind === "cycle" ? "по циклу" : "каждый день";
}

export async function createHabit(draft: HabitDraft): Promise<boolean> {
  const id = uuid7();
  const t = today();
  const due = dueOn(draft.schedule, t);
  const row: HabitRow = {
    id, name: draft.name, type: draft.type, config: draft.config, schedule: draft.schedule,
    status: due ? "pending" : "rest", due, value: null, streak: 0, streak_base: 0,
  };
  const res = await mutate({
    apply: () => [
      ...eachDay((d) => (d.date === t ? { ...d, habits: [...d.habits, row] } : d)),
      setData<Habit[]>("/habits", (l) => [...l, { id, ...draft, active: true, position: l.length }]),
    ],
    request: () => post("/habits", { id, ...draft }),
    refresh: [...REFRESH, "/habits"],
  });
  if (res === undefined) return false;
  markAdded();
  haptic.success();
  toast(due ? "Добавлено на сегодня" : "Добавлено — сегодня день отдыха", { icon: "check", undo: () => void removeHabitNow(id) });
  return true;
}

async function removeHabitNow(id: string): Promise<void> {
  await mutate({
    apply: () => [
      ...eachDay((d) => ({ ...d, habits: d.habits.filter((h) => h.id !== id) })),
      setData<Habit[]>("/habits", (l) => l.filter((h) => h.id !== id)),
    ],
    request: () => del(`/habits/${id}`),
    refresh: [...REFRESH, "/habits"],
  });
}

export async function updateHabit(id: string, changes: Partial<HabitDraft>): Promise<boolean> {
  const res = await mutate({
    apply: () => [
      ...eachDay((d) => ({ ...d, habits: d.habits.map((h) => (h.id === id ? { ...h, ...changes, type: h.type } : h)) })),
      setData<Habit[]>("/habits", (l) => l.map((h) => (h.id === id ? { ...h, ...changes, type: h.type } : h))),
    ],
    request: () => patch(`/habits/${id}`, changes),
    refresh: [...REFRESH, "/habits"],
  });
  return res !== undefined;
}

/** Deleted at once on screen; the request goes out when «Отменить» is no longer offered. */
export function deleteHabit(row: { id: string; name: string }): void {
  if (!canEdit()) return;
  const rollbacks = [
    ...eachDay((d) => ({ ...d, habits: d.habits.filter((h) => h.id !== row.id) })),
    setData<Habit[]>("/habits", (l) => l.filter((h) => h.id !== row.id)),
  ];
  const undo = () => rollbacks.reverse().forEach((f) => f());
  haptic.light();
  toast(`Удалено: «${row.name}»`, {
    icon: "trash",
    undo,
    expire: () => void commitDelete(`/habits/${row.id}`, undo, [...REFRESH, "/habits"]),
  });
}

async function commitDelete(path: string, undo: () => void, refresh: string[]): Promise<void> {
  try {
    await del(path);
    invalidateSoon(...refresh);
  } catch {
    undo();
    haptic.error();
    toast("Не удалилось. Проверь связь");
  }
}

// ---------- tasks ----------

function patchTaskEverywhere(id: string, update: (t: Task) => Task): (() => void)[] {
  return [
    ...eachDay((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...update(t) } : t)) })),
    setData<Task>(`/tasks/${id}`, update),
    setData<{ items: DayTask[] }>(OVERDUE_KEY, (v) => ({ ...v, items: v.items.map((t) => (t.id === id ? { ...t, ...update(t) } : t)) })),
  ];
}

export function toggleTask(task: Pick<Task, "id" | "done">): void {
  const done = !task.done;
  if (done) {
    haptic.success();
    hold(task.id);
  } else {
    haptic.light();
    release(task.id);
  }
  void mutate({
    apply: () => patchTaskEverywhere(task.id, (t) => ({ ...t, done })),
    request: () => patch(`/tasks/${task.id}`, { done }),
    refresh: REFRESH,
  });
}

export interface TaskDraft {
  title: string;
  date: string | null;
  start_time: string | null;
  duration_min: number;
  important: boolean;
  fresh: boolean;
  remind_at: string | null;
}

function dayWord(date: string | null): string {
  if (!date) return "без даты";
  const t = today();
  if (date === t) return "на сегодня";
  if (date === addDays(t, 1)) return "на завтра";
  return `на ${shortDate(date)}`;
}

function asDayTask(id: string, draft: TaskDraft, base?: Task): DayTask {
  const now = new Date().toISOString();
  return {
    id, description: "", done: false, done_at: null, created_by: "me", created_at: now, updated_at: now,
    ...base, ...draft, overdue: false, low_energy: false,
  };
}

/** Put the task into the day views of its date and take it out of the others. */
function placeTask(task: DayTask): (() => void)[] {
  return eachDay((d) => {
    const has = d.tasks.some((t) => t.id === task.id);
    if (d.date !== task.date) return has ? { ...d, tasks: d.tasks.filter((t) => t.id !== task.id) } : d;
    return { ...d, tasks: has ? d.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) : [...d.tasks, task] };
  });
}

export async function createTask(draft: TaskDraft): Promise<boolean> {
  const id = uuid7();
  const res = await mutate({
    apply: () => placeTask(asDayTask(id, draft)),
    request: () => post("/tasks", { id, ...draft }),
    refresh: REFRESH,
  });
  if (res === undefined) return false;
  markAdded();
  haptic.success();
  toast(`Добавлено ${dayWord(draft.date)}`, { icon: "check", undo: () => void removeTaskNow(id) });
  return true;
}

async function removeTaskNow(id: string): Promise<void> {
  await mutate({
    apply: () => eachDay((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) })),
    request: () => del(`/tasks/${id}`),
    refresh: REFRESH,
  });
}

export async function updateTask(task: Task, changes: Partial<TaskDraft>): Promise<boolean> {
  const merged = { ...task, ...changes };
  const res = await mutate({
    apply: () => [...placeTask({ ...asDayTask(task.id, merged, task) }), setData<Task>(`/tasks/${task.id}`, (t) => ({ ...t, ...changes }))],
    request: () => patch(`/tasks/${task.id}`, changes),
    refresh: REFRESH,
  });
  return res !== undefined;
}

/** «Перенести на завтра»: one tap, no form. */
export async function postponeTask(task: Task): Promise<void> {
  const from = task.date;
  const to = addDays(from && from >= today() ? from : today(), 1);
  const ok = await updateTask(task, { date: to });
  if (ok) {
    haptic.success();
    toast(`Перенесено ${dayWord(to)}`, { icon: "check", undo: () => void updateTask({ ...task, date: to }, { date: from }) });
  }
}

export function deleteTask(task: Pick<Task, "id" | "title">): void {
  if (!canEdit()) return;
  const rollbacks = [
    ...eachDay((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== task.id) })),
    setData<{ items: DayTask[]; counts: Record<string, number> }>(OVERDUE_KEY, (v) => ({
      ...v,
      items: v.items.filter((t) => t.id !== task.id),
    })),
  ];
  const undo = () => rollbacks.reverse().forEach((f) => f());
  haptic.light();
  toast(`Удалено: «${task.title}»`, { icon: "trash", undo, expire: () => void commitDelete(`/tasks/${task.id}`, undo, REFRESH) });
}

/** "Добавил Claude, сегодня в 08:10". */
export function createdLabel(t: Task): string {
  const at = new Date(t.created_at);
  const iso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const hm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return `${relDay(iso, today()).toLowerCase()} в ${hm}`;
}

// ---------- Claude's plan, sleep, feel ----------

export async function applyPlan(plan: Review): Promise<void> {
  const res = await mutate({
    apply: () => eachDay((d) => (d.plan?.id === plan.id ? { ...d, plan: null } : d)),
    request: () => post(`/reviews/${plan.id}/apply`),
    refresh: REFRESH,
    errorText: "План не добавился. Попробуй ещё раз",
  });
  if (res !== undefined) {
    markAdded();
    haptic.success();
    toast("План добавлен в день", { icon: "check" });
  }
}

export async function saveSleep(iso: string, body: { bed: string; wake: string; quality: string }, durMin: number): Promise<boolean> {
  const res = await mutate({
    apply: () =>
      eachDay((d) => (d.date === iso ? { ...d, sleep: { ...body, quality: body.quality as "ok", duration_min: durMin } } : d)),
    request: () => put(`/days/${iso}/sleep`, body),
    refresh: REFRESH,
  });
  if (res === undefined) return false;
  haptic.success();
  toast("Сон отмечен, энергия пересчитана", { icon: "check" });
  return true;
}

export async function sendFeel(v: "low" | "ok" | "high"): Promise<void> {
  haptic.selection();
  const res = await mutate<{ message: string }>({
    request: () => post("/feel", { v }),
    refresh: REFRESH,
  });
  if (res) toast(res.message, { icon: "check" });
}
