/** Tiny damped-spring animator for sheets (no library). Writes transform directly to the
 * element every frame — never through component state — so it stays cheap. */

import { SPRING } from "./tokens";

export interface SpringHandle {
  stop(): void;
}

export function springY(
  el: HTMLElement,
  from: number,
  to: number,
  opts: { velocity?: number; stiffness?: number; damping?: number; onDone?: () => void } = {},
): SpringHandle {
  const k = opts.stiffness ?? SPRING.stiffness;
  const c = opts.damping ?? SPRING.damping;
  let x = from;
  let v = opts.velocity ?? 0; // px per second
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    el.style.transform = to === 0 ? "" : `translate3d(0, ${to}px, 0)`;
    opts.onDone?.();
  };
  // Safety net: if frames are throttled (background tab, busy device) the sheet must still
  // end up where it belongs — motion never blocks the UI.
  const guard = setTimeout(finish, 700);

  const step = (now: number) => {
    if (stopped) return;
    // Fixed small sub-steps keep the integration stable on slow frames.
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = -k * (x - to) - c * v;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    el.style.transform = `translate3d(0, ${x.toFixed(2)}px, 0)`;
    if (Math.abs(v) < 8 && Math.abs(x - to) < 0.5) {
      clearTimeout(guard);
      finish();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    stop() {
      stopped = true;
      clearTimeout(guard);
      cancelAnimationFrame(raf);
    },
  };
}
