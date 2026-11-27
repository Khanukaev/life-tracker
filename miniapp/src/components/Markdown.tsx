/** Tiny, safe Markdown for Claude's reviews: paragraphs, "-"/"•"/"1." lists, **bold**,
 * "#" headings. Builds JSX nodes — never innerHTML — so review text can't inject markup. */

import type { ComponentChildren } from "preact";

function inline(text: string): ComponentChildren[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part,
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ComponentChildren[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul class="md-list" key={blocks.length}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const item = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      list.push(item[1]!);
      continue;
    }
    flush();
    if (!line) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      h ? (
        <p class="md-h" key={blocks.length}>{inline(h[1]!)}</p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();
  return <div class="md">{blocks}</div>;
}

/** A review's first plain paragraph is its summary; the rest (headings, lists) are blocks. */
export function splitSummary(text: string): [string, string] {
  const lines = text.trim().split("\n");
  const isItem = (l: string) => /^\s*(?:[-•*]|\d+[.)])\s+/.test(l);
  const start = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#") && !isItem(l));
  if (start < 0) return ["", text.trim()];
  let end = start;
  while (end + 1 < lines.length && lines[end + 1]!.trim() && !isItem(lines[end + 1]!) && !lines[end + 1]!.trim().startsWith("#")) end++;
  const head = lines.slice(start, end + 1).join(" ").replace(/\*\*/g, "").trim();
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n").trim();
  return [head, rest];
}
