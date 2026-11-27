/** Small shared components (markup and classes follow reference/design). */

import type { ComponentChildren, CSSProperties } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { haptic } from "../lib/haptic";
import { closeSheet, closeSheetNow, pop, registerSheetClose } from "../lib/router";
import { springY, type SpringHandle } from "../motion/spring";
import { motionOk } from "../motion/tokens";
import { toastText } from "../lib/toast";

const PATHS: Record<string, string> = {
  spark: "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  warn: "M12 4l9 16H3zM12 10v4M12 17h.01",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  edit: "M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  bolt: "M13 3L5 13.5h6L10 21l9-11h-6z",
  day: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  stats: "M5 20v-6M12 20V5M19 20v-10",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.5 3.8-5.5 7.5-5.5s6.7 2 7.5 5.5",
  x: "M18 6L6 18M6 6l12 12",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  dumbbell: "M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12",
};

export function Icon({ name, size, style }: { name: string; size?: number; style?: CSSProperties }) {
  return (
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style={{ ...(size ? { width: size, height: size } : {}), ...style }}>
      <path d={PATHS[name] ?? ""} pathLength={1} />
    </svg>
  );
}

export function Check({
  on,
  variant,
  onClick,
  label,
  small,
}: {
  on: boolean;
  variant?: "crit" | "imp" | "done" | "auto" | "rest" | "";
  onClick?: () => void;
  label: string;
  small?: boolean;
}) {
  const cls = `chk ${small ? "sm " : ""}${on ? (variant === "done" ? "done" : "on") : variant ?? ""}`;
  if (!onClick) {
    return (
      <span class={cls} aria-label={label} role="img">
        {on && <Icon name="check" />}
      </span>
    );
  }
  return (
    <button class={cls} aria-label={label} aria-pressed={on} onClick={onClick}>
      {on && <Icon name="check" />}
    </button>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  short,
  label,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
  short?: boolean;
  label: string;
}) {
  return (
    <div class={`seg${short ? " short" : ""}`} style={{ "--n": options.length } as CSSProperties} role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={String(v)}
          class={v === value ? "on" : ""}
          aria-pressed={v === value}
          onClick={() => {
            if (v !== value) haptic.selection();
            onChange(v);
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      class={`sw${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        haptic.selection();
        onChange(!on);
      }}
    />
  );
}

/** A number field that can be erased and retyped. A controlled `type="number"` input snaps
 * back to its value on every re-render, so an emptied field refilled itself; here the text
 * is a local draft and the clamped number is applied on blur or Enter. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  decimal,
  label,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  decimal?: boolean;
  label: string;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    const v = draft.trim() === "" || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, decimal ? n : Math.round(n)));
    setDraft(null);
    if (v !== value) onChange(v);
  };
  return (
    <input
      class="pill-input"
      style={style}
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={label}
      value={draft ?? String(value)}
      onFocus={(e) => (e.target as HTMLInputElement).select()}
      onInput={(e) => setDraft((e.target as HTMLInputElement).value.replace(decimal ? /[^\d.,]/g : /\D/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Sec({ title, end }: { title: string; end?: ComponentChildren }) {
  return (
    <div class="sec">
      <span>{title}</span>
      {end !== undefined && <span>{end}</span>}
    </div>
  );
}

export function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div class="card empty">
      <span class="s" style={{ fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>
        {text}
      </span>
      {action && (
        <button class="btn tint" onClick={onAction}>
          <Icon name="plus" size={16} />
          {action}
        </button>
      )}
    </div>
  );
}

export function StackHead({ back, title, action }: { back: string; title: string; action?: ComponentChildren }) {
  return (
    <header class="stack-head">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button class="ib" style={{ width: "auto", padding: "0 8px", gap: "2px", fontSize: "17px" }} onClick={pop}>
          <Icon name="left" />
          {back}
        </button>
        {action}
      </div>
      <h1 class="h1">{title}</h1>
    </header>
  );
}

/** Bottom sheet. Closes on scrim tap or a swipe down from the top area.
 * In Liquid Glass it opens and closes on a spring and follows the finger. */
export function Sheet({ children, label }: { children: ComponentChildren; label: string }) {
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
      velocity = ((y - lastY) / Math.max(1, now - lastT)) * 1000; // px/s
      lastY = y;
      lastT = now;
      dy = y - startY;
      if (dy > 0) {
        el.style.transform = `translate3d(0, ${dy}px, 0)`;
        e.preventDefault();
      }
    };
    const up = () => {
      if (!tracking) return;
      tracking = false;
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
    return () => {
      spring?.stop();
      registerSheetClose(null);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
    };
  }, []);

  return (
    <div class="scrim" ref={scrim} onClick={(e) => e.target === e.currentTarget && closeSheet()}>
      <div class="sheet" ref={ref} role="dialog" aria-modal="true" aria-label={label}>
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

export function SheetHead({
  title,
  sub,
  done,
  onDone,
  doneDisabled,
}: {
  title: string;
  sub?: string;
  done?: string;
  onDone?: () => void;
  doneDisabled?: boolean;
}) {
  return (
    <div class="sheet-head">
      <button class="act" onClick={closeSheet}>
        Отмена
      </button>
      <div style={{ textAlign: "center" }}>
        <h1>{title}</h1>
        {sub && (
          <div class="s" style={{ fontSize: "12px" }}>
            {sub}
          </div>
        )}
      </div>
      {done ? (
        <button class="act end" onClick={onDone} disabled={doneDisabled} style={doneDisabled ? { opacity: 0.4 } : undefined}>
          {done}
        </button>
      ) : (
        <span style={{ width: "76px" }} />
      )}
    </div>
  );
}

export function Toast() {
  const text = toastText.value;
  return text ? (
    <div class="toast" role="status">
      {text}
    </div>
  ) : null;
}

/** Hold a button to repeat or run an alternative action (e.g. long-press = minus). */
export function useLongPress(onLong: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  return {
    onPointerDown: () => {
      fired.current = false;
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, ms);
    },
    onPointerUp: () => timer.current && clearTimeout(timer.current),
    onPointerLeave: () => timer.current && clearTimeout(timer.current),
    wasLong: () => fired.current,
  };
}
