import { Empty, Icon, Sec } from "../components/ui";
import { post } from "../lib/api";
import { haptic } from "../lib/haptic";
import { openSheet, push } from "../lib/router";
import { mutate, resource } from "../lib/store";
import { toast } from "../lib/toast";
import type { GoalCard, Me, ProfileView } from "../lib/types";
import { shortDate } from "../lib/format";

export function goalMeta(g: GoalCard): string {
  const parts: string[] = [];
  if (g.kind === "subtasks") parts.push(`Шаги ${g.progress.cur ?? 0} из ${g.progress.t ?? 0}`);
  else parts.push(g.progress.label);
  if (g.deadline) parts.push(`до ${shortDate(g.deadline)}`);
  if (g.sphere_name) parts.push(g.sphere_name);
  return parts.join(" · ");
}

function habitMeta(h: ProfileView["habits"][number]): string {
  if (!h.active) return "выключена";
  const kind = h.type === "water" ? "Счётчик" : h.type === "minutes" ? "Минуты" : h.type === "dual" ? "Две отметки" : h.type === "bedtime" ? "Из сна" : h.schedule_label;
  return h.streak > 1 ? `${kind} · серия ${h.streak}` : kind;
}

export function ProfileScreen() {
  const me = resource<Me>("/me").value.data;
  const d = resource<ProfileView>("/views/profile").value.data;
  const active = d?.habits.filter((h) => h.active) ?? [];
  const rest = (d?.habits.length ?? 0) - Math.min(3, active.length);

  return (
    <div class="page">
      <header class="head head-end">
        <h1 class="h1">Профиль</h1>
        <button class="ib" aria-label="Настройки" onClick={() => push("settings")}>
          <Icon name="gear" />
        </button>
      </header>
      <main class="main" style={{ paddingTop: "20px" }}>
        <section class="card" style={{ padding: "18px 16px", display: "flex", alignItems: "center", gap: "14px" }}>
          <span class="avatar">{(me?.first_name ?? "?").charAt(0).toUpperCase()}</span>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
            <span style={{ fontSize: "20px", fontWeight: 600 }}>{me?.first_name ?? "…"}</span>
            <span class="s">{me?.motto || "Добавь девиз — зачем тебе трекер"}</span>
          </span>
          <button class="ib" aria-label="Изменить профиль" style={{ color: "var(--muted)" }} onClick={() => openSheet("profile")}>
            <Icon name="edit" />
          </button>
        </section>

        {!d ? (
          <div class="card skel" style={{ height: "300px" }} />
        ) : (
          <>
            <section>
              <Sec title="Цели" end={<button class="link" onClick={() => push("goals")}>Все</button>} />
              {d.goals.length === 0 ? (
                <Empty text="Целей пока нет. Цель — то, к чему ведут привычки и задачи." action="Создать цель" onAction={() => openSheet("goal", {})} />
              ) : (
                <div class="card list">
                  {d.goals.map((g) => (
                    <button class="row plain" key={g.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "8px", paddingTop: "14px", paddingBottom: "14px" }} onClick={() => openSheet("goal", { id: g.id })}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                        <span class="t">{g.title}</span>
                        <span class="mono" style={{ fontSize: "15px" }}>{g.progress.pct}%</span>
                      </span>
                      <span class="bar"><i style={{ width: `${g.progress.pct}%` }} /></span>
                      <span class="s">{goalMeta(g)}</span>
                    </button>
                  ))}
                  <button class="row plain add" onClick={() => openSheet("goal", {})}>
                    <Icon name="plus" size={18} />
                    <span style={{ fontSize: "15px" }}>Новая цель</span>
                  </button>
                </div>
              )}
            </section>

            <section>
              <Sec title="Задачи" end={<button class="link" onClick={() => push("tasks")}>Все</button>} />
              <div class="card list">
                {(
                  [
                    ["today", "Сегодня", d.tasks.today],
                    ["inbox", "Входящие", d.tasks.inbox],
                    ["overdue", "Просрочено", d.tasks.overdue],
                    ["upcoming", "Ближайшие 2 недели", d.tasks.upcoming],
                  ] as const
                ).map(([v, label, n]) => (
                  <button class="row plain" key={v} onClick={() => push("tasks", { view: v })}>
                    <span class="t" style={{ flex: 1 }}>{label}</span>
                    {v === "overdue" && d.tasks.overdue_critical > 0 && (
                      <span class="tag crit">
                        {d.tasks.overdue_critical} {d.tasks.overdue_critical === 1 ? "критичная" : "критичных"}
                      </span>
                    )}
                    <span class="s mono">{n}</span>
                    <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
                  </button>
                ))}
                <button class="row plain add" onClick={() => openSheet("task", {})}>
                  <Icon name="plus" size={18} />
                  <span style={{ fontSize: "15px" }}>Новая задача</span>
                </button>
              </div>
            </section>

            <section>
              <Sec title="Привычки" end={`${active.length} активных`} />
              <div class="card list">
                {active.slice(0, 3).map((h) => (
                  <button class="row plain" key={h.id} onClick={() => openSheet("habit", { id: h.id })}>
                    <span class="col-text">
                      <span class="t">{h.name}</span>
                      <span class="s">{habitMeta(h)}</span>
                    </span>
                    {h.sphere_name && <span class="tag">{h.sphere_name}</span>}
                    <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
                  </button>
                ))}
                {rest > 0 && (
                  <button class="row plain" onClick={() => push("habits")}>
                    <span class="t" style={{ flex: 1, color: "var(--muted)" }}>
                      {active.length > 3 ? `Ещё ${active.length - 3}` : "Все"}
                      {d.habits.length > active.length ? " и выключенные" : ""}
                    </span>
                    <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
                  </button>
                )}
                <button class="row plain add" onClick={() => openSheet("habit", {})}>
                  <Icon name="plus" size={18} />
                  <span style={{ fontSize: "15px" }}>Новая привычка</span>
                </button>
              </div>
            </section>

            <section>
              <Sec title="Сферы" />
              <div class="chips">
                {d.spheres.map((s) => (
                  <button class="chip bright" key={s.id} onClick={() => openSheet("sphere", { id: s.id, name: s.name })}>
                    {s.name}
                    <span class="mono" style={{ fontSize: "12px", color: "var(--muted)" }}>{s.count}</span>
                  </button>
                ))}
                <button class="chip dashed" onClick={() => openSheet("sphere", {})}>
                  <Icon name="plus" size={16} />
                  Добавить сферу
                </button>
              </div>
            </section>

            <section>
              <Sec title="Настройки" />
              <div class="card list">
                <button class="row plain" onClick={() => push("norms")}>
                  <span class="t" style={{ flex: 1 }}>Нормы и режим</span>
                  <span class="s">сон, отбой</span>
                  <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
                </button>
                <button class="row plain" onClick={() => push("past")}>
                  <span class="t" style={{ flex: 1 }}>Отметить прошлый день</span>
                  <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
                </button>
                <button class="row plain" onClick={() => push("settings")}>
                  <span class="t" style={{ flex: 1 }}>Оформление и уведомления</span>
                  <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
                </button>
                <button
                  class="row plain"
                  style={{ color: "var(--accent)", fontSize: "16px" }}
                  onClick={() => {
                    haptic.warning();
                    void mutate({ request: () => post("/settings/model/reset"), refresh: ["/settings", "/views/now", "/views/day"] }).then(
                      (r) => r !== undefined && toast("Подстройка модели сброшена"),
                    );
                  }}
                >
                  Сбросить подстройку модели
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
