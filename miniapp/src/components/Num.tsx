/** A number that "rolls" to its value in Liquid Glass.
 *
 * The span has no Preact-managed children: its text is written in a layout effect (before
 * paint), so the final value is on screen in the very first frame when motion is off, and
 * GSAP can rewrite the text every frame without fighting the virtual DOM. */

import type { CSSProperties } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { gsapNow, loadGsap } from "../motion/gsap";
import { DUR, EASE_OUT, motionOk } from "../motion/tokens";

type Gsap = NonNullable<ReturnType<typeof gsapNow>>;

export function Num({ value, class: cls, style }: { value: number | null; class?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  const mountedAt = useRef(performance.now());

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const to = value;
    const from = prev.current ?? 0;
    prev.current = to;
    const show = (n: number | null) => (el.textContent = n == null ? "—" : String(Math.round(n)));
    if (to == null || !motionOk.value || from === to) {
      show(to);
      return;
    }
    let guard: ReturnType<typeof setTimeout> | undefined;
    const run = (g: Gsap) => {
      const o = { n: from };
      show(from);
      // Safety net for throttled frames: the true value always lands within ~0.6 s.
      guard = setTimeout(() => show(to), DUR.slow * 1000 + 250);
      return g.to(o, { n: to, duration: DUR.slow, ease: EASE_OUT, onUpdate: () => show(o.n), onComplete: () => show(to) });
    };
    const g = gsapNow();
    if (g) {
      const tw = run(g);
      return () => {
        tw.kill();
        clearTimeout(guard);
      };
    }
    // GSAP still loading: show the value now; roll only if it arrives right after opening.
    show(to);
    let alive = true;
    void loadGsap().then((gs) => {
      if (alive && performance.now() - mountedAt.current < 600) run(gs);
    });
    return () => {
      alive = false;
      clearTimeout(guard);
    };
  }, [value]);

  return <span ref={ref} class={cls} style={style} aria-label={value == null ? undefined : String(value)} />;
}
