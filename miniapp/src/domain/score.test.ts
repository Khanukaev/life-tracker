/**
 * The client copy of the score formula vs the golden expectations produced by running
 * the ORIGINAL JavaScript (golden/run-legacy.mjs). Habit statuses come from the same
 * expectations; values are converted from the legacy export like the backend adapter.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HabitRow, HabitType, ScoreItem, Status } from "../lib/types";
import { computeScore, isDone, streakAfter } from "./score";

const ROOT = join(__dirname, "../../../golden");
const names = readdirSync(join(ROOT, "fixtures")).filter((f) => f.endsWith(".json"));

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

interface LegacyHabit {
  key: string;
  type: string;
  active?: boolean;
}

/** Same conversion as backend/lifetracker/domain/legacy.py: water, protein (КБЖУ + белок)
 * and study minutes all become `count` habits with a daily norm. */
function convert(h: LegacyHabit, targets: Record<string, number>): { type: HabitType; config: Record<string, any> } {
  if (h.type === "water") return { type: "count", config: { norm: Math.max(1, Math.ceil(targets.waterL! / targets.glassL! - 1e-9)), step: 1 } };
  if (h.type === "protein") return { type: "count", config: { norm: 2, step: 1 } };
  if (h.key === "study") return { type: "count", config: { norm: Math.max(15, Math.round((targets.studyH || 2) * 60)), step: 15 } };
  return { type: "check", config: {} };
}

/** The original weighted sleep/study/orders ×3; here every habit is ×1 (tasks unchanged).
 * Item order and values stay the original's, so they are still compared exactly. */
function equalWeights(items: [string, number, number][]) {
  const out = items.map(([k, w, v]) => [k, k === "tasks" ? w : 1, v] as [string, number, number]);
  const W = out.reduce((a, x) => a + x[1], 0);
  const got = out.reduce((a, x) => a + x[1] * x[2], 0);
  return { items: out, W, pct: W ? Math.round((got / W) * 100) : 0 };
}

function valueOf(h: LegacyHabit, config: Record<string, any>, raw: Record<string, any>): any {
  if (h.type === "water") return raw[h.key] ?? null;
  if (h.type === "protein") return "kbju" in raw || "proteinOk" in raw ? (raw.kbju ? 1 : 0) + (raw.proteinOk ? 1 : 0) : null;
  if (h.key === "study") return raw.studyMin ?? (raw.study ? config.norm : null);
  return raw[h.key] ? true : null;
}

describe.each(names)("golden %s", (file) => {
  const fx = JSON.parse(readFileSync(join(ROOT, "fixtures", file), "utf8"));
  const exp = JSON.parse(readFileSync(join(ROOT, "expected", file), "utf8"));
  const targets = { bed: "01:00", waterL: 2.5, glassL: 0.25, proteinG: 140, sleepNeed: 8, studyH: 2, ...(fx.settings.targets ?? {}) };
  const habits: LegacyHabit[] = fx.settings.habits;

  it("computes the day score like the original, habits at ×1", () => {
    let compared = 0;
    for (const [day, sc] of Object.entries<any>(exp.dayScore)) {
      if (!sc) continue;
      const tasks = Object.values<any>(fx.tasks).filter((t) => t.date === day);
      if (tasks.length > 1) continue; // new rule: one item per task (equal for ≤1 task)
      const raw = fx.days[day]?.h ?? {};
      const rows: HabitRow[] = habits
        .filter((h) => h.active !== false && h.type !== "sleep")
        .map((h) => {
          const c = convert(h, targets);
          return {
            id: h.key, name: h.key, type: c.type, config: c.config,
            schedule: { kind: "daily" }, status: exp.habits[h.key].status[day] as Status,
            due: exp.habits[h.key].due[day], value: valueOf(h, c.config, raw),
            streak: 0, streak_base: 0,
          };
        });
      const sleepExp = sc.items.find((x: any[]) => x[0] === "sleep");
      const sleep: ScoreItem | null = sleepExp
        ? { kind: "sleep", ref: "bedtime", label: "", w: 1, v: sleepExp[2], points: 0, max_points: 0, note: "" }
        : null;
      const got = computeScore(
        rows,
        tasks.map((t) => ({ id: t.id, title: t.title, important: false, done: !!t.done })),
        sleep,
      );
      const legacy = got.items.map((x) => [x.kind === "sleep" ? "sleep" : x.kind === "task" ? "tasks" : x.ref, x.w, r6(x.v)]);
      const want = equalWeights(sc.items);
      expect(legacy, day).toEqual(want.items);
      expect(got.pct, day).toBe(want.pct);
      expect(got.W, day).toBe(want.W);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe("optimistic helpers", () => {
  it("knows when a habit is done", () => {
    expect(isDone("count", { norm: 8, step: 1 }, 8)).toBe(true);
    expect(isDone("count", { norm: 8, step: 1 }, 7)).toBe(false);
    expect(isDone("check", {}, true)).toBe(true);
    expect(isDone("bedtime", {}, null)).toBeNull();
  });

  it("weighs habits ×1, tasks ×2 and important tasks ×3, counts partially", () => {
    const row = (id: string, value: number): HabitRow => ({
      id, name: id, type: "count", config: { norm: 4, step: 1 }, schedule: { kind: "daily" },
      status: "pending", due: true, value, streak: 0, streak_base: 0,
    });
    const got = computeScore(
      [row("water", 2)],
      [{ id: "a", title: "a", important: true, done: true }, { id: "b", title: "b", important: false, done: false }],
      null,
    );
    expect(got.items.map((x) => x.w)).toEqual([1, 3, 2]);
    expect(got.W).toBe(6);
    expect(got.pct).toBe(Math.round(((0.5 + 3) / 6) * 100));
  });

  it("adds today to the streak only when it counts", () => {
    const row = { streak_base: 4 } as HabitRow;
    expect(streakAfter(row, "done")).toBe(5);
    expect(streakAfter(row, "pending")).toBe(4);
  });
});
