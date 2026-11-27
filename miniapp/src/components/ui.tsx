/** The bottom sheet shared by all sheets. Closes on scrim tap or a swipe down from the top;
 * with motion on it opens and closes on a spring and follows the finger. */

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { haptic } from "../lib/haptic";
import { closeSheet, closeSheetNow, registerSheetClose } from "../lib/router";
import { springY, type SpringHandle } from "../motion/spring";
import { motionOk } from "../motion/tokens";

/** Bottom sheet. Closes on scrim tap or a swipe down from the top area.
 * In Liquid Glass it opens and closes on a spring and follows the finger. */
export function Sheet({ children, label, cls = "k-sheet" }: { children: ComponentChildren; label: string; cls?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let spring: SpringHandle | null = null;
    const height = () => el.getBoundingClientRect().height || window.innerHeight;
    const animated = motionOk.value;

    const close = (velocity = 0) => {
      spring?.stop();
      if (!motionOk.value) return closeSheetNow();
      scrim.current?.classList.add("closing");
      const cur = currentY(el);
      spring = springY(el, cur, height(), { velocity, onDone: closeSheetNow, damping: 32 });
    };
    if (animated) {
      el.style.transform = `translate3d(0, ${height()}px, 0)`;
      spring = springY(el, height(), 0);
      registerSheetClose(() => close());
    }

    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dy = 0;
    let tracking = false;
    let frame = 0;
    // The finger is followed once per frame (not once per touch event): touch events come
    // unevenly, and writing the transform on each of them made the drag look jerky.
    const paint = () => {
      frame = 0;
      const d = Math.max(0, dy);
      el.style.transform = `translate3d(0, ${d.toFixed(1)}px, 0)`;
      if (scrim.current) scrim.current.style.opacity = String(1 - Math.min(0.6, d / height()));
    };
    const down = (e: TouchEvent) => {
      // Controls with their own drag (the sleep dial) mark themselves; a swipe that starts
      // on them is theirs, not a request to close the sheet.
      const own = (e.target as Element | null)?.closest?.("[data-own-drag]");
      tracking = !own && el.scrollTop <= 0;
      startY = lastY = e.touches[0]!.clientY;
      lastT = performance.now();
      dy = 0;
      velocity = 0;
      spring?.stop();
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      const y = e.touches[0]!.clientY;
      const now = performance.now();
      // px/s, smoothed: single touch events are noisy and made the release feel random.
      velocity = 0.6 * (((y - lastY) / Math.max(1, now - lastT)) * 1000) + 0.4 * velocity;
      lastY = y;
      lastT = now;
      dy = y - startY;
      if (dy > 0) {
        e.preventDefault();
        frame ||= requestAnimationFrame(paint);
      }
    };
    const up = () => {
      if (!tracking) return;
      tracking = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (scrim.current) scrim.current.style.opacity = "";
      if (dy > 110 || velocity > 900) {
        haptic.light();
        return close(Math.max(0, velocity));
      }
      if (motionOk.value) spring = springY(el, Math.max(0, dy), 0, { velocity });
      else el.style.transform = "";
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("touchcancel", up);
      spring?.stop();
      registerSheetClose(null);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
    };
  }, []);

  return (
    <div class="scrim k-scrim" ref={scrim} onClick={(e) => e.target === e.currentTarget && closeSheet()}>
      <div class={`sheet ${cls}`} ref={ref} role="dialog" aria-modal="true" aria-label={label}>
        <div class="grabber" />
        {children}
      </div>
    </div>
  );
}

function currentY(el: HTMLElement): number {
  const m = /translate3d\(0, ([-\d.]+)px/.exec(el.style.transform);
  return m ? Number(m[1]) : 0;
}
