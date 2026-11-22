import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/glass.css";

import { render } from "preact";
import { App } from "./App";
import { login } from "./lib/api";
import { hapticsEnabled } from "./lib/haptic";
import { syncBackButton } from "./lib/router";
import { refresh, setUserKey, watchVisibility } from "./lib/store";
import { setupTelegram, whenTelegram } from "./lib/telegram";
import { applyTheme, resolveTheme } from "./lib/theme";

// 1) Paint immediately from the local cache (theme is already applied by index.html).
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
    applyTheme(resolveTheme(me.theme));
    void refresh("/me");
  } catch {
    /* App shows its own error state */
  }
})();
