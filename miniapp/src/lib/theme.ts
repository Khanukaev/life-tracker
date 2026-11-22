/** Theme: "glass" (Liquid Glass) or "base". The user's choice lives on the backend
 * (null = auto) and is cached locally, so the next launch paints the right theme at once. */

import { signal } from "@preact/signals";

export type ThemeName = "base" | "glass";
export type ThemePref = ThemeName | null;

const KEY = "lt:theme";

/** Glass only where it renders smoothly and the user didn't ask for less effects. */
export function canGlass(): boolean {
  const mm = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  if (mm("(prefers-reduced-transparency: reduce)") || mm("(prefers-reduced-motion: reduce)")) {
    return false;
  }
  if (typeof CSS === "undefined" || !(CSS.supports("backdrop-filter: blur(1px)") || CSS.supports("-webkit-backdrop-filter: blur(1px)"))) {
    return false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4) return false;
  return true;
}

export function resolveTheme(pref: ThemePref): ThemeName {
  if (pref === "base") return "base";
  if (pref === "glass") return canGlass() ? "glass" : "base";
  return canGlass() ? "glass" : "base";
}

function initial(): ThemeName {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "glass" || t === "base") return t;
  } catch {
    /* storage may be unavailable */
  }
  return resolveTheme(null);
}

export const theme = signal<ThemeName>(initial());

/** Switch instantly: one class on <html>, CSS variables do the rest. */
export function applyTheme(name: ThemeName): void {
  theme.value = name;
  document.documentElement.className = `theme-${name}`;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* ignore */
  }
}
