/** Navigation: 3 tabs (Сегодня · План · Итоги), a stack of nested screens, one sheet at a time.
 * There is no own Back button: Telegram's BackButton closes the sheet first, then pops the stack. */

import { computed, effect, signal } from "@preact/signals";
import { haptic } from "./haptic";
import { setBackButton } from "./telegram";

export type Tab = "today" | "plan" | "results";
export type ScreenName = "task" | "habit" | "profile" | "settings" | "norms" | "claude" | "reviews" | "import";

export interface Screen {
  name: ScreenName;
  params?: Record<string, string>;
}

export type SheetKind = "add" | "energy" | "sleep";

export interface SheetState {
  kind: SheetKind;
  props: Record<string, any>;
}

export const tab = signal<Tab>("today");
export const stack = signal<Screen[]>([]);
export const sheet = signal<SheetState | null>(null);
export const dayDate = signal<string | null>(null); // null = today
export const dayMode = signal<"list" | "hours">("list");

export const current = computed<Screen | null>(() => stack.value[stack.value.length - 1] ?? null);

export function goTab(t: Tab): void {
  if (tab.value === t && !stack.value.length) return;
  haptic.light();
  tab.value = t;
  stack.value = [];
  window.scrollTo(0, 0);
}

export function push(name: ScreenName, params?: Record<string, string>): void {
  stack.value = [...stack.value, { name, params }];
  window.scrollTo(0, 0);
}

export function pop(): void {
  stack.value = stack.value.slice(0, -1);
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
  dayDate.value = date;
  tab.value = "today";
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

/** Links from the bot open a sheet right away, e.g. "Записать сон" → `?open=sleep`. */
export function deepLinkSheet(): SheetKind | null {
  const v = new URLSearchParams(location.search).get("open");
  return v === "sleep" ? v : null;
}
