/** Pill «Сегодня · План · Итоги» and a separate round «+» (TabBarGlass / TodayGlass). */

import { addedOnce } from "../lib/actions";
import { haptic } from "../lib/haptic";
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

export function TabBar({ hint }: { hint?: boolean }) {
  const active = tab.value; // nested screens belong to their tab
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
          {(Object.keys(LABELS) as Tab[]).map((t) => (
            <button key={t} aria-current={active === t ? "page" : undefined} aria-label={LABELS[t]} onClick={() => goTab(t)}>
              {ICONS[t]}
              {active === t && LABELS[t]}
            </button>
          ))}
        </nav>
        <button
          class="k-fab k-glass"
          aria-label="Добавить привычку или задачу"
          onClick={() => {
            if (!canEdit()) return;
            haptic.light();
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
