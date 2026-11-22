import { useEffect, useState } from "preact/hooks";
import { Icon, Seg, Sheet, SheetHead } from "../components/ui";
import { del, get, patch, post, uuid7 } from "../lib/api";
import { shortDate } from "../lib/format";
import { haptic } from "../lib/haptic";
import { closeSheet } from "../lib/router";
import { invalidateSoon, mutate, resource } from "../lib/store";
import { toast } from "../lib/toast";
import type { GoalDetail, Habit, Sphere } from "../lib/types";

type Kind = GoalDetail["kind"];
interface Step {
  id: string;
  title: string;
  deadline: string | null;
  done: boolean;
}

export function GoalSheet({ id }: { id?: string }) {
  const habits = (resource<Habit[]>("/habits").value.data ?? []).filter((h) => h.active);
  const spheres = resource<Sphere[]>("/spheres").value.data ?? [];
  const [g, setG] = useState<GoalDetail | null>(null);
  const [title, setTitle] = useState("");
  const [criterion, setCriterion] = useState("");
  const [deadline, setDeadline] = useState<string | null>(null);
  const [stage, setStage] = useState(1);
  const [kind, setKind] = useState<Kind>("subtasks");
  const [habitIds, setHabitIds] = useState<string[]>([]);
  const [target, setTarget] = useState(10);
  const [win, setWin] = useState(7);
  const [pct, setPct] = useState(0);
  const [sphere, setSphere] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [newStep, setNewStep] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const load = (d: GoalDetail) => {
    setG(d);
    setTitle(d.title);
    setCriterion(d.criterion);
    setDeadline(d.deadline);
    setStage(d.stage);
    setKind(d.kind);
    setHabitIds(d.habit_ids);
    setTarget(d.target ?? 10);
    setWin(d.window_days ?? 7);
    setPct(d.manual_pct ?? 0);
    setSphere(d.sphere_id);
    setSteps(d.subtasks.map((s) => ({ id: s.id, title: s.title, deadline: s.deadline, done: s.done })));
  };
  useEffect(() => {
    if (id) void get<GoalDetail>(`/goals/${id}`).then(load);
  }, [id]);

  const refresh = ["/views/goals", "/views/profile", "/views/review", "/goals"];
  const body = () => ({
    title: title.trim(), criterion, deadline, stage, kind, habit_ids: habitIds, sphere_id: sphere,
    target: kind === "streak" || kind === "count" ? target : null,
    window_days: kind === "count" ? win : null,
    manual_pct: kind === "manual" ? pct : null,
  });

  const save = async () => {
    if (!title.trim()) return toast("Напиши название цели");
    if ((kind === "streak" || kind === "count") && habitIds.length === 0) return toast("Выбери хотя бы одну привычку");
    const res = await mutate({
      request: () =>
        g
          ? patch(`/goals/${g.id}`, body())
          : post("/goals", { ...body(), id: uuid7(), subtasks: steps.map((s) => ({ title: s.title, deadline: s.deadline })) }),
      refresh,
    });
    if (res !== undefined) {
      haptic.success();
      closeSheet();
      toast(g ? "Цель сохранена" : "Цель создана");
    }
  };

  // Steps of an existing goal are saved immediately (each change goes to the history).
  const stepOp = async (fn: () => Promise<GoalDetail>) => {
    const res = await mutate({ request: fn, refresh });
    if (res) load(res);
  };
  const addStep = () => {
    const t = newStep.trim();
    if (!t) return;
    haptic.light();
    setNewStep("");
    if (g) void stepOp(() => post<GoalDetail>(`/goals/${g.id}/subtasks`, { title: t, id: uuid7() }));
    else setSteps([...steps, { id: uuid7(), title: t, deadline: null, done: false }]);
  };
  const toggleStep = (s: Step) => {
    if (!s.done) haptic.success();
    else haptic.light();
    setSteps(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)));
    if (g) void stepOp(() => patch<GoalDetail>(`/goals/${g.id}/subtasks/${s.id}`, { done: !s.done }));
  };
  const removeStep = (s: Step) => {
    setSteps(steps.filter((x) => x.id !== s.id));
    if (g) void stepOp(() => del<GoalDetail>(`/goals/${g.id}/subtasks/${s.id}`));
  };

  const archive = async () => {
    if (!g) return;
    await mutate({ request: () => patch(`/goals/${g.id}`, { archived: !g.archived }), refresh });
    closeSheet();
    toast(g.archived ? "Возвращена из архива" : "Перенесена в архив");
  };
  const remove = async () => {
    if (!g) return;
    if (!confirmDel) {
      haptic.warning();
      return setConfirmDel(true);
    }
    await mutate({ request: () => del(`/goals/${g.id}`), refresh });
    invalidateSoon("/views");
    closeSheet();
    toast("Цель удалена");
  };

  return (
    <Sheet label="Цель">
      <SheetHead title={id ? "Цель" : "Новая цель"} done="Готово" onDone={save} />
      <div class="sheet-body">
        <div class="grp">
          <label class="row">
            <span class="sr">Название</span>
            <input class="field" style={{ fontSize: "17px", fontWeight: 500 }} placeholder="Например: Пробежать 10 км" value={title} maxLength={200} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          </label>
          <label class="row" style={{ alignItems: "flex-start" }}>
            <span class="sr">Критерий</span>
            <textarea class="field" rows={2} style={{ fontSize: "15px", color: "var(--muted)", resize: "none" }} placeholder="Как поймёшь, что получилось" value={criterion} onInput={(e) => setCriterion((e.target as HTMLTextAreaElement).value)} />
          </label>
          <div class="row">
            <span class="t" style={{ flex: 1 }}>Дедлайн</span>
            {deadline && <button class="btn" style={{ height: "28px" }} onClick={() => setDeadline(null)}>Без срока</button>}
            <input type="date" class="pill-input" value={deadline ?? ""} onChange={(e) => setDeadline((e.target as HTMLInputElement).value || null)} />
          </div>
        </div>

        <section>
          <div class="sec">Этап</div>
          <Seg label="Этап" options={[[1, "База — сейчас"], [2, "Следующий этап"]]} value={stage} onChange={setStage} />
        </section>

        <section>
          <div class="sec">Как считать прогресс</div>
          <Seg label="Тип цели" options={[["subtasks", "Шаги"], ["streak", "Серия"], ["count", "Дней из N"], ["manual", "Вручную"]]} value={kind} onChange={setKind} />
          {(kind === "streak" || kind === "count") && (
            <>
              <div class="s" style={{ margin: "12px 4px 8px" }}>Привычки — день засчитан, когда сделаны все</div>
              <div class="chips">
                {habits.map((h) => {
                  const on = habitIds.includes(h.id);
                  return (
                    <button key={h.id} class={`chip${on ? " on" : ""}`} onClick={() => { haptic.selection(); setHabitIds(on ? habitIds.filter((x) => x !== h.id) : [...habitIds, h.id]); }}>
                      {h.name}
                    </button>
                  );
                })}
                {habits.length === 0 && <span class="s">Сначала создай привычку</span>}
              </div>
              <div class="grp" style={{ marginTop: "12px" }}>
                <div class="row">
                  <span class="t" style={{ flex: 1 }}>{kind === "streak" ? "Дней подряд" : "Нужно дней"}</span>
                  <input type="number" class="pill-input" style={{ width: "80px" }} min={1} value={target} onChange={(e) => setTarget(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} />
                </div>
                {kind === "count" && (
                  <div class="row">
                    <span class="t" style={{ flex: 1 }}>Из последних, дней</span>
                    <input type="number" class="pill-input" style={{ width: "80px" }} min={1} value={win} onChange={(e) => setWin(Math.max(1, Number((e.target as HTMLInputElement).value) || 7))} />
                  </div>
                )}
              </div>
            </>
          )}
          {kind === "manual" && (
            <div class="grp" style={{ marginTop: "12px" }}>
              <div class="row">
                <span class="t" style={{ flex: 1 }}>Прогресс</span>
                <button class="step" onClick={() => { haptic.light(); setPct(Math.max(0, pct - 10)); }}>−10</button>
                <span class="mono" style={{ minWidth: "46px", textAlign: "center" }}>{pct}%</span>
                <button class="step" onClick={() => { haptic.light(); setPct(Math.min(100, pct + 10)); }}>+10</button>
              </div>
            </div>
          )}
        </section>

        <section>
          <div class="sec">Шаги{kind !== "subtasks" ? " (необязательно)" : ""}</div>
          <div class="grp">
            {steps.map((s) => (
              <div class="row" key={s.id}>
                <button class={`chk sm${s.done ? " on" : ""}`} aria-label={`Шаг выполнен: ${s.title}`} onClick={() => toggleStep(s)}>
                  {s.done && <Icon name="check" />}
                </button>
                <span class="t" style={{ flex: 1, fontSize: "15px", color: s.done ? "var(--muted)" : undefined }}>{s.title}</span>
                {s.deadline && <span class="s mono" style={{ fontSize: "12px" }}>{shortDate(s.deadline)}</span>}
                <button class="ib" style={{ width: "32px", height: "32px", color: "var(--muted)" }} aria-label="Удалить шаг" onClick={() => removeStep(s)}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            ))}
            <div class="row">
              <input class="field" placeholder="Новый шаг" value={newStep} onInput={(e) => setNewStep((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && addStep()} />
              <button class="btn" onClick={addStep}>Добавить</button>
            </div>
          </div>
        </section>

        <section>
          <div class="sec">Сфера</div>
          <div class="chips">
            {spheres.map((s) => (
              <button key={s.id} class={`chip${sphere === s.id ? " on" : ""}`} onClick={() => { haptic.selection(); setSphere(sphere === s.id ? null : s.id); }}>
                {s.name}
              </button>
            ))}
          </div>
        </section>

        {g && (
          <>
            <div style={{ display: "flex", gap: "8px" }}>
              <button class="btn lg" onClick={archive}>{g.archived ? "Вернуть из архива" : "В архив"}</button>
              <button class="btn lg danger" style={{ width: "auto", padding: "0 18px" }} onClick={remove}>
                {confirmDel ? "Точно?" : <Icon name="trash" />}
              </button>
            </div>
            {g.history.length > 0 && (
              <section>
                <div class="sec">История изменений</div>
                <div class="grp">
                  {g.history.map((h, i) => (
                    <div class="row" key={i} style={{ alignItems: "flex-start" }}>
                      <span class="tag" style={{ marginTop: "1px" }}>{h.by === "claude" ? "Claude" : "Ты"}</span>
                      <span class="col-text">
                        <span class="t" style={{ fontSize: "15px" }}>{h.what}</span>
                        <span class="s">{shortDate(h.at.slice(0, 10))}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
