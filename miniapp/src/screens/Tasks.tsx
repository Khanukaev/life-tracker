import { useState } from "preact/hooks";
import { Check, Empty, Icon, StackHead } from "../components/ui";
import { patch, post } from "../lib/api";
import { TASK_VIEWS, toggleTask } from "../lib/actions";
import { dur, hhmm, relDay, toMin, ZONE_NAME } from "../lib/format";
import { haptic } from "../lib/haptic";
import { openSheet } from "../lib/router";
import { mutate, resource } from "../lib/store";
import { toast } from "../lib/toast";
import type { ListTask, TasksView } from "../lib/types";

type View = (typeof TASK_VIEWS)[number];
const TABS: [View, string][] = [
  ["inbox", "Входящие"],
  ["today", "Сегодня"],
  ["overdue", "Просрочено"],
  ["upcoming", "2 недели"],
  ["done", "Выполнено"],
  ["energy", "По энергии"],
];
const EMPTY: Record<View, string> = {
  inbox: "Входящие пусты. Сюда падают задачи без даты.",
  today: "На сегодня задач нет.",
  overdue: "Просрочки нет. Так держать.",
  upcoming: "На ближайшие 2 недели ничего.",
  done: "Пока ничего не закрыто.",
  energy: "Незакрытых задач на сегодня нет.",
};
const RANK = { critical: 0, important: 1, normal: 2 } as const;

function meta(t: ListTask, today: string): string {
  const parts: string[] = [];
  if (!t.date) parts.push("Входящие");
  else if (t.start_time) {
    const s = toMin(t.start_time)!;
    parts.push(`${t.date === today ? "" : `${relDay(t.date, today)} · `}${t.start_time}–${hhmm(s + t.duration_min)}`);
  } else parts.push(t.date === today ? "Без времени" : relDay(t.date, today));
  parts.push(dur(t.duration_min));
  parts.push(ZONE_NAME[t.energy] ?? "");
  return parts.join(" · ");
}

export function TasksScreen({ initial }: { initial?: string }) {
  const [view, setView] = useState<View>((TABS.find(([v]) => v === initial)?.[0] ?? "today") as View);
  const key = `/views/tasks?view=${view}`;
  const d = resource<TasksView>(key).value.data;
  const today = new Date().toISOString().slice(0, 10);
  const counts = d?.counts;
  const items = d ? [...d.items].sort((a, b) => Number(a.done) - Number(b.done) || (view === "upcoming" || view === "done" ? 0 : RANK[a.importance] - RANK[b.importance])) : [];

  const moveOverdue = () => {
    haptic.light();
    void mutate({ request: () => post<{ moved: number }>("/tasks/move-overdue"), refresh: ["/views"] }).then((r) => r && toast(`Перенесено: ${r.moved}. Раскидай по слотам`));
  };
  const placeSlot = (t: ListTask) => {
    if (!t.slot) return;
    haptic.light();
    void mutate({
      request: () => patch(`/tasks/${t.id}`, { date: t.slot!.date, start_time: hhmm(t.slot!.start) }),
      refresh: ["/views"],
    }).then((r) => r && toast(`Поставил на ${hhmm(t.slot!.start)}`));
  };
  const criticalAfterMove = (d?.critical_today ?? 0) + (d?.counts.overdue_critical ?? 0);

  return (
    <div class="page">
      <StackHead
        back="Профиль"
        title="Задачи"
        action={
          <button class="ib" aria-label="Новая задача" onClick={() => openSheet("task", { inbox: view === "inbox" })}>
            <Icon name="plus" />
          </button>
        }
      />
      <nav aria-label="Фильтр задач" class="chips scroll" style={{ padding: "16px 16px 4px", margin: 0 }}>
        {TABS.map(([v, label]) => {
          const n = v === "energy" || !counts ? null : counts[v];
          return (
            <button key={v} class={`chip${view === v ? " on" : ""}`} onClick={() => { haptic.selection(); setView(v); }}>
              {label}
              {n != null && <span class="n">{n}</span>}
            </button>
          );
        })}
      </nav>
      <main class="main tight">
        {view === "overdue" && items.length > 0 && (
          <div class="card" style={{ padding: "14px 16px", marginBottom: "8px" }}>
            <button class="btn tint lg" style={{ height: "44px" }} onClick={moveOverdue}>
              Перенести всё просроченное на сегодня
            </button>
            {criticalAfterMove >= 3 && (
              <div class="s" style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginTop: "12px" }}>
                <Icon name="warn" size={16} />
                <span>
                  После переноса критичных на сегодня станет {criticalAfterMove}
                  {criticalAfterMove > 3 ? " — это слишком много" : " — это предел"}. Когда всё важно — ничего не важно.
                </span>
              </div>
            )}
          </div>
        )}
        {view === "energy" && d && d.loads.length > 0 && <EnergyLoads d={d} />}
        {!d ? (
          <div class="card skel" style={{ height: "160px" }} />
        ) : items.length === 0 ? (
          <Empty text={EMPTY[view]} action="Создать задачу" onAction={() => openSheet("task", { inbox: view === "inbox" })} />
        ) : (
          items.map((t) => (
            <div key={t.id} data-task={t.id} class={`tc${t.importance === "critical" && !t.done ? " crit" : ""}`}>
              <Check
                on={t.done}
                variant={t.done ? "done" : t.importance === "critical" ? "crit" : t.importance === "important" ? "imp" : ""}
                label={`${t.done ? "Выполнено" : "Выполнить"}: ${t.title}`}
                onClick={() => toggleTask(t, ["/views/day"])}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <button class="plain t" style={{ display: "block", color: t.done ? "var(--muted)" : t.importance === "normal" ? "var(--soft)" : "var(--text)" }} onClick={() => openSheet("task", { id: t.id })}>
                  {t.title}
                </button>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "5px", alignItems: "center" }}>
                  {t.importance === "critical" && !t.done && <span class="tag crit">Критичная</span>}
                  {t.importance === "important" && !t.done && <span class="tag">Важная</span>}
                  {t.created_by === "claude" && (
                    <span class="tag">
                      <Icon name="spark" size={12} />
                      от Claude
                    </span>
                  )}
                  {t.overdue && !t.done && view !== "overdue" && <span class="tag crit">просрочена</span>}
                  <span class="s mono" style={{ fontSize: "12px" }}>{meta(t, today)}</span>
                </div>
                {t.low_energy && (
                  <div class="s" style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", color: "var(--soft)" }}>
                    <Icon name="warn" size={14} />
                    Низкая энергия для Focus в это время
                  </div>
                )}
                {t.slot && (
                  <div class="slot">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div class="s" style={{ fontSize: "12px" }}>Лучший слот</div>
                      <div class="mono" style={{ fontSize: "13px", color: "var(--text)", marginTop: "2px" }}>
                        {relDay(t.slot.date, today)} {hhmm(t.slot.start)}–{hhmm(t.slot.end)} · {ZONE_NAME[t.slot.zone ?? "steady"]} · ~{t.slot.avg}
                      </div>
                    </div>
                    <button class="btn tint" onClick={() => placeSlot(t)}>Поставить</button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}

function EnergyLoads({ d }: { d: TasksView }) {
  const fill = { focus: "var(--accent)", steady: "var(--text)", recharge: "var(--muted)" };
  const max = Math.max(...d.loads.map((z) => Math.max(z.need_min, z.free_min)), 1);
  return (
    <>
      <div class="sec">
        <span>Задачи против окон на сегодня</span>
        <span>часы</span>
      </div>
      <div class="card" style={{ padding: "4px 16px", marginBottom: "12px" }}>
        {d.loads.map((z, i) => {
          const over = z.need_min - z.free_min;
          return (
            <div key={z.zone} style={{ padding: "14px 0", borderBottom: i < d.loads.length - 1 ? "1px solid var(--line)" : "0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span class="t" style={{ fontWeight: 500 }}>{ZONE_NAME[z.zone]}</span>
                <span class="mono" style={{ fontSize: "14px" }}>
                  {(z.need_min / 60).toFixed(1).replace(".", ",")} ч <span style={{ color: "var(--muted)" }}>/ {(z.free_min / 60).toFixed(1).replace(".", ",")} ч окон</span>
                </span>
              </div>
              <div class="bar thick" style={{ marginTop: "10px" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(z.free_min / max) * 100}%`, background: "var(--fill-2)", borderRadius: "3px" }} />
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(z.need_min / max) * 100}%`, background: fill[z.zone], borderRadius: "3px" }} />
              </div>
              <div class="s" style={{ marginTop: "8px" }}>
                {over > 0 ? `Не влезает ${dur(over)}: перенеси часть на завтра.` : z.zone === "recharge" ? "Отдых — тоже план." : `Запас ${dur(-over)}.`}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
