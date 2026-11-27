/** Pill «Сегодня · План · Итоги» and a separate round «+» (TabBarGlass / TodayGlass). */

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { addedOnce } from "../lib/actions";
import { canEdit } from "../lib/net";
import { goTab, openSheet, tab, type Tab } from "../lib/router";

const ICONS: Record<Tab, preact.JSX.Element> = {
  today: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.4 2.3 4.6-4.8" />
    </svg>
  ),
  plan: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" />
    </svg>
  ),
  results: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 20v-6M12 20V5M19 20v-10" />
    </svg>
  ),
};
const LABELS: Record<Tab, string> = { today: "Сегодня", plan: "План", results: "Итоги" };

const ICON_X = 13.5; // icon centred in the 48 px circle
const ICON_W = 21;
const GAP = 8;
const PAD_R = 20;

/** Label widths, measured once (and again when the font arrives), so the active tab gets an
 * exact pixel width and the switch is a smooth width + colour transition. */
function useLabelWidths(): [preact.RefObject<HTMLSpanElement | null>, Record<string, number>] {
  const ref = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const measure = () => {
      const out: Record<string, number> = {};
      ref.current?.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => (out[el.dataset.t!] = el.offsetWidth));
      setW(out);
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, []);
  return [ref, w];
}

export function TabBar({ hint }: { hint?: boolean }) {
  const active = tab.value; // nested screens belong to their tab
  const [measureRef, widths] = useLabelWidths();
  return (
    <>
      {hint && !addedOnce.value && (
        <div class="k-hint" role="note">
          <i aria-hidden="true" />
          <b style={{ display: "block", fontSize: "16px", marginBottom: "4px" }}>Добавь первое дело</b>
          <span style={{ fontSize: "15px", lineHeight: "20px" }}>Нажми «+», чтобы добавить привычку или задачу.</span>
        </div>
      )}
      <div class="k-tabbar">
        <nav class="k-nav k-glass" aria-label="Разделы">
          <span ref={measureRef} class="k-measure" aria-hidden="true">
            {(Object.keys(LABELS) as Tab[]).map((t) => (
              <span key={t} data-t={t}>
                {LABELS[t]}
              </span>
            ))}
          </span>
          {(Object.keys(LABELS) as Tab[]).map((t) => {
            const on = active === t;
            const lw = widths[t] ?? LABELS[t].length * 9;
            return (
              <button
                key={t}
                aria-current={on ? "page" : undefined}
                aria-label={LABELS[t]}
                style={{ width: on ? `${ICON_X + ICON_W + GAP + lw + PAD_R}px` : "48px" }}
                onClick={() => goTab(t)}
              >
                {ICONS[t]}
                <span class="lbl">{LABELS[t]}</span>
              </button>
            );
          })}
        </nav>
        <button
          class="k-fab k-glass"
          aria-label="Добавить привычку или задачу"
          onClick={() => {
            if (!canEdit()) return;
            openSheet("add", {});
          }}
        >
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 22, height: 22, strokeWidth: 2.2 }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </button>
      </div>
    </>
  );
}
