/** User actions. Each one updates the screen instantly and syncs in the background. */

import { patchScore, statusAfter, streakAfter } from "../domain/score";
import { del, patch, post, put, uuid7 } from "./api";
import { haptic } from "./haptic";
import { pop } from "../motion/screen";
import { invalidateSoon, mutate, setData } from "./store";
import type { DayView, HabitRow, Task, TasksView } from "./types";

export const dayKey = (date: string | null) => (date ? `/views/day?date=${date}` : "/views/day");

/** Habit value changed on a day: recompute status, streak and score locally. */
export function setHabitValue(date: string | null, iso: string, row: HabitRow, value: any): Promise<unknown> {
  let becameDone = false;
  let dayClosed = false;
  const key = dayKey(date);
  const pending = mutate({
    apply: () =>
      setData<DayView>(key, (d) => {
        const isToday = d.relation === "today";
        const habits = d.habits.map((h) => {
          if (h.id !== row.id) return h;
          const status = statusAfter(h, value, isToday);
          becameDone = status === "done" && h.status !== "done";
          return { ...h, value, status, streak: streakAfter(h, status) };
        });
        const score = d.score ? patchScore(d.score, habits, d.tasks, isToday) : null;
        dayClosed = !!score && score.pct === 100 && (d.score?.pct ?? 0) < 100;
        return { ...d, habits, score };
      }),
    request: () =>
      value === null || value === false
        ? del(`/days/${iso}/habits/${row.id}`)
        : put(`/days/${iso}/habits/${row.id}`, { value }),
    refresh: [key, "/views/review", "/views/profile", "/views/goals"],
  });
  // `apply` ran synchronously above: feedback is instant, not after the network.
  if (becameDone || dayClosed) {
    haptic.success();
    pop(`[data-habit="${row.id}"]`); // springy card, in sync with the vibration
  }
  return pending;
}

/** Toggle a task everywhere it is visible (day screen and task lists). */
export function toggleTask(task: Pick<Task, "id" | "done">, dayKeys: string[] = []): void {
  const done = !task.done;
  if (done) {
    haptic.success();
    pop(`[data-task="${task.id}"]`);
  } else haptic.light();
  void mutate({
    apply: () => [
      ...dayKeys.map((k) =>
        setData<DayView>(k, (d) => {
          const tasks = d.tasks.map((t) => (t.id === task.id ? { ...t, done } : t));
          const critical = d.critical.map((t) => (t.id === task.id ? { ...t, done } : t));
          const score = d.score ? patchScore(d.score, d.habits, tasks, d.relation === "today") : null;
          return { ...d, tasks, critical, score };
        }),
      ),
      ...TASK_VIEWS.map((v) =>
        setData<TasksView>(`/views/tasks?view=${v}`, (d) => ({
          ...d,
          items: d.items.map((t) => (t.id === task.id ? { ...t, done } : t)),
        })),
      ),
    ],
    request: () => patch(`/tasks/${task.id}`, { done }),
    refresh: ["/views/day", "/views/tasks", "/views/profile", "/views/review"],
  });
}

export const TASK_VIEWS = ["inbox", "today", "overdue", "upcoming", "done", "energy"] as const;

export interface TaskDraft {
  id?: string;
  title: string;
  description: string;
  date: string | null;
  start_time: string | null;
  duration_min: number;
  energy: Task["energy"];
  sphere_id: string | null;
  importance: Task["importance"];
}

export async function saveTask(draft: TaskDraft): Promise<boolean> {
  const isNew = !draft.id;
  const id = draft.id ?? uuid7();
  const res = await mutate({
    request: () => (isNew ? post("/tasks", { ...draft, id }) : patch(`/tasks/${id}`, { ...draft, id: undefined })),
    refresh: ["/views/day", "/views/tasks", "/views/profile", "/views/review"],
  });
  return res !== undefined;
}

export async function deleteTask(id: string): Promise<void> {
  await mutate({ request: () => del(`/tasks/${id}`), refresh: ["/views/day", "/views/tasks", "/views/profile"] });
}

export function refreshAll(): void {
  invalidateSoon("/views", "/me", "/settings", "/habits", "/spheres", "/goals");
}
