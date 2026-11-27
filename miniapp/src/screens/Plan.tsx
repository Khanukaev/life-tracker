/** «План»: only what is ahead — overdue, the next days, «Дальше», no date (PlanGlass). */

import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { CHECK, Chevron } from "../components/icons";
import { PLAN_KEY, toggleTask } from "../lib/actions";
import { addDays, parseDate, plural } from "../lib/format";
import { canEdit } from "../lib/net";
import { openSheet, push } from "../lib/router";
import { refresh, resource } from "../lib/store";
import type { PlanDay, PlanView, Task } from "../lib/types";
import { OfflineBanner, PageHead, ResultsError, SkCard } from "./Results";
import { online } from "../lib/net";

const WD = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const WD_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WD_ACC = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const SHOWN = 7;

/** Tasks checked off right here. The server drops done tasks from «Просрочено» and «Без
 * даты», so without this a checked row would vanish a second later and the tap would look
 * like it did nothing. They stay in place, green, until the user leaves «План». */
const checkedHere = signal<Record<string, Task>>({});

function tick(t: Task) {
  const next = { ...checkedHere.value };
  if (t.done) delete next[t.id];
  else next[t.id] = { ...t, done: true };
  checkedHere.value = next;
  toggleTask(t);
}

/** Server list + rows checked here, in their original place (by date, then title). */
function withChecked(list: Task[], keep: (t: Task) => boolean): Task[] {
  const ids = new Set(list.map((t) => t.id));
  const extra = Object.values(checkedHere.value).filter((t) => !ids.has(t.id) && keep(t));
  return [...list.map((t) => (checkedHere.value[t.id] ? { ...t, done: true } : t)), ...extra].sort(
    (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.created_at.localeCompare(b.created_at),
  );
}

export function dayTitle(iso: string, today: string): string {
  const d = parseDate(iso);
  if (iso === addDays(today, 1)) return `Завтра, ${WD_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`;
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()}`;
}

/** "была на пятницу, 20 ноября". */
export function wasOn(iso: string): string {
  const d = parseDate(iso);
  return `была на ${WD_ACC[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

function counts(d: PlanDay): string {
  const t = d.tasks.length;
  return `${t} ${plural(t, "дело", "дела", "дел")} · ${d.habits} ${plural(d.habits, "привычка", "привычки", "привычек")}`;
}

function meta(t: Task): string {
  const parts: string[] = [];
  if (t.important) parts.push("важное");
  if (t.fresh) parts.push("свежая голова");
  if (!parts.length && t.start_time && !t.important) parts.push(t.start_time);
  if (!parts.length && t.description) parts.push(t.description.split("\n")[0]!);
  if (t.created_by === "claude") parts.push("поставил Claude");
  return parts.join(", ");
}

export function PlanRow({ t, sub, action, sep }: { t: Task; sub?: string; action?: string; sep?: boolean }) {
  const s = sub ?? meta(t);
  return (
    <div class="k-prow" style={sep ? { borderTop: "1px solid rgba(255,255,255,0.09)" } : undefined}>
      <button
        class="k-btnreset k-ptick"
        aria-label={`${t.done ? "Снять отметку" : "Отметить"}: ${t.title}`}
        onClick={() => tick(t)}
      >
        <span class={`k-pdot${t.important && !t.done ? " alert" : ""}${t.done ? " done" : ""}`}>
          {t.done && (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={CHECK} />
            </svg>
          )}
        </span>
      </button>
      <button class="k-btnreset" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }} onClick={() => push("task", { id: t.id })}>
        <span class="t" style={{ color: t.done ? "#8e8e93" : undefined }}>{t.title}</span>
        {s && (
          <span class="k-cap" style={{ color: t.important && !t.done && !sub ? "#ff6961" : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s}
          </span>
        )}
      </button>
      {action ? (
        <button
          class="k-btnreset k-pchip"
          onClick={() => {
            if (!canEdit()) return;
            openSheet("assign", { id: t.id });
          }}
        >
          {action}
        </button>
      ) : t.important && t.start_time && !t.done ? (
        <span class="k-n" style={{ fontSize: "14px", color: "#ff453a", fontWeight: 600, flex: "none" }}>
          до {t.start_time}
        </span>
      ) : null}
    </div>
  );
}

function Card({ title, end, children }: { title: string; end: string; children: preact.ComponentChildren }) {
  return (
    <section class="k-card clip">
      <div class="k-cardhead">
        <h2 class="k-h2">{title}</h2>
        <span class="k-n">{end}</span>
      </div>
      {children}
    </section>
  );
}

function Day({ d, today }: { d: PlanDay; today: string }) {
  if (!d.tasks.length) {
    return (
      <section class="k-card" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "16px 18px" }}>
        <h2 class="k-h2">{dayTitle(d.date, today)}</h2>
        <span class="k-cap" style={{ fontSize: "14px" }}>
          {d.habits ? "только привычки" : "свободно"}
        </span>
      </section>
    );
  }
  return (
    <Card title={dayTitle(d.date, today)} end={counts(d)}>
      {d.tasks.map((t, i) => (
        <PlanRow key={t.id} t={t} sep={i > 0} />
      ))}
    </Card>
  );
}

export function PlanScreen() {
  const e = resource<PlanView>(PLAN_KEY).value;
  const v = e.data;
  const [more, setMore] = useState(false);
  useEffect(() => () => void (checkedHere.value = {}), []);
  let body;
  if (!v) {
    body = e.error && !e.loading && online.value ? <ResultsError retry={() => void refresh(PLAN_KEY)} what="план" /> : <SkCard />;
  } else {
    const today = v.today;
    const overdue = withChecked(v.overdue, (t) => !!t.date && t.date < today);
    const inbox = withChecked(v.inbox, (t) => !t.date);
    const near = v.days.slice(0, SHOWN);
    const far = v.days.slice(SHOWN).filter((d) => d.tasks.length);
    const farN = far.reduce((a, d) => a + d.tasks.length, 0);
    const empty = !overdue.length && !inbox.length && !v.days.some((d) => d.tasks.length);
    const last = far[far.length - 1];
    body = empty ? (
      <>
        <section class="k-sum" style={{ gap: "10px" }}>
          <p class="k-motto">Впереди пока пусто</p>
          <p class="k-sumtext">Здесь будут дела на другие дни и всё, что без даты. Добавь дело на завтра кнопкой «+».</p>
        </section>
        {near.slice(0, 2).map((d) => (
          <Day key={d.date} d={d} today={v.today} />
        ))}
      </>
    ) : (
      <>
        {overdue.length > 0 && (
          <Card title="Просрочено" end={String(overdue.filter((t) => !t.done).length)}>
            {overdue.map((t, i) => (
              <PlanRow key={t.id} t={t} sub={wasOn(t.date!)} action={t.done ? undefined : "На сегодня"} sep={i > 0} />
            ))}
          </Card>
        )}
        {near.map((d) => (
          <Day key={d.date} d={d} today={v.today} />
        ))}
        {farN > 0 && !more && (
          <button class="k-btnreset k-card k-more" onClick={() => setMore(true)}>
            <span style={{ flex: 1 }}>
              Дальше · ещё {farN} {plural(farN, "дело", "дела", "дел")} до {parseDate(last!.date).getUTCDate()} {MON[parseDate(last!.date).getUTCMonth()]}
            </span>
            <Chevron color="#636366" />
          </button>
        )}
        {more && far.map((d) => <Day key={d.date} d={d} today={v.today} />)}
        {inbox.length > 0 && (
          <Card title="Без даты" end={String(inbox.filter((t) => !t.done).length)}>
            {inbox.map((t, i) => (
              <PlanRow key={t.id} t={t} sub={t.description ? t.description.split("\n")[0] : ""} action={t.done ? undefined : "Назначить"} sep={i > 0} />
            ))}
          </Card>
        )}
      </>
    );
  }
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <PageHead title="План" sub="Что впереди" />
      <main class="k-main">
        {!online.value && <OfflineBanner text="Нет связи. Показываю последний план — переносить можно будет, когда появится сеть" />}
        {body}
      </main>
    </div>
  );
}
