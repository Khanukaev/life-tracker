/** Bottom message: a short status, optionally with an icon and «Отменить». */

import { signal } from "@preact/signals";
import { haptic } from "./haptic";

export type ToastIcon = "check" | "trash" | "offline" | null;

export const toastText = signal<string | null>(null);
export const toastIcon = signal<ToastIcon>(null);
export const toastUndo = signal<(() => void) | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let onExpire: (() => void) | null = null;

/** Show a message. `undo` adds «Отменить»; `expire` runs when it goes away without undo. */
export function toast(text: string, opts: { icon?: ToastIcon; undo?: () => void; expire?: () => void; ms?: number } = {}): void {
  flushToast();
  toastText.value = text;
  toastIcon.value = opts.icon ?? null;
  toastUndo.value = opts.undo ?? null;
  onExpire = opts.expire ?? null;
  timer = setTimeout(flushToast, opts.ms ?? (opts.undo ? 5000 : 2400));
}

/** Close the current message now; a pending action (e.g. a deletion) is committed. */
export function flushToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const run = onExpire;
  onExpire = null;
  toastText.value = null;
  toastUndo.value = null;
  toastIcon.value = null;
  run?.();
}

/** «Отменить»: drop the pending action and run the undo. */
export function undoToast(): void {
  const undo = toastUndo.value;
  haptic.light();
  onExpire = null;
  if (timer) clearTimeout(timer);
  timer = null;
  toastText.value = null;
  toastUndo.value = null;
  toastIcon.value = null;
  undo?.();
}

// A pending deletion must not get lost when the app goes to the background.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && onExpire) flushToast();
  });
}
