/**
 * Screen entrance: cards visible on open appear one after another (stagger);
 * blocks below the fold reveal once when they scroll into view (IntersectionObserver),
 * never again on scrolling back. Content is final and clickable from the first frame —
 * only opacity/transform are animated on top.
 */

import { motionOk } from "./tokens";

const MAX_STAGGER = 8;
const WATCH_MS = 1500; // cached first paint → fresh data: animate what arrives right after open

let io: IntersectionObserver | null = null;
let mo: MutationObserver | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function blocks(root: Element): HTMLElement[] {
  const main = root.querySelector(".main");
  const head = root.querySelector("header");
  return [...(head ? [head] : []), ...(main ? Array.from(main.children) : [])] as HTMLElement[];
}

function prepare(els: HTMLElement[], startIndex: number): number {
  let i = startIndex;
  const vh = window.innerHeight;
  for (const el of els) {
    if (el.dataset.motion) continue;
    const top = el.getBoundingClientRect().top;
    if (top < vh) {
      el.dataset.motion = "enter";
      el.style.setProperty("--i", String(Math.min(i++, MAX_STAGGER)));
    } else {
      el.dataset.motion = "reveal";
      io?.observe(el);
    }
  }
  return i;
}

/** Call after a screen change. Safe to call when motion is off (does nothing). */
export function animateScreen(): void {
  cleanup();
  if (!motionOk.value) return;
  const root = document.querySelector(".page");
  if (!root) return;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add("in");
          io?.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  let next = prepare(blocks(root), 0);
  const main = root.querySelector(".main");
  if (main) {
    mo = new MutationObserver(() => {
      next = prepare(blocks(root), next);
    });
    mo.observe(main, { childList: true });
    stopTimer = setTimeout(() => mo?.disconnect(), WATCH_MS);
  }
}

function cleanup() {
  io?.disconnect();
  mo?.disconnect();
  if (stopTimer) clearTimeout(stopTimer);
  io = mo = null;
}

/** View Transitions API for tab/screen changes where supported; plain update otherwise. */
export function withTransition(update: () => void): void {
  type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void> | void) => VT };
  if (!motionOk.value || !doc.startViewTransition || document.visibilityState !== "visible") {
    update();
    return;
  }
  const vt = doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        update();
        // Preact re-renders in a microtask; resolve after it has painted the new screen.
        requestAnimationFrame(() => resolve());
      }),
  );
  // A transition can be skipped by the browser (e.g. the app goes to background);
  // the DOM update still happens, so these rejections are expected and harmless.
  const ignore = () => {};
  vt.ready.catch(ignore);
  vt.finished.catch(ignore);
  vt.updateCallbackDone.catch(ignore);
}

/** Spring-like press feedback on a card, synced with the success vibration (WAAPI). */
export function pop(selector: string): void {
  if (!motionOk.value) return;
  const el = document.querySelector<HTMLElement>(selector);
  el?.animate(
    [{ transform: "scale(1)" }, { transform: "scale(0.97)" }, { transform: "scale(1.012)" }, { transform: "scale(1)" }],
    { duration: 320, easing: "cubic-bezier(0.215, 0.61, 0.355, 1)" },
  );
}
