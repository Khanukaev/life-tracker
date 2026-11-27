/** «Неделя словами» (NoteSheetEmpty / NoteSheetFilled): one text in the user's own words.
 * Claude reads it when it writes a review. The bot opens it on Sundays with `?open=note`. */

import { useEffect, useRef, useState } from "preact/hooks";
import { Sheet } from "../components/ui";
import { saveNote } from "../lib/actions";
import { addDays, parseDate } from "../lib/format";
import { closeSheet } from "../lib/router";
import { resource } from "../lib/store";
import type { Note } from "../lib/types";

const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function range(kind: "week" | "month", anchor: string): [string, string] {
  const d = parseDate(anchor);
  if (kind === "week") {
    const start = addDays(anchor, -((d.getUTCDay() + 6) % 7));
    const end = addDays(start, 6);
    const s = parseDate(start);
    const e = parseDate(end);
    const label = s.getUTCMonth() === e.getUTCMonth()
      ? `${s.getUTCDate()}–${e.getUTCDate()} ${MON[e.getUTCMonth()]}`
      : `${s.getUTCDate()} ${MON[s.getUTCMonth()]} – ${e.getUTCDate()} ${MON[e.getUTCMonth()]}`;
    return [start, label];
  }
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return [anchor.slice(0, 8) + "01", `1–${last} ${MON[d.getUTCMonth()]}`];
}

export function NoteSheet({ kind, anchor }: { kind: "week" | "month"; anchor: string }) {
  const [start, label] = range(kind, anchor);
  const e = resource<Note | null>(`/notes/${kind}?anchor=${start}`).value;
  const [text, setText] = useState<string | null>(null);
  const value = text ?? e.data?.text ?? "";
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ta.current?.focus({ preventScroll: true });
  }, []);
  const any = value.trim().length > 0;
  const changed = text !== null && text.trim() !== (e.data?.text ?? "");
  const save = async () => {
    if (!changed) return closeSheet();
    if (await saveNote(kind, start, value)) closeSheet();
  };
  const title = kind === "week" ? "Как прошла неделя?" : `Как прошёл ${MON_NOM[parseDate(start).getUTCMonth()]}?`;
  return (
    <Sheet label={kind === "week" ? "Заметка о неделе" : "Заметка о месяце"}>
      <div>
        <h2 style={{ margin: 0, fontSize: "24px", lineHeight: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h2>
        <p class="k-cap" style={{ margin: "4px 0 0", fontSize: "15px" }}>
          {label}
        </p>
      </div>
      <label for="k-note" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {kind === "week" ? "Заметка о неделе" : "Заметка о месяце"}
      </label>
      <textarea
        id="k-note"
        ref={ta}
        class="k-ta"
        maxLength={4000}
        style={{ minHeight: "220px", fontSize: "17px", lineHeight: "24px" }}
        placeholder="Например: получилось не пропустить английский. Тяжело было в среду — пары до вечера. Хочу ложиться до часа."
        value={value}
        onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)}
      />
      <button
        class="k-save"
        style={{ borderRadius: "16px", background: any || changed ? "#f5f5f7" : "rgba(255,255,255,0.10)", color: any || changed ? "#000" : "#636366" }}
        onClick={() => void save()}
      >
        Сохранить
      </button>
    </Sheet>
  );
}
