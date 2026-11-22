import { Empty, Icon, StackHead } from "../components/ui";
import { openSheet } from "../lib/router";
import { resource } from "../lib/store";
import type { ProfileView } from "../lib/types";

export function HabitsScreen() {
  const d = resource<ProfileView>("/views/profile").value.data;
  const habits = d?.habits ?? [];
  return (
    <div class="page">
      <StackHead
        back="Профиль"
        title="Привычки"
        action={
          <button class="ib" aria-label="Новая привычка" onClick={() => openSheet("habit", {})}>
            <Icon name="plus" />
          </button>
        }
      />
      <main class="main" style={{ paddingTop: "20px" }}>
        {d && habits.length === 0 ? (
          <Empty text="Привычек пока нет." action="Создать привычку" onAction={() => openSheet("habit", {})} />
        ) : (
          <div class="card list">
            {habits.map((h) => (
              <button class="row plain" key={h.id} onClick={() => openSheet("habit", { id: h.id })}>
                <span class="col-text">
                  <span class="t" style={h.active ? undefined : { color: "var(--muted)" }}>{h.name}</span>
                  <span class="s">
                    {h.active ? h.schedule_label : "выключена"}
                    {h.active && h.streak > 1 ? ` · серия ${h.streak}` : ""}
                  </span>
                </span>
                {h.sphere_name && <span class="tag">{h.sphere_name}</span>}
                <Icon name="right" size={16} style={{ color: "var(--dim)" }} />
              </button>
            ))}
          </div>
        )}
        <div class="s" style={{ margin: "-20px 4px 0" }}>
          Выключенные привычки не отмечаются и не портят статистику.
        </div>
      </main>
    </div>
  );
}
