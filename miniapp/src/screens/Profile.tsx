/** Profile (ProfileGlass): Claude, reminders in Telegram, sleep norms, data, about. */

import type { ComponentChildren } from "preact";
import { Chevron, ClaudeLogo } from "../components/icons";
import { patch } from "../lib/api";
import { parseDate, plural } from "../lib/format";
import { haptic } from "../lib/haptic";
import { push } from "../lib/router";
import { mutate, resource, setData } from "../lib/store";
import type { McpStatus, Me, Settings } from "../lib/types";
import { claudeAt } from "./Results";

const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function saveMe(fields: Partial<Me>) {
  return mutate({
    apply: () => setData<Me>("/me", (m) => ({ ...m, ...fields })),
    request: () => patch("/me", fields),
  });
}

function saveSettings(fields: Partial<Settings>) {
  return mutate({
    apply: () => setData<Settings>("/settings", (s) => ({ ...s, ...fields })),
    request: () => patch("/settings", fields),
    refresh: ["/views"],
  });
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="k-card clip">
      <div class="k-cardhead">
        <h2 class="k-h2">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** A reminder: the switch turns it on (with a usual time) or off; the time opens the picker. */
function Reminder({ title, label, value, fallback, what, onChange }: { title: string; label: string; value: string | null; fallback: string; what: string; onChange: (v: string | null) => void }) {
  const on = !!value;
  return (
    <div class="k-lr">
      <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", position: "relative" }}>
        <span style={{ fontSize: "16px" }}>{title}</span>
        <span class="k-cap">{on ? `${what.replace("{t}", value!)}` : "выключено"}</span>
        {on && <input class="k-native" type="time" aria-label={`${title}: время`} value={value!} onChange={(e) => (e.target as HTMLInputElement).value && onChange((e.target as HTMLInputElement).value)} />}
      </label>
      <button
        class="k-switch"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => {
          haptic.selection();
          onChange(on ? null : fallback);
        }}
      >
        <i />
      </button>
    </div>
  );
}

function Link({ title, value, onClick, children }: { title: string; value?: string; onClick?: () => void; children?: ComponentChildren }) {
  return (
    <button class="k-btnreset k-lr" onClick={onClick}>
      <span style={{ flex: 1, fontSize: "16px" }}>{title}</span>
      {value && <span class="v">{value}</span>}
      <Chevron color="#636366" />
      {children}
    </button>
  );
}

export function ProfileScreen() {
  const me = resource<Me>("/me").value.data;
  const st = resource<Settings>("/settings").value.data;
  const mcp = resource<McpStatus>("/mcp/token").value.data;
  if (!me) return null;
  const since = parseDate(me.start_date);
  const claudeSub = !mcp?.active ? "Не подключён. Разборы и план дня" : mcp.last_used_at ? `Подключён. Заходил ${claudeAt(mcp.last_used_at)}` : "Подключён";
  const need = st?.sleep_need_h ?? 8;
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <header class="k-head">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: 600 }}>
            {me.first_name.slice(0, 1).toUpperCase()}
          </span>
          <h1 class="k-h1 detail">{me.first_name}</h1>
        </div>
        <p class="k-sub">
          В Keel с {since.getUTCDate()} {MON[since.getUTCMonth()]}
        </p>
      </header>
      <main class="k-main">
        <section class="k-card clip">
          <button class="k-btnreset k-lr" style={{ minHeight: 64 }} onClick={() => push("claude")}>
            <ClaudeLogo size={24} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "16px" }}>Claude</span>
              <span class="k-cap">{claudeSub}</span>
            </span>
            <Chevron color="#636366" />
          </button>
        </section>
        <Section title="Напоминания в Телеграме">
          <Reminder title="Вечером" label="Вечернее напоминание" value={me.reminder_time} fallback="21:00" what="в {t} — что осталось на сегодня" onChange={(v) => void saveMe({ reminder_time: v })} />
          <Reminder title="Утром" label="Утреннее напоминание" value={me.morning_time} fallback="08:30" what="в {t} — сон и план на день" onChange={(v) => void saveMe({ morning_time: v })} />
          <Reminder title="Заметка о неделе" label="Напоминание о заметке" value={me.week_note_time} fallback="20:00" what="в воскресенье в {t}" onChange={(v) => void saveMe({ week_note_time: v })} />
        </Section>
        <Section title="Сон">
          <label class="k-lr" style={{ position: "relative" }}>
            <span style={{ flex: 1, fontSize: "16px" }}>Норма отбоя</span>
            <span class="v">{st?.bed_target ?? "—"}</span>
            <Chevron color="#636366" />
            {st && <input class="k-native" type="time" aria-label="Норма отбоя" value={st.bed_target} onChange={(e) => (e.target as HTMLInputElement).value && void saveSettings({ bed_target: (e.target as HTMLInputElement).value })} />}
          </label>
          <label class="k-lr" style={{ position: "relative" }}>
            <span style={{ flex: 1, fontSize: "16px" }}>Норма сна</span>
            <span class="v">
              {String(need).replace(".", ",")} {Number.isInteger(need) ? plural(need, "час", "часа", "часов") : "часа"}
            </span>
            <Chevron color="#636366" />
            <select class="k-native" aria-label="Норма сна" value={String(need)} onChange={(e) => void saveSettings({ sleep_need_h: Number((e.target as HTMLSelectElement).value) })}>
              {Array.from({ length: 13 }, (_, i) => 5 + i * 0.5).map((h) => (
                <option key={h} value={String(h)}>
                  {String(h).replace(".", ",")} ч
                </option>
              ))}
            </select>
          </label>
        </Section>
        <Section title="Данные">
          <Link title="Выгрузить мои данные" onClick={() => push("data")} />
          <Link title="О приложении" onClick={() => push("about")} />
        </Section>
      </main>
    </div>
  );
}

export function AboutScreen() {
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <header class="k-head">
        <h1 class="k-h1 detail">Keel</h1>
        <p class="k-sub">Версия 0.1</p>
      </header>
      <main class="k-main">
        <section class="k-sum">
          <p class="k-motto">Привычки, дела и сон в одном месте. Без лишнего.</p>
          <p class="k-sumtext">
            Keel считает итог дня, прогноз энергии по сну и итоги недели. Если подключить Claude, он пишет разборы и план дня — и всё, что он меняет, видно в приложении.
          </p>
        </section>
        <section class="k-card clip">
          <div class="k-lr">
            <span style={{ flex: 1, fontSize: "16px" }}>Данные</span>
            <span class="v">только в твоём аккаунте</span>
          </div>
          <div class="k-lr">
            <span style={{ flex: 1, fontSize: "16px" }}>Напоминания</span>
            <span class="v">от бота в Телеграме</span>
          </div>
        </section>
      </main>
    </div>
  );
}
