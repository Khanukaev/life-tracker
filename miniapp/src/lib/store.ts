/** Stale-while-revalidate cache + optimistic mutations.
 *
 * Every screen payload is a "resource" keyed by its API path. On open we show the last
 * cached copy instantly (localStorage), then quietly refresh from the server. Actions
 * change the cached data first (optimistic UI) and roll back on error.
 */

import { signal, type Signal } from "@preact/signals";
import { ApiError, get } from "./api";
import { haptic } from "./haptic";
import { canEdit } from "./net";
import { toast } from "./toast";

export interface Entry<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  at: number;
}

const PREFIX = "lt:c:";
const entries = new Map<string, Signal<Entry<unknown>>>();
const inflight = new Map<string, Promise<void>>();
let userKey = "anon";
try {
  userKey = localStorage.getItem("lt:uid") ?? "anon";
} catch {
  /* ignore */
}

/** Cache is per account (two Telegram accounts on one phone must not mix).
 *
 * Screens stay subscribed to the same signals, so on a switch we refill them in place
 * instead of dropping them. Before the first login the key is "anon": nothing is read
 * from or written to storage then, and whatever is in memory was fetched after login
 * (every request waits for it), so it belongs to this user and is kept. */
export function setUserKey(id: string): void {
  if (userKey === id) return;
  const fromAnon = userKey === "anon";
  userKey = id;
  try {
    localStorage.setItem("lt:uid", id);
  } catch {
    /* ignore */
  }
  for (const [key, e] of entries) {
    if (fromAnon && e.value.data !== undefined) writeCache(key, e.value.data);
    else e.value = { data: readCache(key), loading: false, error: null, at: 0 };
  }
}

function storageKey(key: string) {
  return `${PREFIX}${userKey}:${key}`;
}

function readCache<T>(key: string): T | undefined {
  if (userKey === "anon") return undefined;
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, data: unknown) {
  if (userKey === "anon") return; // unknown account: never persist
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(data));
  } catch {
    /* quota: the cache is an optimisation, not a requirement */
  }
}

export function entry<T>(key: string): Signal<Entry<T>> {
  let e = entries.get(key) as Signal<Entry<T>> | undefined;
  if (!e) {
    const cached = readCache<T>(key);
    e = signal<Entry<T>>({ data: cached, loading: false, error: null, at: 0 });
    entries.set(key, e as Signal<Entry<unknown>>);
  }
  return e;
}

/** Fetch now (deduplicated), keep showing the old data meanwhile. */
export function refresh(key: string): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const e = entry(key);
  e.value = { ...e.value, loading: true };
  const p = get<unknown>(key)
    .then((data) => {
      e.value = { data, loading: false, error: null, at: Date.now() };
      writeCache(key, data);
    })
    .catch((err: unknown) => {
      e.value = { ...e.value, loading: false, error: err instanceof Error ? err.message : "Ошибка" };
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const STALE_MS = 15_000;

/** Subscribe to a resource: cached data immediately, refresh in the background if stale. */
export function resource<T>(key: string): Signal<Entry<T>> {
  const e = entry<T>(key);
  if (Date.now() - e.value.at > STALE_MS) void refresh(key);
  return e;
}

/** Warm the cache for screens the user is likely to open next. */
export function prefetch(key: string): void {
  if (Date.now() - entry(key).value.at > STALE_MS) void refresh(key);
}

/** Change cached data in place (optimistic). Returns a rollback function. */
export function setData<T>(key: string, update: (d: T) => T): () => void {
  const e = entry<T>(key);
  const before = e.value.data;
  if (before === undefined) return () => {};
  const after = update(structuredClone(before));
  e.value = { ...e.value, data: after };
  writeCache(key, after);
  return () => {
    e.value = { ...e.value, data: before };
    writeCache(key, before);
  };
}

/** Keys of every resource in memory that start with the prefix (e.g. all cached days). */
export function keysWith(prefix: string): string[] {
  return [...entries.keys()].filter((k) => k.startsWith(prefix));
}

/** Refresh every cached resource whose key starts with one of the prefixes. */
export function invalidate(...prefixes: string[]): void {
  for (const key of entries.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) {
      entries.get(key)!.value = { ...entries.get(key)!.value, at: 0 };
      void refresh(key);
    }
  }
}

let pendingInvalidate = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced invalidation: several quick taps cause one quiet refresh. */
export function invalidateSoon(...prefixes: string[]): void {
  prefixes.forEach((p) => pendingInvalidate.add(p));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const list = [...pendingInvalidate];
    pendingInvalidate = new Set();
    invalidate(...list);
  }, 700);
}

/**
 * Optimistic action: `apply` changes the UI right away and returns rollbacks;
 * `request` goes to the server in the background. On failure everything rolls back
 * and a short toast + error vibration tell the user.
 */
export async function mutate<R>(opts: {
  apply?: () => (() => void) | (() => void)[] | void;
  request: () => Promise<R>;
  refresh?: string[];
  errorText?: string;
}): Promise<R | undefined> {
  if (!canEdit()) return undefined;
  const rb = opts.apply?.();
  const rollbacks = Array.isArray(rb) ? rb : rb ? [rb] : [];
  try {
    const res = await opts.request();
    if (opts.refresh?.length) invalidateSoon(...opts.refresh);
    return res;
  } catch (err) {
    rollbacks.reverse().forEach((f) => f());
    haptic.error();
    const msg =
      err instanceof ApiError && err.status === 0 ? "Нет связи — изменение не сохранилось"
      : err instanceof ApiError && err.status === 422 ? err.message
      : opts.errorText;
    toast(msg ?? "Не сохранилось. Проверь связь");
    return undefined;
  }
}

/** Testing helper. */
export function _resetStore(): void {
  userKey = "anon";
  entries.clear();
  inflight.clear();
}

/** Refresh visible data when the app comes back to the foreground. */
export function watchVisibility(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      for (const [key, e] of entries) {
        if (Date.now() - e.value.at > STALE_MS) void refresh(key);
      }
    }
  });
}
