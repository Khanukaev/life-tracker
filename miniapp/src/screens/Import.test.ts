import { describe, expect, it } from "vitest";
import { parseExport } from "./Import";

describe("import: pasted text", () => {
  it("accepts the old app's export", () => {
    const r = parseExport(' {"settings": {}, "days": {}} ');
    expect(r.ok).toBe(true);
  });

  it("explains what is wrong instead of sending garbage", () => {
    expect(parseExport("")).toMatchObject({ ok: false });
    expect(parseExport("{not json")).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
    expect(parseExport("[1,2]")).toMatchObject({ ok: false, error: "Ожидается JSON-объект" });
    expect(parseExport('{"foo": 1}')).toMatchObject({ ok: false, error: expect.stringContaining("экспорт") });
  });
});
