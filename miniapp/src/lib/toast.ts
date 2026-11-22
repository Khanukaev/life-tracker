import { signal } from "@preact/signals";

export const toastText = signal<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, ms = 2400): void {
  toastText.value = text;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (toastText.value = null), ms);
}
