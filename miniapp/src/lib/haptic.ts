/** One wrapper for all vibration feedback, so calls are uniform and can be turned off. */

import { signal } from "@preact/signals";
import { tg } from "./telegram";

export const hapticsEnabled = signal(true);

function feedback() {
  if (!hapticsEnabled.value) return undefined;
  const app = tg();
  return app?.isVersionAtLeast?.("6.1") ? app.HapticFeedback : undefined;
}

export const haptic = {
  /** Taps on buttons, +/− of water and minutes, tabs. */
  light: () => feedback()?.impactOccurred("light"),
  /** Chips, segments, switches, sleep dial handles (every 15 minutes). */
  selection: () => feedback()?.selectionChanged(),
  /** Habit or task done, day closed at 100%, goal reached. */
  success: () => feedback()?.notificationOccurred("success"),
  /** Soft warnings ("когда всё важно — ничего не важно"). */
  warning: () => feedback()?.notificationOccurred("warning"),
  /** Saving failed. */
  error: () => feedback()?.notificationOccurred("error"),
};
