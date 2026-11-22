import { useState } from "preact/hooks";
import { Empty, Icon, StackHead } from "../components/ui";
import { shortDate } from "../lib/format";
import { openSheet } from "../lib/router";
import { resource } from "../lib/store";
import type { GoalCard, GoalsView } from "../lib/types";

const KIND: Record<GoalCard["kind"], string> = { subtasks: "Шаги", streak: "Серия", count: "Дней из N", manual: "Вручную" };

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return shortDate(iso.slice(0, 10));
}

export function GoalsScreen() {
  const d = resource<GoalsView>("/views/goals").value.data;
  const [showArchive, setShowArchive] = useState(false);
  return (
    <div class="page">
      <StackHead
        back="Профиль"
        title="Цели"
        action={
          <button class="ib" aria-label="Новая цель" onClick={() => openSheet("goal", {})}>
            <Icon name="plus" />
          </button>
        }
      />
      <main class="main" style={{ paddingTop: "20px" }}>
        {!d ? (
          <div class="card skel" style={{ height: "240px" }} />
        ) : (
          <>
            <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div class="sec">
                <span>База — сейчас</span>
                <span>до 3 целей</span>
              </div>
              {d.base.length === 0 && <Empty text="Целей пока нет. Начни с одной — той, что важнее всего сейчас." action="Создать цель" onAction={() => openSheet("goal", {})} />}
              {d.base.map((g) => (
                <GoalArticle key={g.id} g={g} />
              ))}
              {d.base.length > 3 && (
                <div class="s" style={{ display: "flex", gap: "8px", margin: "2px 4px 0", color: "var(--soft)" }}>
                  <Icon name="warn" size={16} />
                  Целей в базе больше трёх. Когда всё важно — ничего не важно: часть лучше перенести в «Следующий этап».
                </div>
              )}
            </section>

            {d.next.length > 0 && (
              <section>
                <div class="sec">
                  <span>Следующий этап</span>
                </div>
                <div class="card list">
                  {d.next.map((g) => (
                    <button class="row plain" key={g.id} onClick={() => openSheet("goal", { id: g.id })}>
                      <span class="col-text">
                        <span class="t" style={{ color: "var(--soft)" }}>{g.title}</span>
                        <span class="s">
                          {KIND[g.kind]}
                          {g.sphere_name ? ` · ${g.sphere_name}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <div class="s" style={{ margin: "10px 4px 0" }}>
                  {d.base_holds ? "База держится 14 дней выше 70% — можно подключать следующий этап." : "Подключай, когда база продержится 14 дней выше 70%."}
                </div>
              </section>
            )}

            {(d.history.length > 0 || d.archived.length > 0) && (
              <section>
                {d.history.length > 0 && (
                  <>
                    <div class="sec">
                      <span>История изменений</span>
                    </div>
                    <div class="card list">
                      {d.history.map((h, i) => (
                        <button class="row plain" key={i} style={{ alignItems: "flex-start" }} onClick={() => openSheet("goal", { id: h.goal_id })}>
                          <span class="tag" style={{ marginTop: "1px" }}>{h.by === "claude" ? "Claude" : "Ты"}</span>
                          <span class="col-text">
                            <span class="t" style={{ fontSize: "15px" }}>
                              «{h.goal_title}»: {h.what}
                            </span>
                            <span class="s">{timeAgo(h.at)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {d.archived.length > 0 && (
                  <>
                    <button class="card row plain" style={{ marginTop: "8px" }} onClick={() => setShowArchive(!showArchive)}>
                      <span class="t" style={{ flex: 1 }}>Архив</span>
                      <span class="s mono">{d.archived.length}</span>
                      <Icon name={showArchive ? "down" : "right"} size={16} style={{ color: "var(--dim)" }} />
                    </button>
                    {showArchive && (
                      <div class="card list" style={{ marginTop: "8px" }}>
                        {d.archived.map((g) => (
                          <button class="row plain" key={g.id} onClick={() => openSheet("goal", { id: g.id })}>
                            <span class="t" style={{ flex: 1, color: "var(--muted)" }}>{g.title}</span>
                            <span class="mono s">{g.progress.pct}%</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function GoalArticle({ g }: { g: GoalCard }) {
  const cur = g.progress.cur ?? 0;
  const t = g.progress.t ?? 1;
  return (
    <button class="card plain goal" onClick={() => openSheet("goal", { id: g.id })}>
      <div class="gh">
        <div>
          <div class="gt">{g.title}</div>
          {g.criterion && <div class="s" style={{ marginTop: "3px" }}>{g.criterion}</div>}
        </div>
        <span class="mono" style={{ fontSize: "22px", color: g.overdue ? "var(--accent-text)" : undefined }}>{g.progress.pct}%</span>
      </div>

      {(g.kind === "subtasks" || g.kind === "manual") && (
        <div class="bar" style={{ marginTop: "14px" }}>
          <i style={{ width: `${g.progress.pct}%` }} />
        </div>
      )}
      {g.kind === "subtasks" && g.steps.length > 0 && (
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {g.steps.slice(0, 3).map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span class={`chk sm${s.done ? " on" : ""}`} style={!s.done && s.overdue ? { borderColor: "var(--accent)" } : undefined}>
                {s.done && <Icon name="check" />}
              </span>
              <span class="t" style={{ flex: 1, fontSize: "15px", color: s.done ? "var(--muted)" : undefined }}>{s.title}</span>
              {s.deadline && (
                <span class="mono" style={{ fontSize: "12px", color: s.overdue ? "var(--accent-text)" : "var(--muted)" }}>{shortDate(s.deadline)}</span>
              )}
            </div>
          ))}
          {g.steps.length > 3 && (
            <div class="s" style={{ paddingLeft: "32px" }}>
              + ещё {g.steps.length - 3} {g.steps.length - 3 === 1 ? "шаг" : g.steps.length - 3 < 5 ? "шага" : "шагов"}
            </div>
          )}
        </div>
      )}
      {g.kind === "streak" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(t, 31)}, minmax(0, 1fr))`, gap: "3px", marginTop: "14px" }} role="img" aria-label={`${cur} из ${t} дней подряд`}>
          {Array.from({ length: Math.min(t, 31) }, (_, i) => (
            <span key={i} style={{ height: "16px", borderRadius: "4px", background: i < cur ? "var(--accent)" : "var(--fill)" }} />
          ))}
        </div>
      )}
      {g.kind === "count" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cells.length}, minmax(0, 1fr))`, gap: "6px", marginTop: "14px" }}>
          {g.cells.map((c, i) => (
            <div key={c.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "100%", height: "28px", borderRadius: "8px",
                  background: c.ok === "ok" ? "var(--accent)" : "transparent",
                  boxShadow: c.ok === "ok" ? "none" : `inset 0 0 0 1px ${i === g.cells.length - 1 ? "var(--faint)" : "var(--fill-2)"}`,
                }}
              />
              {g.cells.length <= 10 && <span style={{ fontSize: "11px", color: "var(--muted)" }}>{["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][new Date(c.date).getUTCDay()]}</span>}
            </div>
          ))}
        </div>
      )}

      <div class="meta">
        {g.overdue_steps > 0 && <span class="tag crit">{g.overdue_steps} {g.overdue_steps === 1 ? "шаг просрочен" : "шага просрочено"}</span>}
        {g.overdue && <span class="tag crit">просрочена</span>}
        {g.kind === "streak" && <span class="tag">Серия {cur} из {t}</span>}
        {g.kind === "count" && <span class="tag">{g.progress.label}</span>}
        {g.sphere_name && <span class="tag">{g.sphere_name}</span>}
        <span class="s mono" style={{ fontSize: "12px", marginLeft: "auto" }}>{g.deadline ? `до ${shortDate(g.deadline)}` : "без срока"}</span>
      </div>
    </button>
  );
}
