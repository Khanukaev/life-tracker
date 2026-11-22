import { useMemo, useState } from "preact/hooks";
import { StackHead, Switch } from "../components/ui";
import { patch } from "../lib/api";
import { addDays } from "../lib/format";
import { haptic, hapticsEnabled } from "../lib/haptic";
import { openDay } from "../lib/router";
import { mutate, resource, setData } from "../lib/store";
import { applyTheme, canGlass, theme } from "../lib/theme";
import type { DayView, Me, Settings } from "../lib/types";

function saveMe(fields: Partial<Me>) {
  return mutate({
    apply: () => setData<Me>("/me", (m) => ({ ...m, ...fields })),
    request: () => patch<Me>("/me", fields),
    refresh: ["/views"],
  });
}

function Row({ title, sub, children }: { title: string; sub?: string; children: preact.ComponentChildren }) {
  return (
    <div class="row">
      <span class="col-text">
        <span class="t">{title}</span>
        {sub && <span class="s">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

export function SettingsScreen() {
  const me = resource<Me>("/me").value.data;
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);
  if (!me) return null;
  const glassOn = theme.value === "glass";
  const supported = canGlass();
  return (
    <div class="page">
      <StackHead back="Профиль" title="Настройки" />
      <main class="main" style={{ paddingTop: "20px" }}>
        <section>
          <div class="sec"><span>Оформление</span></div>
          <div class="card list">
            <Row title="Liquid Glass" sub={supported ? "Стекло, размытие и живые анимации" : "Устройство не тянет эффекты — включена базовая тема"}>
              <Switch
                on={glassOn}
                label="Liquid Glass"
                onChange={(on) => {
                  const next = on && supported ? "glass" : "base";
                  applyTheme(next); // instant, no reload
                  void saveMe({ theme: next });
                }}
              />
            </Row>
            <Row title="Вибрация" sub="Отклик на нажатия и отметки">
              <Switch
                on={me.haptics}
                label="Вибрация"
                onChange={(on) => {
                  hapticsEnabled.value = on;
                  void saveMe({ haptics: on });
                }}
              />
            </Row>
          </div>
        </section>

        <section>
          <div class="sec"><span>Напоминания в боте</span></div>
          <div class="card list">
            <Row title="Вечернее напоминание" sub="Рейтинг дня и неотмеченные привычки">
              <input
                type="time"
                class="pill-input"
                value={me.reminder_time ?? ""}
                onChange={(e) => void saveMe({ reminder_time: (e.target as HTMLInputElement).value || null })}
              />
            </Row>
            <Row title="Утром «Как спал?»" sub="Кнопка, чтобы отметить сон">
              <Switch on={me.morning_ping} label="Утреннее сообщение" onChange={(on) => void saveMe({ morning_ping: on })} />
            </Row>
          </div>
        </section>

        <section>
          <div class="sec"><span>Время</span></div>
          <div class="card list">
            <Row title="Часовой пояс" sub="День считается с 05:00 до 05:00">
              <select
                class="pill-input"
                style={{ maxWidth: "170px" }}
                value={me.timezone}
                onChange={(e) => {
                  haptic.selection();
                  void saveMe({ timezone: (e.target as HTMLSelectElement).value });
                }}
              >
                {(zones.includes(me.timezone) ? zones : [me.timezone, ...zones]).map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </Row>
          </div>
        </section>
      </main>
    </div>
  );
}

export function NormsScreen() {
  const st = resource<Settings>("/settings").value.data;
  if (!st) return null;
  const save = (fields: Partial<Settings>) =>
    mutate({
      apply: () => setData<Settings>("/settings", (s) => ({ ...s, ...fields })),
      request: () => patch("/settings", fields),
      refresh: ["/views"],
    });
  return (
    <div class="page">
      <StackHead back="Профиль" title="Нормы и режим" />
      <main class="main" style={{ paddingTop: "20px" }}>
        <section>
          <div class="sec"><span>Сон</span></div>
          <div class="card list">
            <Row title="Отбой до" sub="Норма для привычки «Отбой» и модели энергии">
              <input type="time" class="pill-input" value={st.bed_target} onChange={(e) => void save({ bed_target: (e.target as HTMLInputElement).value })} />
            </Row>
            <Row title="Нужно сна" sub="Часов в сутки">
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button class="step" onClick={() => { haptic.light(); void save({ sleep_need_h: Math.max(4, st.sleep_need_h - 0.5) }); }}>−</button>
                <span class="mono" style={{ minWidth: "38px", textAlign: "center" }}>{String(st.sleep_need_h).replace(".", ",")}</span>
                <button class="step" onClick={() => { haptic.light(); void save({ sleep_need_h: Math.min(12, st.sleep_need_h + 0.5) }); }}>+</button>
              </div>
            </Row>
          </div>
        </section>
        <section>
          <div class="sec"><span>Обычный режим</span></div>
          <div class="card list">
            <Row title="Обычно ложусь" sub="Модель берёт его, пока сон не отмечен">
              <input type="time" class="pill-input" value={st.usual_bed} onChange={(e) => void save({ usual_bed: (e.target as HTMLInputElement).value })} />
            </Row>
            <Row title="Обычно встаю">
              <input type="time" class="pill-input" value={st.usual_wake} onChange={(e) => void save({ usual_wake: (e.target as HTMLInputElement).value })} />
            </Row>
          </div>
        </section>
        <div class="s" style={{ margin: "-20px 4px 0" }}>
          Нормы воды, минут и прочего задаются в каждой привычке отдельно.
        </div>
      </main>
    </div>
  );
}

export function PastDayScreen() {
  const today = resource<DayView>("/views/day").value.data?.today ?? new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(addDays(today, -1));
  return (
    <div class="page">
      <StackHead back="Профиль" title="Прошлый день" />
      <main class="main" style={{ paddingTop: "20px" }}>
        <div class="card" style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <span class="s" style={{ fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>
            Забыл отметиться? Открой день — отметки сохранятся с пометкой «задним числом».
          </span>
          <input type="date" class="pill-input" style={{ alignSelf: "flex-start", fontSize: "17px" }} max={today} value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
          <button class="btn acc lg" onClick={() => openDay(date >= today ? null : date)}>
            Открыть день
          </button>
        </div>
      </main>
    </div>
  );
}
