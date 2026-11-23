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
