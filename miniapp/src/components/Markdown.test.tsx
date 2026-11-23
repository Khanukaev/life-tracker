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
