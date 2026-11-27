/** «Когда сделать» (PlanAssignGlass): a tap on a day moves the task at once, no «Готово». */

import { Sheet } from "../components/ui";
import { assignTask, PLAN_KEY, today } from "../lib/actions";
import { addDays, parseDate } from "../lib/format";
import { closeSheet, closeSheetNow } from "../lib/router";
import { entry } from "../lib/store";
import type { PlanView, Task } from "../lib/types";

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function AssignSheet({ id, task: given }: { id: string; task?: Task }) {
  const v = entry<PlanView>(PLAN_KEY).value.data;
  const task: Task | undefined =
    (v && [...v.overdue, ...v.inbox, ...v.days.flatMap((d) => d.tasks)].find((t) => t.id === id)) || given;
  if (!task) return null;
  const t0 = today();
  const after = addDays(t0, 2);
  const days: [string, string][] = [
    [t0, "Сегодня"],
    [addDays(t0, 1), "Завтра"],
    [after, `${WD[parseDate(after).getUTCDay()]}, ${parseDate(after).getUTCDate()}`],
  ];
  const pick = (iso: string) => {
    closeSheetNow();
    void assignTask(task, iso);
  };
  return (
    <Sheet label="Когда сделать" cls="k-full k-short">
      <div class="k-formhead">
        <button style={{ color: "#aeaeb2" }} onClick={closeSheet}>
          Отмена
        </button>
        <h2>Когда сделать</h2>
        <span style={{ width: 52 }} />
      </div>
      <p style={{ margin: "0 4px", fontSize: "17px", lineHeight: "22px" }}>{task.title}</p>
      <div role="group" aria-label="День" class="k-chips">
        {days.map(([iso, label]) => (
          <button key={iso} class="k-chip" style={{ padding: "0 16px" }} aria-pressed="false" onClick={() => pick(iso)}>
            {label}
          </button>
        ))}
        <label class="k-chip" style={{ padding: "0 16px", display: "inline-flex", alignItems: "center" }}>
          Выбрать…
          <input
            class="k-native"
            type="date"
            aria-label="Выбрать день"
            min={t0}
            onChange={(e) => {
              const val = (e.target as HTMLInputElement).value;
              if (val) pick(val);
            }}
          />
        </label>
      </div>
      <p class="k-cap" style={{ margin: "0 4px" }}>
        Нажми на день — дело сразу встанет в план
      </p>
    </Sheet>
  );
}
