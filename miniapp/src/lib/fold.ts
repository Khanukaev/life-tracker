/** «Отмечено · N»: a row that was just checked stays in place for a second with its green
 * check, then slides away into the folded group (otherwise it vanishes from under the finger). */

import { signal } from "@preact/signals";
import { motionOk } from "../motion/tokens";

export const HOLD_MS = 1000;
const LEAVE_MS = 260;

export const holds = signal<Record<string, "hold" | "leave">>({});
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function set(id: string, phase: "hold" | "leave" | null) {
  const next = { ...holds.value };
  if (phase) next[id] = phase;
  else delete next[id];
  holds.value = next;
}

export function hold(id: string): void {
  release(id);
  set(id, "hold");
  const leave = motionOk.value;
  timers.set(id, [
    ...(leave ? [setTimeout(() => set(id, "leave"), HOLD_MS)] : []),
    setTimeout(() => release(id), HOLD_MS + (leave ? LEAVE_MS : 0)),
  ]);
}

export function release(id: string): void {
  timers.get(id)?.forEach(clearTimeout);
  timers.delete(id);
  if (holds.value[id]) set(id, null);
}
