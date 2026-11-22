/** Navigation: 4 tabs, a stack of screens inside Profile, one sheet at a time.
 * The Telegram Back button closes the sheet first, then pops the stack. */

import { computed, effect, signal } from "@preact/signals";
import { haptic } from "./haptic";
import { setBackButton } from "./telegram";
import { withTransition } from "../motion/screen";

export type Tab = "day" | "now" | "review" | "profile";
export type ScreenName =
  | "tasks"
  | "goals"
  | "habits"
  | "settings"
  | "norms"
  | "past";

export interface Screen {
  name: ScreenName;
  params?: Record<string, string>;
}

export type SheetKind =
  | "task"
  | "sleep"
  | "habit"
  | "goal"
  | "sphere"
  | "profile"
  | "claude";

export interface SheetState {
  kind: SheetKind;
  props: Record<string, any>;
}

export const tab = signal<Tab>("day");
export const stack = signal<Screen[]>([]);
export const sheet = signal<SheetState | null>(null);
export const dayDate = signal<string | null>(null); // null = today

export const current = computed<Screen | null>(() => stack.value[stack.value.length - 1] ?? null);

export function goTab(t: Tab): void {
  if (tab.value === t && !stack.value.length) return;
  haptic.light();
  withTransition(() => {
    tab.value = t;
    stack.value = [];
    window.scrollTo(0, 0);
  });
}

export function push(name: ScreenName, params?: Record<string, string>): void {
  withTransition(() => {
    if (tab.value !== "profile" && name !== "past") tab.value = "profile";
    stack.value = [...stack.value, { name, params }];
    window.scrollTo(0, 0);
  });
}

export function pop(): void {
  withTransition(() => {
    stack.value = stack.value.slice(0, -1);
  });
}

export function openSheet(kind: SheetKind, props: Record<string, any> = {}): void {
  sheet.value = { kind, props };
}

/** A mounted sheet may register an animated close (spring down); otherwise close at once. */
let animatedClose: (() => void) | null = null;
export function registerSheetClose(fn: (() => void) | null): void {
  animatedClose = fn;
}
export function closeSheet(): void {
  if (animatedClose) animatedClose();
  else sheet.value = null;
}
export function closeSheetNow(): void {
  animatedClose = null;
  sheet.value = null;
}

export function openDay(date: string | null): void {
  withTransition(() => {
    dayDate.value = date;
    tab.value = "day";
    stack.value = [];
  });
}

/** Keep the native Back button in sync with what can be closed. */
export function syncBackButton(): void {
  effect(() => {
    if (sheet.value) setBackButton(closeSheet);
    else if (stack.value.length) setBackButton(pop);
    else setBackButton(null);
  });
}
