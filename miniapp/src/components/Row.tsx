/** One row for every kind of item (Row.dc.html): the circle marks, the row opens details.
 * A count adds one step per tap; bedtime is a dashed circle with a moon, marked by sleep. */

import { AutoMoon, CHECK, Regular } from "./icons";

export type RowKind = "check" | "count" | "auto";

export interface RowItem {
  kind: RowKind;
  title: string;
  meta: string;
  done: boolean;
  regular?: boolean;
  alert?: boolean; // important task: red circle
  late?: boolean; // overdue: red meta
  /** bedtime only: the night decided it ("done" / "miss"), or not yet (undefined). */
  result?: "done" | "miss";
  right?: string;
}

export function Row({
  item,
  onTick,
  onOpen,
  sep,
  phase,
}: {
  item: RowItem;
  onTick?: () => void;
  onOpen: () => void;
  sep?: boolean;
  phase?: "hold" | "leave";
}) {
  const { kind, done, title } = item;
  const alert = !!item.alert && !done;
  const circleCls = `${done ? "done" : alert ? "alert" : item.result === "miss" ? "miss" : ""}`;
  const circle = (
    <span class={circleCls}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={done ? CHECK : ""} />
      </svg>
    </span>
  );
  return (
    <div class={`k-row${sep ? " sep" : ""}${phase === "leave" ? " leave" : ""}`}>
      {kind === "auto" ? (
        item.result ? (
          <span class="k-tick" role="img" aria-label={item.result === "done" ? "Выполнено по сну" : "Не выполнено по сну"}>
            {circle}
          </span>
        ) : (
          <span class="k-tick" role="img" aria-label="Отмечается само по сну" style={{ color: "#8e8e93" }}>
            <AutoMoon />
          </span>
        )
      ) : (
        <button
          class="k-btnreset k-tick"
          aria-label={`${done ? "Снять отметку" : kind === "count" ? "Плюс один" : "Отметить"}: ${title}`}
          onClick={onTick}
        >
          {circle}
        </button>
      )}
      <button class="k-btnreset k-rowbody" onClick={onOpen}>
        <span class="t" style={{ color: done ? "#8e8e93" : "#f5f5f7" }}>
          {title}
        </span>
        {(item.meta || item.regular) && (
          <span class="m" style={{ color: item.late && !done ? "#ff6961" : "#8e8e93" }}>
            {item.regular && <Regular />}
            <span>{item.meta}</span>
          </span>
        )}
      </button>
      {item.right && (
        <span
          class="k-rowright"
          style={{
            color: done ? "#8e8e93" : item.late ? "#ff453a" : item.alert ? "#f5f5f7" : "#aeaeb2",
            fontWeight: item.alert && !done ? 600 : 400,
          }}
        >
          {item.right}
        </span>
      )}
    </div>
  );
}
