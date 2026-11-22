import { useEffect, useState } from "preact/hooks";
import { Icon, Switch } from "../components/ui";
import { get, patch, post } from "../lib/api";
import { haptic } from "../lib/haptic";
import { invalidate, setData } from "../lib/store";
import { toast } from "../lib/toast";
import type { HabitTemplate, Me } from "../lib/types";

const STEPS = 4;

export function Onboarding({ me }: { me: Me }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(me.first_name);
  const [bed, setBed] = useState("23:30");
  const [wake, setWake] = useState("07:30");
  const [templates, setTemplates] = useState<HabitTemplate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [remind, setRemind] = useState<string | null>("21:00");
  const [morning, setMorning] = useState(true);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    void get<HabitTemplate[]>("/habit-templates").then(setTemplates).catch(() => {});
  }, []);

  const finish = async (skip: boolean) => {
    haptic.success();
    const profile = skip ? { onboarded: true, timezone: tz } : { onboarded: true, first_name: name.trim() || me.first_name, timezone: tz, reminder_time: remind, morning_ping: morning };
    setData<Me>("/me", (m) => ({ ...m, ...profile }));
    try {
      if (!skip) {
        await patch("/settings", { bed_target: bed, usual_bed: bed, usual_wake: wake });
        const chosen = templates.filter((t) => picked.has(t.key));
        const spheres = new Map<string, string>();
        for (const name of [...new Set(chosen.map((t) => t.sphere))]) {
          const s = await post<{ id: string }>("/spheres", { name }).catch(() => null);
          if (s) spheres.set(name, s.id);
        }
        for (const t of chosen) {
          await post("/habits", { name: t.name, type: t.type, config: t.config ?? {}, schedule: t.schedule, sphere_id: spheres.get(t.sphere) ?? null });
        }
      }
      await patch("/me", profile);
    } catch {
      toast("Что-то не сохранилось — проверь в Профиле");
    }
    invalidate("/me", "/views", "/settings");
  };

  const next = () => {
    haptic.light();
    if (step < STEPS - 1) setStep(step + 1);
    else void finish(false);
  };

  return (
    <div class="page" style={{ paddingBottom: "40px" }}>
      <header class="head head-row">
        <div style={{ display: "flex", gap: "6px" }}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} style={{ width: "24px", height: "4px", borderRadius: "2px", background: i <= step ? "var(--accent)" : "var(--fill-2)" }} />
          ))}
        </div>
        <button class="btn" onClick={() => void finish(true)}>
          Пропустить
        </button>
      </header>
      <main class="main" style={{ paddingTop: "28px", gap: "24px" }}>
        {step === 0 && (
          <>
            <h1 class="h1">Привет! Это твой трекер жизни</h1>
            <p class="s" style={{ fontSize: "16px", lineHeight: "22px", margin: 0, color: "var(--soft)" }}>
              Привычки, сон, энергия, задачи и цели — в одном месте. Всё настраивается под тебя, ничего лишнего.
            </p>
            <label class="grp row" style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
              <span class="s">Как тебя называть</span>
              <input class="field" style={{ fontSize: "17px", textAlign: "right" }} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} maxLength={64} />
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <h1 class="h1">Режим сна</h1>
            <p class="s" style={{ fontSize: "16px", lineHeight: "22px", margin: 0, color: "var(--soft)" }}>
              От сна считается энергия на день и лучшие окна для сложных задач.
            </p>
            <div class="card list">
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Ложусь обычно в</span>
                <input type="time" class="pill-input" value={bed} onChange={(e) => setBed((e.target as HTMLInputElement).value)} />
              </div>
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Встаю в</span>
                <input type="time" class="pill-input" value={wake} onChange={(e) => setWake((e.target as HTMLInputElement).value)} />
              </div>
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Часовой пояс</span>
                <span class="s mono">{tz}</span>
              </div>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h1 class="h1">Привычки</h1>
            <p class="s" style={{ fontSize: "16px", lineHeight: "22px", margin: 0, color: "var(--soft)" }}>
              Выбери из шаблонов или начни с нуля. Названия, нормы и график потом меняются в Профиле.
            </p>
            <div class="card list">
              {templates.map((t) => {
                const on = picked.has(t.key);
                return (
                  <button
                    class="row plain"
                    key={t.key}
                    onClick={() => {
                      haptic.selection();
                      const s = new Set(picked);
                      if (on) s.delete(t.key);
                      else s.add(t.key);
                      setPicked(s);
                    }}
                  >
                    <span class={`chk${on ? " on" : ""}`}>{on && <Icon name="check" />}</span>
                    <span class="col-text">
                      <span class="t">{t.name}</span>
                      <span class="s">{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1 class="h1">Напоминания</h1>
            <p class="s" style={{ fontSize: "16px", lineHeight: "22px", margin: 0, color: "var(--soft)" }}>
              Бот вечером пришлёт рейтинг дня и неотмеченные привычки — отметить можно прямо в чате.
            </p>
            <div class="card list">
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Вечернее напоминание</span>
                <Switch on={remind !== null} label="Вечернее напоминание" onChange={(on) => setRemind(on ? "21:00" : null)} />
              </div>
              {remind !== null && (
                <div class="row">
                  <span class="t" style={{ flex: 1 }}>Время</span>
                  <input type="time" class="pill-input" value={remind} onChange={(e) => setRemind((e.target as HTMLInputElement).value)} />
                </div>
              )}
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Утром «Как спал?»</span>
                <Switch on={morning} label="Утреннее сообщение" onChange={setMorning} />
              </div>
            </div>
          </>
        )}
        <button class="save" onClick={next}>
          {step === 2 && picked.size === 0 ? "Начать с нуля" : step === STEPS - 1 ? "Готово" : "Дальше"}
        </button>
      </main>
    </div>
  );
}
