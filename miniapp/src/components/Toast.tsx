/** Bottom message with «Отменить» (TodayAddedGlass / TodayDeletedGlass). */

import { toastIcon, toastText, toastUndo, undoToast } from "../lib/toast";

const ICON = {
  check: { d: "M5 12.5l4.5 4.3L19 7.5", color: "#69ff79", w: 2.4 },
  trash: { d: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3", color: "#aeaeb2", w: 2 },
  offline: { d: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.4-1.8M2 9.5a15 15 0 0 1 4.3-2.6M22 9.5A15 15 0 0 0 11 6M12 20h.01", color: "#aeaeb2", w: 1.7 },
} as const;

export function Toast() {
  const text = toastText.value;
  if (!text) return null;
  const icon = toastIcon.value ? ICON[toastIcon.value] : null;
  return (
    <div class="k-toast" role="status" key={text}>
      {icon && (
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, flex: "none", fill: "none", stroke: icon.color, strokeWidth: icon.w, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d={icon.d} />
        </svg>
      )}
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      {toastUndo.value ? <button onClick={undoToast}>Отменить</button> : <i style={{ width: 10 }} />}
    </div>
  );
}
