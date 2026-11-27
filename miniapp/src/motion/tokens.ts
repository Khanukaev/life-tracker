/**
 * Motion system for Liquid Glass. One set of durations and easings for everything,
 * mirrored in styles/motion.css as CSS variables.
 *
 * Rules (spec + animations.dev + GSAP performance skills):
 * - only transform, opacity and SVG stroke-dashoffset;
 * - 150–400 ms, ease-out for entrances, springs for sheets;
 * - motion never delays data or input: content is rendered final and clickable at once;
 * - no motion under prefers-reduced-motion or on weak devices.
 */

import { signal } from "@preact/signals";

export const DUR = { fast: 0.16, base: 0.26, slow: 0.38 } as const; // seconds
export const EASE_OUT = "power3.out"; // = cubic-bezier(0.215, 0.61, 0.355, 1) in CSS
export const EASE_OUT_CSS = "cubic-bezier(0.215, 0.61, 0.355, 1)";
export const STAGGER = 0.045; // seconds between cards
export const SPRING = { stiffness: 420, damping: 38 } as const; // sheets

/** True only on a capable device without reduced-motion. */
export const motionOk = signal(false);

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setMotion(on: boolean): void {
  motionOk.value = on;
  document.documentElement.classList.toggle("motion-ok", on);
}

/** Motion only where it renders smoothly and the user didn't ask for less of it. */
export function canMotion(): boolean {
  const mm = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  if (mm("(prefers-reduced-motion: reduce)") || mm("(prefers-reduced-transparency: reduce)")) return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4) return false;
  return true;
}
