/** Navigation: 4 tabs, a stack of screens inside Profile, one sheet at a time.
 * The Telegram Back button closes the sheet first, then pops the stack. */

import { computed, effect, signal } from "@preact/signals";
import { haptic } from "./haptic";
import { setBackButton } from "./telegram";

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
  if (tab.value !== t) haptic.light();
  tab.value = t;
  stack.value = [];
  window.scrollTo(0, 0);
}

export function push(name: ScreenName, params?: Record<string, string>): void {
  if (tab.value !== "profile" && name !== "past") tab.value = "profile";
  stack.value = [...stack.value, { name, params }];
  window.scrollTo(0, 0);
}

export function pop(): void {
  stack.value = stack.value.slice(0, -1);
}

export function openSheet(kind: SheetKind, props: Record<string, any> = {}): void {
  sheet.value = { kind, props };
}

export function closeSheet(): void {
  sheet.value = null;
}

export function openDay(date: string | null): void {
  dayDate.value = date;
  tab.value = "day";
  stack.value = [];
}

/** Keep the native Back button in sync with what can be closed. */
export function syncBackButton(): void {
  effect(() => {
    if (sheet.value) setBackButton(closeSheet);
    else if (stack.value.length) setBackButton(pop);
    else setBackButton(null);
  });
}
