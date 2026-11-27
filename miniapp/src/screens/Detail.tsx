/** Details of a task (TaskDetailGlass) and of a habit (HabitDetailGlass). */

import type { ComponentChildren } from "preact";
import { Chevron, ClaudeLogo } from "../components/icons";
import { countNorm, countStep } from "../domain/score";
import { createdLabel, deleteHabit, deleteTask, postponeTask, scheduleLabel, setHabitValue, toggleTask, today } from "../lib/actions";
import { addDays, durLabel, parseDate, plural, relDay } from "../lib/format";
import { canEdit } from "../lib/net";
import { openSheet, pop } from "../lib/router";
import { entry, keysWith, resource } from "../lib/store";
import type { DayView, Habit, HabitRow, ReviewView, Task } from "../lib/types";
import { bedResult } from "./Today";

function DetailHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header class="k-head">
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h1 class="k-h1 detail">{title}</h1>
      </div>
      <p class="k-sub">{sub}</p>
    </header>
  );
}

function LinkRow({ title, value, onClick, chevron = true, danger }: { title: ComponentChildren; value?: string; onClick: () => void; chevron?: boolean; danger?: boolean }) {
  return (
    <button class="k-btnreset k-lr" onClick={onClick}>
      <span style={{ flex: 1, fontSize: "16px", color: danger ? "#f5f5f7" : undefined }}>{title}</span>
      {value !== undefined && <span class="v">{value}</span>}
      {chevron && <Chevron color="#636366" />}
    </button>
  );
}

function Page({ children }: { children: ComponentChildren }) {
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      {children}
    </div>
  );
}

/** The freshest copy of a task: the optimistic day caches first, then the server copy. */
export function findTask(id: string): Task | undefined {
  for (const k of keysWith("/views/day")) {
    const t = entry<DayView>(k).value.data?.tasks.find((x) => x.id === id);
    if (t) return t;
  }
  return undefined;
}

export function TaskDetail({ id }: { id: string }) {
  const remote = resource<Task>(`/tasks/${id}`).value.data;
  const t = findTask(id) ?? remote;
  if (!t) return <Page>{null}</Page>;
  const edit = () => canEdit() && openSheet("add", { taskId: id });
  const when = t.date ? relDay(t.date, today()).toLowerCase() : "без даты";
  return (
    <Page>
      <DetailHead title={t.title} sub="Задача" />
      <main class="k-main">
        {(t.important || t.fresh) && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {t.important && <span class="k-tag red">Важное</span>}
            {t.fresh && <span class="k-tag">Свежая голова</span>}
          </div>
        )}
        <button class={`k-btn${t.done ? " ghost" : ""}`} onClick={() => toggleTask(t)}>
          {t.done ? "Снять отметку" : "Отметить выполненной"}
        </button>
        <section class="k-card clip">
          <LinkRow title="Когда" value={when} onClick={edit} />
          <LinkRow title="Время" value={t.start_time ?? "нет"} onClick={edit} />
          <LinkRow title="Длительность" value={durLabel(t.duration_min)} onClick={edit} />
          <LinkRow title="Напоминание" value={t.remind_at ?? "нет"} onClick={edit} />
        </section>
        {t.description && (
          <p class="k-cap" style={{ margin: "0 4px", fontSize: "15px", lineHeight: "20px", whiteSpace: "pre-wrap" }}>
            {t.description}
          </p>
        )}
        {t.created_by === "claude" && (
          <div class="k-cap" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 4px" }}>
            <ClaudeLogo size={16} />
            Добавил Claude, {createdLabel(t)}
          </div>
        )}
        <section class="k-card clip">
          <LinkRow title="Изменить" onClick={edit} chevron={false} />
          <LinkRow title="Перенести на завтра" onClick={() => void postponeTask(t)} chevron={false} />
          <LinkRow
            title="Удалить"
            danger
            chevron={false}
            onClick={() => {
              if (!canEdit()) return;
              deleteTask(t);
              pop();
            }}
          />
        </section>
      </main>
    </Page>
  );
}

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const days = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

export function HabitDetail({ id }: { id: string }) {
  const day = resource<DayView>("/views/day").value.data;
  const row: HabitRow | undefined = day?.habits.find((h) => h.id === id);
  const meta: Habit | undefined = resource<Habit[]>("/habits").value.data?.find((h) => h.id === id);
  const month = resource<ReviewView>("/views/review?period=month").value.data;
  const stats = month?.habits.find((h) => h.id === id);
  const name = row?.name ?? meta?.name;
  if (!name) return <Page>{null}</Page>;
  const type = row?.type ?? meta!.type;
  const config = row?.config ?? meta!.config;
  const schedule = row?.schedule ?? meta!.schedule;
  const value = Number(row?.value) || 0;
  const iso = day!.date;
  const edit = () => canEdit() && openSheet("add", { habitId: id });
  const streak = row?.streak ?? stats?.streak ?? 0;

  // Month grid: one square per day of the calendar month; green when the norm was reached.
  const start = month ? parseDate(month.start) : null;
  const lead = start ? (start.getUTCDay() + 6) % 7 : 0;
  const dots = stats?.dots ?? [];
  const counted = dots.filter((s) => s === "done" || s === "missed" || s === "pending").length;
  const done = dots.filter((s) => s === "done").length;
  const trail = (7 - ((lead + dots.length) % 7)) % 7;

  return (
    <Page>
      <DetailHead title={name} sub={`Привычка, ${scheduleLabel(schedule)}`} />
      <main class="k-main">
        <section style={{ padding: "0 4px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <span class="k-lab">Сегодня</span>
          {type === "count" ? (
            <span class="k-n" style={{ fontSize: "56px", lineHeight: "58px", fontWeight: 600, letterSpacing: "-0.04em" }}>
              {value}
              <span style={{ fontSize: "24px", color: "#8e8e93", fontWeight: 500 }}>{` из ${countNorm(config)}`}</span>
            </span>
          ) : (
            <span style={{ fontSize: "28px", lineHeight: "34px", fontWeight: 600, letterSpacing: "-0.02em" }}>
              {type === "bedtime"
                ? bedResult(day!) === "done" ? "Лёг вовремя" : bedResult(day!) === "miss" ? "Лёг позже цели" : "Отметится по сну"
                : row?.status === "done" ? "Сделано" : row?.status === "rest" ? "День отдыха" : "Не отмечено"}
            </span>
          )}
        </section>
        {row && type === "count" && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button class="k-btn" onClick={() => setHabitValue(iso, row, value + countStep(config))}>
              +{countStep(config)}
            </button>
            <button
              class="k-btn ghost"
              style={{ width: "auto", padding: "0 22px" }}
              aria-label="Убрать одну отметку"
              disabled={value <= 0}
              onClick={() => setHabitValue(iso, row, Math.max(0, value - countStep(config)))}
            >
              −{countStep(config)}
            </button>
          </div>
        )}
        {row && type === "check" && (
          <button class={`k-btn${row.value ? " ghost" : ""}`} onClick={() => setHabitValue(iso, row, row.value ? null : true)}>
            {row.value ? "Снять отметку" : "Отметить"}
          </button>
        )}
        {start && (
          <section class="k-card" style={{ padding: "16px 18px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <h2 class="k-h2">{MONTH[start.getUTCMonth()]}</h2>
              <span class="k-cap k-n">
                {done} из {days(counted)}
              </span>
            </div>
            <div class="k-month">
              {WD.map((w) => (
                <span key={w}>{w}</span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <i key={`l${i}`} />
              ))}
              {dots.map((s, i) => {
                const iso2 = addDays(month!.start, i);
                const isToday = iso2 === iso;
                const visible = s !== "future" && s !== "nodata";
                return (
                  <i
                    key={i}
                    title={visible ? `${i + 1} ${MON_GEN[start.getUTCMonth()]}` : undefined}
                    style={{
                      background: !visible ? "transparent" : s === "done" ? "#69ff79" : "rgba(255,255,255,0.08)",
                      boxShadow: isToday ? "0 0 0 1.5px #f5f5f7" : undefined,
                    }}
                  />
                );
              })}
              {Array.from({ length: trail }, (_, i) => (
                <i key={`t${i}`} />
              ))}
            </div>
            <div class="k-cap" style={{ display: "flex", gap: "16px", marginTop: "12px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: 10, height: 10, borderRadius: 2.5, background: "#69ff79" }} />
                {type === "count" ? "норма добрана" : "сделано"}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: 10, height: 10, borderRadius: 2.5, background: "rgba(255,255,255,0.08)" }} />
                нет
              </span>
            </div>
          </section>
        )}
        <section class="k-card k-stats">
          <div class="k-stat">
            <b class="k-n">{days(streak)}</b>
            <span class="k-cap">серия сейчас</span>
          </div>
          <div class="k-stat">
            <b class="k-n">{days(Math.max(stats?.best ?? 0, streak))}</b>
            <span class="k-cap">рекорд</span>
          </div>
        </section>
        {type !== "bedtime" && (
          <section class="k-card clip">
            <LinkRow title="Как часто" value={scheduleLabel(schedule)} onClick={edit} />
            {type === "count" && <LinkRow title="Норма в день" value={String(countNorm(config))} onClick={edit} />}
            <LinkRow title="Напоминание" value={meta?.remind_at ?? "нет"} onClick={edit} />
          </section>
        )}
        <section class="k-card clip">
          <LinkRow
            title="Удалить привычку"
            danger
            chevron={false}
            onClick={() => {
              if (!canEdit()) return;
              deleteHabit({ id, name });
              pop();
            }}
          />
        </section>
      </main>
    </Page>
  );
}
