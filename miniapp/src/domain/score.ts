/**
 * Lightweight client copy of the score formulas, used ONLY for optimistic recalculation
 * right after a tap (the server stays the source of truth and refreshes quietly).
 *
 * Mirrors backend/lifetracker/domain/{habits,score}.py and is checked against the same
 * golden expectations produced by the original JavaScript (see score.test.ts).
 */

import type { HabitRow, HabitType, Importance, Score, ScoreItem, Status } from "../lib/types";

export const KEY_WEIGHT = 3;
export const HABIT_WEIGHT = 1;
export const CRITICAL_TASK_WEIGHT = 3;
export const TASK_WEIGHT = 2;

export function glassesNeed(config: Record<string, any>): number {
  return Math.max(1, Math.ceil(Number(config.target_l) / Number(config.glass_l) - 1e-9));
}

/** Whether a habit value fulfils the habit (bedtime is derived from sleep: unknown here). */
export function isDone(type: HabitType, config: Record<string, any>, value: any): boolean | null {
  switch (type) {
    case "bedtime":
      return null;
    case "water":
      return (value ?? 0) >= glassesNeed(config);
    case "minutes":
      return value != null && value >= Number(config.target_min);
    case "dual":
      return !!(value && value.a && value.b);
    default:
      return !!value;
  }
}

/** Status of a non-bedtime habit after a local change. */
export function statusAfter(row: HabitRow, value: any, isToday: boolean): Status {
  if (row.type === "bedtime") return row.status;
  if (isDone(row.type, row.config, value)) return "done";
  if (!row.due) return "rest";
  return isToday ? "pending" : "missed";
}

/** Partial credit of an item (`dayScore`): water, minutes and dual count partially. */
export function itemValue(type: HabitType, config: Record<string, any>, value: any, status: Status): number {
  let v = status === "done" ? 1 : 0;
  if (type === "water") v = Math.min(1, (value ?? 0) / glassesNeed(config));
  else if (type === "dual") v = (value?.a ? 0.5 : 0) + (value?.b ? 0.5 : 0);
  else if (type === "minutes" && value != null) v = Math.min(1, value / Number(config.target_min));
  return v;
}

export interface TaskLike {
  id: string;
  title: string;
  importance: Importance;
  done: boolean;
}

/** Rebuild the score from habit rows, tasks and the (server-computed) sleep item. */
export function computeScore(
  habits: HabitRow[],
  tasks: TaskLike[],
  sleepItem: ScoreItem | null,
): { pct: number; W: number; items: ScoreItem[] } {
  const items: ScoreItem[] = [];
  if (sleepItem) items.push({ ...sleepItem });
  for (const h of habits) {
    if (h.type === "bedtime" || h.status === "rest") continue;
    items.push({
      kind: "habit",
      ref: h.id,
      label: h.name,
      w: h.is_key ? KEY_WEIGHT : HABIT_WEIGHT,
      v: itemValue(h.type, h.config, h.value, h.status),
      points: 0,
      max_points: 0,
      note: "",
    });
  }
  for (const t of tasks) {
    items.push({
      kind: "task",
      ref: t.id,
      label: t.title,
      w: t.importance === "critical" ? CRITICAL_TASK_WEIGHT : TASK_WEIGHT,
      v: t.done ? 1 : 0,
      points: 0,
      max_points: 0,
      note: "",
    });
  }
  const W = items.reduce((a, x) => a + x.w, 0);
  const got = items.reduce((a, x) => a + x.w * x.v, 0);
  for (const x of items) {
    x.points = W ? Math.round((x.w * x.v) / W * 100) : 0;
    x.max_points = W ? Math.round((x.w / W) * 100) : 0;
  }
  return { pct: W ? Math.round((got / W) * 100) : 0, W, items };
}

/** "Как поднять рейтинг": biggest possible gains among unfinished items. */
export function computeGains(items: ScoreItem[], W: number, limit = 4) {
  return items
    .filter((x) => x.kind !== "sleep" && x.v < 1)
    .map((x) => ({ kind: x.kind, ref: x.ref, label: x.label, points: Math.round((x.w * (1 - x.v)) / W * 100) }))
    .filter((g) => g.points >= 1)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

/** Apply a recomputed score to the server score object (keeps week/delta context). */
export function patchScore(score: Score, habits: HabitRow[], tasks: TaskLike[], isToday: boolean): Score {
  const sleep = score.items.find((x) => x.kind === "sleep") ?? null;
  const { pct, W, items } = computeScore(habits, tasks, sleep);
  const prevPct = score.delta != null ? score.pct - score.delta : null;
  const gains = isToday ? computeGains(items, W) : [];
  return {
    ...score,
    pct,
    delta: prevPct != null ? pct - prevPct : null,
    items,
    gains,
    gains_total: gains.reduce((a, g) => a + g.points, 0),
    bed_gain: sleep && W ? Math.round((sleep.w / W) * 100) : 0,
    week: score.week.map((b, i) => (i === score.week.length - 1 ? { ...b, pct } : b)),
  };
}

/** Streak right after a local change: streak up to yesterday + today if it counts. */
export function streakAfter(row: HabitRow, status: Status): number {
  return row.streak_base + (status === "done" || status === "rest" ? 1 : 0);
}
