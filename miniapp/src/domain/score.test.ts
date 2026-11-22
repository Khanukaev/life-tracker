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

function convert(h: LegacyHabit, targets: Record<string, number>): { type: HabitType; config: Record<string, any>; key: boolean } {
  if (h.type === "water") return { type: "water", config: { target_l: targets.waterL, glass_l: targets.glassL }, key: false };
  if (h.type === "protein") return { type: "dual", config: { labels: ["a", "b"] }, key: false };
  if (h.key === "study") {
    return { type: "minutes", config: { target_min: Math.max(15, Math.round((targets.studyH || 2) * 60)) }, key: true };
  }
  return { type: "check", config: {}, key: h.key === "orders" };
}

function valueOf(h: LegacyHabit, type: HabitType, config: Record<string, any>, raw: Record<string, any>): any {
  if (type === "water") return raw[h.key] ?? null;
  if (type === "dual") return "kbju" in raw || "proteinOk" in raw ? { a: !!raw.kbju, b: !!raw.proteinOk } : null;
  if (type === "minutes") return raw.studyMin ?? (raw.study ? config.target_min : null);
  return raw[h.key] ? true : null;
}

describe.each(names)("golden %s", (file) => {
  const fx = JSON.parse(readFileSync(join(ROOT, "fixtures", file), "utf8"));
  const exp = JSON.parse(readFileSync(join(ROOT, "expected", file), "utf8"));
  const targets = { bed: "01:00", waterL: 2.5, glassL: 0.25, proteinG: 140, sleepNeed: 8, studyH: 2, ...(fx.settings.targets ?? {}) };
  const habits: LegacyHabit[] = fx.settings.habits;

  it("computes the day score exactly like the original", () => {
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
            id: h.key, name: h.key, type: c.type, is_key: c.key, sphere_id: null, config: c.config,
            schedule: { kind: "daily" }, status: exp.habits[h.key].status[day] as Status,
            due: exp.habits[h.key].due[day], value: valueOf(h, c.type, c.config, raw),
            streak: 0, streak_base: 0,
          };
        });
      const sleepExp = sc.items.find((x: any[]) => x[0] === "sleep");
      const sleep: ScoreItem | null = sleepExp
        ? { kind: "sleep", ref: "bedtime", label: "", w: sleepExp[1], v: sleepExp[2], points: 0, max_points: 0, note: "" }
        : null;
      const got = computeScore(
        rows,
        tasks.map((t) => ({ id: t.id, title: t.title, importance: "normal", done: !!t.done })),
        sleep,
      );
      const legacy = got.items.map((x) => [x.kind === "sleep" ? "sleep" : x.kind === "task" ? "tasks" : x.ref, x.w, r6(x.v)]);
      expect(legacy, day).toEqual(sc.items);
      expect(got.pct, day).toBe(sc.pct);
      expect(got.W, day).toBe(sc.W);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe("optimistic helpers", () => {
  it("knows when a habit is done", () => {
    expect(isDone("water", { target_l: 2, glass_l: 0.25 }, 8)).toBe(true);
    expect(isDone("water", { target_l: 2, glass_l: 0.25 }, 7)).toBe(false);
    expect(isDone("minutes", { target_min: 30 }, 30)).toBe(true);
    expect(isDone("dual", {}, { a: true, b: false })).toBe(false);
    expect(isDone("bedtime", {}, null)).toBeNull();
  });

  it("adds today to the streak only when it counts", () => {
    const row = { streak_base: 4 } as HabitRow;
    expect(streakAfter(row, "done")).toBe(5);
    expect(streakAfter(row, "pending")).toBe(4);
  });
});
