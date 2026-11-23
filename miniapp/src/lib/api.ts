/** HTTP client: Telegram initData -> short-lived JWT, transparent re-login on 401. */

import type { Me } from "./types";
import { whenTelegram } from "./telegram";

const BASE = "/api/v1";
const TOKEN_KEY = "lt:token";
const DEV_ID_KEY = "lt:devId";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  /* ignore */
}
let loggingIn: Promise<Me> | null = null;

export let currentUser: Me | null = null;

async function rawLogin(): Promise<Me> {
  const app = await whenTelegram();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let res: Response;
  if (app?.initData) {
    res = await fetch(`${BASE}/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ init_data: app.initData, timezone: tz }),
    });
  } else if (import.meta.env.DEV || import.meta.env.VITE_DEV_AUTH === "true") {
    // Browser development without Telegram (backend must run with DEV_AUTH=true).
    // Switch accounts with ?dev_user=new (a fresh user, e.g. to test onboarding) or
    // ?dev_user=900001 (back to the default one). The choice is remembered.
    const params = new URLSearchParams(location.search);
    const asked = params.get("dev_user");
    if (asked) {
      const next = asked === "new" ? String(910000 + Math.floor(Math.random() * 89999)) : asked;
      if (/^\d+$/.test(next)) localStorage.setItem(DEV_ID_KEY, next);
      // Drop only this parameter (a reload must not create another user); keep e.g. ?open=.
      params.delete("dev_user");
      const rest = params.toString();
      history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
    }
    const id = Number(localStorage.getItem(DEV_ID_KEY) ?? "900001");
    res = await fetch(`${BASE}/auth/dev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: id, first_name: "Dev", timezone: tz }),
    });
  } else {
    throw new ApiError(401, "no_telegram", "Открой приложение из Telegram");
  }
  if (!res.ok) throw new ApiError(res.status, "auth_failed", "Не удалось войти");
  const body = await res.json();
  token = body.access_token as string;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  currentUser = body.user as Me;
  return currentUser;
}

export function login(): Promise<Me> {
  if (!loggingIn) loggingIn = rawLogin().finally(() => (loggingIn = null));
  return loggingIn;
}

export function hasToken(): boolean {
  return token !== null;
}

export async function api<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  if (!token) await login();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    token = null;
    await login();
    return api<T>(method, path, body, false);
  }
  if (res.status === 204) return undefined as T;
  // Anything but JSON (e.g. an HTML page from a misconfigured proxy) is an error, never data:
  // otherwise screens would receive `{}` and crash on missing fields.
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.ok && data === null) throw new ApiError(502, "bad_response", "Сервер недоступен");
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Ошибка");
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const put = <T>(path: string, body: unknown) => api<T>("PUT", path, body);
export const del = <T>(path: string) => api<T>("DELETE", path);

/** UUIDv7 for optimistic creation: the server accepts client ids and dedupes retries. */
export function uuid7(): string {
  const ms = BigInt(Date.now());
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  const hex = (n: bigint | number, len: number) => n.toString(16).padStart(len, "0");
  const r = Array.from(rnd, (b) => hex(b, 2)).join("");
  const timeHex = hex(ms, 12);
  const variant = ((rnd[2]! & 0x3f) | 0x80).toString(16);
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${r.slice(0, 3)}-${variant}${r.slice(6, 8)}-${r.slice(8, 20)}`;
}
