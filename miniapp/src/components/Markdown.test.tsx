import { render } from "preact";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

function html(text: string): HTMLElement {
  const root = document.createElement("div");
  render(<Markdown text={text} />, root);
  return root;
}

describe("review markdown", () => {
  it("renders paragraphs, lists and bold", () => {
    const el = html("**Итог.** Хорошо\n- раз\n- два\n\n1. три");
    expect(el.querySelector("b")?.textContent).toBe("Итог.");
    expect([...el.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["раз", "два", "три"]);
  });

  it("never turns review text into markup", () => {
    const el = html('<img src=x onerror="alert(1)"> **<script>x</script>**');
    expect(el.querySelector("img, script")).toBeNull();
    expect(el.textContent).toContain("<img src=x");
  });
});

describe("review summary", () => {
  it("takes the first plain paragraph and leaves lists and headings as blocks", async () => {
    const { splitSummary } = await import("./Markdown");
    const [head, rest] = splitSummary("Итог дня. **Сон** в норме.\n- Отчёт: не начат\n- Вода: 8\n\n## Что сделать\nЛечь до 00:30");
    expect(head).toBe("Итог дня. Сон в норме.");
    expect(rest).toContain("- Отчёт: не начат");
    expect(rest).toContain("## Что сделать");
  });
});
