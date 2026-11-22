/** Motion is allowed only in Liquid Glass, on capable devices, without reduced-motion. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "../lib/theme";
import { motionOk } from "./tokens";

function env({ reduced = false, blur = true, memory = 8 } = {}) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduced && q.includes("reduce"),
    addEventListener: () => {},
  }));
  vi.stubGlobal("CSS", { supports: () => blur });
  Object.defineProperty(navigator, "deviceMemory", { value: memory, configurable: true });
  Object.defineProperty(navigator, "hardwareConcurrency", { value: 8, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("motion gating", () => {
  it("is on in Glass on a capable device", () => {
    env();
    applyTheme("glass");
    expect(motionOk.value).toBe(true);
    expect(document.documentElement.classList.contains("motion-ok")).toBe(true);
  });

  it("is off in the base theme", () => {
    env();
    applyTheme("base");
    expect(motionOk.value).toBe(false);
    expect(document.documentElement.className).toBe("theme-base");
  });

  it("is off when the user prefers reduced motion", () => {
    env({ reduced: true });
    applyTheme("glass");
    expect(motionOk.value).toBe(false);
  });

  it("is off on weak devices", () => {
    env({ memory: 2 });
    applyTheme("glass");
    expect(motionOk.value).toBe(false);
  });
});
