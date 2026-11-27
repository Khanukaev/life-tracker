import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/keel.css";
import "./styles/motion.css";

import { render } from "preact";
import { App } from "./App";
import { login } from "./lib/api";
import { hapticsEnabled } from "./lib/haptic";
import { deepLinkSheet, openSheet, syncBackButton } from "./lib/router";
import { entry, refresh, setUserKey, watchVisibility } from "./lib/store";
import type { DayView } from "./lib/types";
import { setupTelegram, whenTelegram } from "./lib/telegram";
import { canMotion, setMotion } from "./motion/tokens";

// One dark theme. Motion only on capable devices; the OS setting can change at any time.
// (All motion is CSS/WAAPI on transform, opacity and SVG; GSAP is not needed here.)
const motion = () => setMotion(canMotion());
motion();
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", motion);

// Invisible native pickers sit over rows (time, date, select). Safari opens them on tap;
// Chrome and Android webviews only focus the field, so open the picker explicitly.
document.addEventListener("click", (e) => {
  const el = (e.target as Element | null)?.closest?.(".k-native") as (HTMLInputElement | HTMLSelectElement) | null;
  if (!el || !("showPicker" in el)) return;
  try {
    el.showPicker();
  } catch {
    /* already open, or not allowed here: the native focus still works */
  }
});

// 1) Paint immediately from the local cache.
render(<App />, document.getElementById("app")!);

// 2) Then connect to Telegram and the backend in the background.
void (async () => {
  setupTelegram(await whenTelegram());
  syncBackButton();
  watchVisibility();
  try {
    const me = await login();
    setUserKey(me.id);
    hapticsEnabled.value = me.haptics;
    void refresh("/me");
    const link = deepLinkSheet();
    if (link) {
      await refresh("/views/day"); // the sheets need the user's logical "today"
      const today = (entry("/views/day").value.data as DayView | undefined)?.today;
      // «Как спал?» from the morning message; «Неделя словами» from the Sunday one.
      if (today) openSheet(link, link === "note" ? { kind: "week", anchor: today } : { date: today }, true);
    }
  } catch {
    /* App shows its own error state */
  }
})();
