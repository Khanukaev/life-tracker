/** Thin typed wrapper over window.Telegram.WebApp (only what the app uses). */

type Impact = "light" | "medium" | "heavy" | "rigid" | "soft";
type Notice = "error" | "success" | "warning";

export interface TgWebApp {
  initData: string;
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  openLink?(url: string): void;
  HapticFeedback: {
    impactOccurred(s: Impact): void;
    notificationOccurred(t: Notice): void;
    selectionChanged(): void;
  };
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function tg(): TgWebApp | undefined {
  const app = window.Telegram?.WebApp;
  return app && app.initData !== undefined ? app : undefined;
}

/** The Telegram script loads async; resolve once it's there (or give up quickly). */
export function whenTelegram(timeoutMs = 2500): Promise<TgWebApp | undefined> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const app = tg();
      if (app || Date.now() - started > timeoutMs) resolve(app);
      else setTimeout(tick, 25);
    };
    tick();
  });
}

export function setupTelegram(app: TgWebApp | undefined): void {
  if (!app) return;
  app.ready();
  app.expand();
  const at = (v: string) => app.isVersionAtLeast?.(v);
  // System chrome follows the app's own dark background.
  if (at("6.1")) {
    app.setHeaderColor("#000000");
    app.setBackgroundColor("#000000");
  }
  if (at("7.10")) app.setBottomBarColor?.("#000000");
  // Our sheets close with a swipe down; don't let that swipe close the Mini App.
  if (at("7.7")) app.disableVerticalSwipes?.();
}

let backHandler: (() => void) | null = null;

/** Show the native Back button with a handler, or hide it with `null`. */
export function setBackButton(handler: (() => void) | null): void {
  const app = tg();
  if (!app?.isVersionAtLeast?.("6.1")) return;
  if (backHandler) app.BackButton.offClick(backHandler);
  backHandler = handler;
  if (handler) {
    app.BackButton.onClick(handler);
    app.BackButton.show();
  } else {
    app.BackButton.hide();
  }
}

/** External links leave the Mini App through Telegram (in-app browser), else a new tab. */
export function openLink(url: string): void {
  const app = tg();
  if (app?.openLink) app.openLink(url);
  else window.open(url, "_blank", "noopener");
}
