/** Motion is allowed only on capable devices without reduced-motion. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { canMotion, motionOk, setMotion } from "./tokens";

function env({ reduced = false, memory = 8 } = {}) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduced && q.includes("reduce"), addEventListener: () => {} }));
  Object.defineProperty(navigator, "deviceMemory", { value: memory, configurable: true });
  Object.defineProperty(navigator, "hardwareConcurrency", { value: 8, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("motion gating", () => {
  it("is on on a capable device", () => {
    env();
    setMotion(canMotion());
    expect(motionOk.value).toBe(true);
    expect(document.documentElement.classList.contains("motion-ok")).toBe(true);
  });

  it("is off when the user prefers reduced motion", () => {
    env({ reduced: true });
    expect(canMotion()).toBe(false);
  });

  it("is off on weak devices", () => {
    env({ memory: 2 });
    expect(canMotion()).toBe(false);
  });
});
