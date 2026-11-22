import { useState } from "preact/hooks";
import { Icon, Seg, Sheet, SheetHead, Switch } from "../components/ui";
import { del, patch, post, uuid7 } from "../lib/api";
import { haptic } from "../lib/haptic";
import { closeSheet, openSheet } from "../lib/router";
import { mutate, resource } from "../lib/store";
import { toast } from "../lib/toast";
import type { DayView, Habit, HabitTemplate, HabitType, Schedule, Sphere } from "../lib/types";

const TYPES: [HabitType, string, string][] = [
  ["check", "Галочка", "Сделал / не сделал"],
  ["minutes", "Минуты", "Чтение, практика, медитация — с нормой"],
  ["water", "Вода", "Стаканами до нормы в литрах"],
  ["dual", "Две отметки", "Обе — и день засчитан"],
  ["bedtime", "Отбой", "Считается сам из сна"],
];

const DEFAULT_CONFIG: Record<HabitType, Record<string, any>> = {
  check: {},
  bedtime: {},
  water: { target_l: 2, glass_l: 0.25 },
  minutes: { target_min: 20, step_min: 10 },
  dual: { labels: ["Первое", "Второе"] },
};

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

export function HabitSheet({ id }: { id?: string }) {
  const habits = resource<Habit[]>("/habits").value.data ?? [];
  const spheres = resource<Sphere[]>("/spheres").value.data ?? [];
  const templates = resource<HabitTemplate[]>("/habit-templates").value.data ?? [];
  const today = resource<DayView>("/views/day").value.data?.today ?? new Date().toISOString().slice(0, 10);
  const existing = id ? habits.find((h) => h.id === id) : undefined;
  const hasBedtime = habits.some((h) => h.type === "bedtime" && h.id !== id);

  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<HabitType>(existing?.type ?? "check");
  const [config, setConfig] = useState<Record<string, any>>(existing?.config ?? {});
  const [sphere, setSphere] = useState<string | null>(existing?.sphere_id ?? null);
  const [sched, setSched] = useState<Schedule>(existing?.schedule ?? { kind: "daily" });
  const [isKey, setIsKey] = useState(existing?.is_key ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [confirmDel, setConfirmDel] = useState(false);
  const cycleDay =
    sched.kind === "cycle" && sched.anchor && sched.pattern
      ? ((daysBetween(sched.anchor, today) % sched.pattern.length) + sched.pattern.length) % sched.pattern.length + 1
      : 1;

  const cfg = { ...DEFAULT_CONFIG[type], ...config };
  const setCfg = (k: string, v: any) => setConfig({ ...cfg, [k]: v });

  const fromTemplate = (t: HabitTemplate) => {
    haptic.selection();
    setName(t.name);
    setType(t.type);
    setConfig(t.config ?? {});
    setSched(t.schedule ?? { kind: "daily" });
    setIsKey(t.type === "bedtime");
    setSphere(spheres.find((s) => s.name === t.sphere)?.id ?? null);
  };

  const save = async () => {
    if (!name.trim()) return toast("Напиши название");
    const schedule =
      sched.kind === "every" ? { kind: "every", n: sched.n ?? 2 } :
      sched.kind === "cycle" ? { kind: "cycle", pattern: sched.pattern || "1", anchor: sched.anchor ?? today } :
      { kind: "daily" };
    const body = { name: name.trim(), sphere_id: sphere, is_key: isKey, config: type === "check" || type === "bedtime" ? {} : cfg, schedule, active };
    const res = await mutate({
      request: () => (existing ? patch(`/habits/${existing.id}`, body) : post("/habits", { ...body, id: uuid7(), type })),
      refresh: ["/habits", "/views"],
    });
    if (res !== undefined) {
      haptic.success();
      closeSheet();
      toast("Привычка сохранена");
    }
  };

  const remove = async () => {
    if (!confirmDel) {
      haptic.warning();
      return setConfirmDel(true);
    }
    await mutate({ request: () => del(`/habits/${existing!.id}`), refresh: ["/habits", "/views"] });
    closeSheet();
    toast("Привычка удалена");
  };

  return (
    <Sheet label="Привычка">
      <SheetHead title={existing ? "Привычка" : "Новая привычка"} done="Готово" onDone={save} />
      <div class="sheet-body">
        {!existing && templates.length > 0 && (
          <section>
            <div class="sec">Из шаблона</div>
            <div class="chips scroll">
              {templates.filter((t) => t.type !== "bedtime" || !hasBedtime).map((t) => (
                <button key={t.key} class="chip" onClick={() => fromTemplate(t)}>{t.name}</button>
              ))}
            </div>
          </section>
        )}
        <div class="grp">
          <label class="row">
            <span class="sr">Название</span>
            <input class="field" style={{ fontSize: "17px", fontWeight: 500 }} placeholder="Например: Чтение" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
        </div>

        {!existing && (
          <section>
            <div class="sec">Тип</div>
            <div class="grp">
              {TYPES.map(([t, label, hint]) => {
                const disabled = t === "bedtime" && hasBedtime;
                return (
                  <button key={t} class="row plain" disabled={disabled} style={disabled ? { opacity: 0.4 } : undefined} onClick={() => { haptic.selection(); setType(t); setConfig({}); setIsKey(t === "bedtime"); }}>
                    <span class={`chk sm${type === t ? " on" : ""}`}>{type === t && <Icon name="check" />}</span>
                    <span class="col-text">
                      <span class="t">{label}</span>
                      <span class="s">{disabled ? "Уже есть — отбой может быть один" : hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {type === "minutes" && (
          <div class="grp">
            <div class="row">
              <span class="t" style={{ flex: 1 }}>Норма, минут</span>
              <input type="number" class="pill-input" style={{ width: "80px" }} min={1} max={1440} value={cfg.target_min} onChange={(e) => setCfg("target_min", Number((e.target as HTMLInputElement).value) || 1)} />
            </div>
            <div class="row">
              <span class="t" style={{ flex: 1 }}>Шаг кнопки, минут</span>
              <input type="number" class="pill-input" style={{ width: "80px" }} min={1} max={240} value={cfg.step_min} onChange={(e) => setCfg("step_min", Number((e.target as HTMLInputElement).value) || 1)} />
            </div>
          </div>
        )}
        {type === "water" && (
          <div class="grp">
            <div class="row">
              <span class="t" style={{ flex: 1 }}>Норма, литров</span>
              <input type="number" class="pill-input" style={{ width: "80px" }} step={0.1} min={0.1} max={10} value={cfg.target_l} onChange={(e) => setCfg("target_l", Number((e.target as HTMLInputElement).value) || 0.1)} />
            </div>
            <div class="row">
              <span class="t" style={{ flex: 1 }}>Стакан, литров</span>
              <input type="number" class="pill-input" style={{ width: "80px" }} step={0.05} min={0.05} max={2} value={cfg.glass_l} onChange={(e) => setCfg("glass_l", Number((e.target as HTMLInputElement).value) || 0.25)} />
            </div>
          </div>
        )}
        {type === "dual" && (
          <div class="grp">
            {[0, 1].map((i) => (
              <label class="row" key={i}>
                <span class="t" style={{ flex: 1 }}>Отметка {i + 1}</span>
                <input class="field" style={{ textAlign: "right", maxWidth: "160px" }} maxLength={24} value={cfg.labels[i]} onInput={(e) => { const l = [...cfg.labels]; l[i] = (e.target as HTMLInputElement).value; setCfg("labels", l); }} />
              </label>
            ))}
          </div>
        )}

        {type !== "bedtime" && (
          <section>
            <div class="sec">График</div>
            <Seg
              label="График"
              options={[["daily", "Каждый день"], ["every", "Раз в N дн."], ["cycle", "Цикл"]]}
              value={sched.kind}
              onChange={(k) => setSched(k === "every" ? { kind: "every", n: 2 } : k === "cycle" ? { kind: "cycle", pattern: "11010", anchor: today } : { kind: "daily" })}
            />
            {sched.kind === "every" && (
              <div class="grp" style={{ marginTop: "10px" }}>
                <div class="row">
                  <span class="t" style={{ flex: 1 }}>Каждые N дней</span>
                  <input type="number" class="pill-input" style={{ width: "70px" }} min={2} max={365} value={sched.n ?? 2} onChange={(e) => setSched({ ...sched, n: Math.max(2, Number((e.target as HTMLInputElement).value) || 2) })} />
                </div>
              </div>
            )}
            {sched.kind === "cycle" && (
              <div class="grp" style={{ marginTop: "10px" }}>
                <div class="row">
                  <span class="t" style={{ flex: 1 }}>Шаблон (1 — делать, 0 — отдых)</span>
                  <input class="pill-input" style={{ width: "110px" }} value={sched.pattern ?? ""} maxLength={31} onInput={(e) => setSched({ ...sched, pattern: (e.target as HTMLInputElement).value.replace(/[^01]/g, "") })} />
                </div>
                <div class="row">
                  <span class="t" style={{ flex: 1 }}>Сегодня — день цикла</span>
                  <input
                    type="number"
                    class="pill-input"
                    style={{ width: "70px" }}
                    min={1}
                    max={(sched.pattern || "1").length}
                    value={cycleDay}
                    onChange={(e) => {
                      const n = Math.max(1, Number((e.target as HTMLInputElement).value) || 1);
                      const len = (sched.pattern || "1").length;
                      const anchor = new Date(Date.parse(today) - ((n - 1) % len) * 864e5).toISOString().slice(0, 10);
                      setSched({ ...sched, anchor });
                    }}
                  />
                </div>
              </div>
            )}
            <div class="s" style={{ margin: "10px 4px 0" }}>
              {sched.kind === "every" ? "День занятия — если за последние N−1 дней не было отметки. Пропустил — привычка ждёт на следующий день." : sched.kind === "cycle" ? "Дни отдыха по циклу не портят серию и рейтинг." : "Отмечается каждый день."}
            </div>
          </section>
        )}

        <section>
          <div class="sec">Сфера</div>
          <div class="chips">
            {spheres.map((s) => (
              <button key={s.id} class={`chip${sphere === s.id ? " on" : ""}`} onClick={() => { haptic.selection(); setSphere(sphere === s.id ? null : s.id); }}>
                {s.name}
              </button>
            ))}
            <button class="chip dashed" onClick={() => openSheet("sphere", {})}>+ Сфера</button>
          </div>
        </section>

        <div class="grp">
          <div class="row">
            <span class="col-text">
              <span class="t">Ключевая</span>
              <span class="s">Весит ×3 в рейтинге дня</span>
            </span>
            <Switch on={isKey} label="Ключевая привычка" onChange={setIsKey} />
          </div>
          {existing && (
            <div class="row">
              <span class="col-text">
                <span class="t">Включена</span>
                <span class="s">Выключенные не отмечаются и не портят статистику</span>
              </span>
              <Switch on={active} label="Включена" onChange={setActive} />
            </div>
          )}
        </div>

        {existing && (
          <button class="btn lg danger" onClick={remove}>
            {confirmDel ? "Точно удалить? История отметок пропадёт" : "Удалить привычку"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
