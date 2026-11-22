import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/glass.css";
import "./styles/motion.css";

import { render } from "preact";
import { App } from "./App";
import { login } from "./lib/api";
import { hapticsEnabled } from "./lib/haptic";
import { syncBackButton } from "./lib/router";
import { refresh, setUserKey, watchVisibility } from "./lib/store";
import { setupTelegram, whenTelegram } from "./lib/telegram";
import { applyTheme, canGlass, resolveTheme, theme } from "./lib/theme";
import { reducedMotion, setMotion } from "./motion/tokens";

// 1) Paint immediately from the local cache (theme is already applied by index.html).
applyTheme(theme.value);
render(<App />, document.getElementById("app")!);
// The OS setting can change while the app is open: switch motion off instantly.
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () =>
  setMotion(!reducedMotion() && theme.value === "glass" && canGlass()),
);

// 2) Then connect to Telegram and the backend in the background.
void (async () => {
  setupTelegram(await whenTelegram());
  syncBackButton();
  watchVisibility();
  try {
    const me = await login();
    setUserKey(me.id);
    hapticsEnabled.value = me.haptics;
    applyTheme(resolveTheme(me.theme));
    void refresh("/me");
  } catch {
    /* App shows its own error state */
  }
})();
