import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetStore, mutate, resource, setData } from "./store";
import { toastText } from "./toast";

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => handler(url, init)));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  _resetStore();
  localStorage.clear();
  toastText.value = null;
});

describe("optimistic UI", () => {
  it("shows cached data instantly, then refreshes from the server", async () => {
    localStorage.setItem("lt:c:anon:/views/now", JSON.stringify({ idx: 50 }));
    mockFetch((url) => (url.includes("/auth/") ? json({ access_token: "t", user: { id: "u" } }) : json({ idx: 77 })));
    const r = resource<{ idx: number }>("/views/now");
    expect(r.value.data?.idx).toBe(50); // from cache, before any network
    await vi.waitFor(() => expect(r.value.data?.idx).toBe(77), { timeout: 5000 });
  });

  it("applies a change immediately and rolls it back when the server fails", async () => {
    localStorage.setItem("lt:c:anon:/views/day", JSON.stringify({ water: 2 }));
    mockFetch(() => json({ error: { code: "conflict", message: "nope" } }, 409));
    const r = resource<{ water: number }>("/views/day");
    const p = mutate({
      apply: () => setData<{ water: number }>("/views/day", (d) => ({ ...d, water: d.water + 1 })),
      request: async () => {
        expect(r.value.data?.water).toBe(3); // already visible before the response
        throw new Error("network down");
      },
    });
    await p;
    expect(r.value.data?.water).toBe(2); // rolled back
    expect(toastText.value).toBe("Не сохранилось. Проверь связь");
  });
});
