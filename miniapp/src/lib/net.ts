/** Connection state. Until the offline queue (after v0.1.0) the app is read-only without
 * a connection: the last data stays on screen and edits are blocked with a clear message. */

import { signal } from "@preact/signals";
import { haptic } from "./haptic";
import { toast } from "./toast";

export const online = signal(typeof navigator === "undefined" ? true : navigator.onLine !== false);

if (typeof window !== "undefined") {
  window.addEventListener("online", () => (online.value = true));
  window.addEventListener("offline", () => (online.value = false));
}

export function markOnline(ok: boolean): void {
  if (online.value !== ok) online.value = ok;
}

export const OFFLINE_TEXT = "Нет связи — изменить пока нельзя";

/** Call before any edit. Returns false (and says why) when there is no connection. */
export function canEdit(): boolean {
  if (online.value) return true;
  haptic.warning();
  toast(OFFLINE_TEXT, { icon: "offline" });
  return false;
}
