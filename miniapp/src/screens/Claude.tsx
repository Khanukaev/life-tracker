/** Claude (ClaudeConnect / ClaudeToken / Claude / ClaudeReview): the user's own Claude
 * connects to Keel as a connector, writes reviews and plans; everything it changed is listed. */

import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { Chevron, ClaudeLogo } from "../components/icons";
import { Markdown, splitSummary as split } from "../components/Markdown";
import { ApiError, del, post } from "../lib/api";
import { addDays, parseDate, plural } from "../lib/format";
import { haptic } from "../lib/haptic";
import { canEdit } from "../lib/net";
import { pop, push } from "../lib/router";
import { invalidate, resource } from "../lib/store";
import { openLink } from "../lib/telegram";
import { toast } from "../lib/toast";
import type { McpIssued, McpStatus, Review } from "../lib/types";
import { claudeAt } from "./Results";

const CLAUDE_URL = "https://claude.ai";
const CONNECTORS_URL = "https://claude.ai/settings/connectors";
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export const SCHEDULE_PROMPT =
  "Каждое воскресенье вечером посмотри мой Keel: итоги недели, сон, привычки, задачи и мою заметку о неделе. " +
  "Напиши разбор: что получилось, что мешает и что сделать на следующей неделе — коротко и по делу. " +
  "Сохрани его в Keel через save_review (kind: week).";

/** The token exists in plain text only in the issue response: kept in memory, never cached. */
const issued = signal<McpIssued | null>(null);

export async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea"); // old webviews
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  haptic.success();
  toast(`${what} скопирован`, { icon: "check" });
}

async function issue(replace: boolean): Promise<void> {
  if (!canEdit()) return;
  if (replace && !confirm("Старый ключ перестанет работать, и коннектор в Claude нужно будет обновить. Выдать новый?")) return;
  try {
    issued.value = await post<McpIssued>("/mcp/token");
    haptic.success();
    invalidate("/mcp/token");
    push("claude-token");
  } catch (e) {
    toast(e instanceof ApiError ? e.message : "Не получилось. Проверь связь");
  }
}

function Step({ n, title, text, sep }: { n: number; title: string; text: string; sep?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "14px", padding: "14px 18px", borderTop: sep ? "1px solid rgba(255,255,255,0.09)" : undefined }}>
      <span class="k-n" style={{ width: 28, height: 28, flex: "none", borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 600 }}>
        {n}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ fontSize: "16px", fontWeight: 500 }}>{title}</span>
        <span class="k-cap" style={{ fontSize: "14px", lineHeight: "19px" }}>
          {text}
        </span>
      </span>
    </div>
  );
}

function Head({ sub, small, title = "Claude" }: { sub: string; small?: boolean; title?: string }) {
  return (
    <header class="k-head">
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {!small && <ClaudeLogo size={34} />}
        <h1 class={`k-h1${small ? " detail" : ""}`}>{title}</h1>
      </div>
      <p class="k-sub">{sub}</p>
    </header>
  );
}

function Page({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      {children}
    </div>
  );
}

export function reviewTitle(r: Review): string {
  const d = parseDate(r.date);
  if (r.kind === "month") return MON_NOM[d.getUTCMonth()]!;
  if (r.kind === "day") return `День, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  const start = addDays(r.date, -((d.getUTCDay() + 6) % 7));
  const s = parseDate(start);
  const e = parseDate(addDays(start, 6));
  return s.getUTCMonth() === e.getUTCMonth()
    ? `Неделя ${s.getUTCDate()}–${e.getUTCDate()} ${MON[e.getUTCMonth()]}`
    : `Неделя ${s.getUTCDate()} ${MON[s.getUTCMonth()]} – ${e.getUTCDate()} ${MON[e.getUTCMonth()]}`;
}

function Pill({ children, coral }: { children: preact.ComponentChildren; coral?: boolean }) {
  return (
    <span class="k-pill" style={coral ? { background: "rgba(255,138,92,0.22)", color: "#ffc2a8" } : { background: "rgba(255,255,255,0.10)", color: "#d1d1d6" }}>
      {children}
    </span>
  );
}

function Connect() {
  return (
    <Page>
      <Head sub="Не подключён" />
      <main class="k-main">
        <p class="k-lead" style={{ padding: "0 4px", marginTop: "-4px" }}>
          Claude смотрит твои дела, сон и заметки и пишет личные советы: разбор недели, план дня под энергию, ответы на вопросы.
        </p>
        <section class="k-sum claude" style={{ gap: "8px" }}>
          <span class="k-cap">Пример разбора</span>
          <p class="k-sumtext" style={{ color: "#f5f5f7" }}>
            «Ты писал, что пятница самая тяжёлая: пары до вечера. Давай в этот день английский утром, 10 минут — серия не оборвётся. Воду я поставил на 15:00.»
          </p>
        </section>
        <section class="k-card clip">
          <div class="k-cardhead">
            <h2 class="k-h2">Как подключить</h2>
          </div>
          <Step n={1} title="Получи ключ доступа" text="Нажми кнопку ниже — появятся адрес и ключ" />
          <Step n={2} title="Открой claude.ai" text="Настройки → Коннекторы → Добавить свой коннектор" sep />
          <Step n={3} title="Вставь адрес и ключ" text="Готово: в любом чате Claude увидит твой Keel" sep />
        </section>
        <button class="k-btn" onClick={() => void issue(false)}>
          Получить ключ доступа
        </button>
        <p class="k-cap" style={{ margin: "-2px 4px 0", textAlign: "center" }}>
          Ключ можно отозвать в любой момент
        </p>
      </main>
    </Page>
  );
}

function CopyField({ label, value, what }: { label: string; value: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span class="k-cap" style={{ margin: "0 4px" }}>
        {label}
      </span>
      <div class="k-copy">
        <code>{value}</code>
        <button
          style={done ? { background: "rgba(105,255,121,0.18)", color: "#69ff79" } : undefined}
          onClick={() => void copy(value, what).then(() => setDone(true))}
        >
          {done ? "Скопировано" : "Копировать"}
        </button>
      </div>
    </div>
  );
}

/** ClaudeToken: the key is shown once. Losing it means issuing a new one. */
export function ClaudeTokenScreen() {
  const t = issued.value;
  if (!t) {
    return (
      <Page>
        <Head small title="Ключ для Claude" sub="Ключ уже скрыт" />
        <main class="k-main">
          <p class="k-lead" style={{ padding: "0 4px" }}>Ключ показывается только один раз. Если не успел скопировать — выдай новый, старый перестанет работать.</p>
          <button class="k-btn" onClick={() => void issue(true)}>Выдать новый ключ</button>
        </main>
      </Page>
    );
  }
  return (
    <Page>
      <Head small title="Ключ для Claude" sub="Шаг 1 из 3 готов" />
      <main class="k-main">
        <section class="k-card" style={{ padding: "16px 18px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
          <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 22, height: 22, color: "#69ff79", marginTop: 1 }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.5l3 3 5-6" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "16px", fontWeight: 600 }}>Ключ готов</span>
            <span class="k-cap" style={{ fontSize: "14px", lineHeight: "19px" }}>
              Покажем его только сейчас. Скопируй и вставь в claude.ai, пока не закрыл экран.
            </span>
          </span>
        </section>
        <CopyField label="Адрес коннектора" value={t.url} what="Адрес" />
        <CopyField label="Ключ доступа" value={t.token} what="Ключ" />
        <section class="k-card clip">
          <Step n={2} title="Открой claude.ai" text="Настройки → Коннекторы → Добавить свой коннектор" />
          <Step n={3} title="Вставь адрес и ключ" text="И включи коннектор «Keel» в чате" sep />
        </section>
        <button class="k-btn" onClick={() => openLink(CONNECTORS_URL)}>
          Открыть claude.ai
        </button>
        <button
          class="k-btn ghost"
          onClick={() => {
            issued.value = null;
            pop();
          }}
        >
          Я всё вставил
        </button>
        <p class="k-cap" style={{ margin: "-2px 4px 0", textAlign: "center" }}>
          Подключение появится, когда Claude первый раз зайдёт в Keel
        </p>
      </main>
    </Page>
  );
}

export function ClaudeScreen() {
  const status = resource<McpStatus>("/mcp/token").value.data;
  const list = resource<Review[]>("/reviews").value.data ?? [];
  const [q, setQ] = useState("");
  if (!status) return <Page>{null}</Page>;
  if (!status.active) return <Connect />;
  const reviews = list.filter((r) => r.kind !== "plan");
  const latest = reviews.find((r) => r.kind === "week" || r.kind === "month") ?? reviews[0];
  const past = reviews.filter((r) => r !== latest).slice(0, 8);
  const sub = status.last_used_at ? `Подключён. Заходил ${claudeAt(status.last_used_at)}` : "Подключён. Claude ещё не заходил";
  const ask = () => {
    const text = q.trim();
    if (!text) return;
    void copy(text, "Вопрос");
    openLink(`${CLAUDE_URL}/new?q=${encodeURIComponent(text)}`);
  };
  const off = async () => {
    if (!canEdit() || !confirm("Claude больше не сможет заходить в Keel. Отключить?")) return;
    try {
      await del("/mcp/token");
      haptic.success();
      invalidate("/mcp/token");
      toast("Claude отключён", { icon: "check" });
    } catch {
      toast("Не получилось. Проверь связь");
    }
  };
  const [head, ...rest] = latest ? split(latest.text) : ["", ""];
  return (
    <Page>
      <Head sub={sub} />
      <main class="k-main">
        {latest && (
          <button class="k-btnreset k-sum claude" style={{ gap: "10px" }} onClick={() => push("review", { id: latest.id })}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span class="k-lab">{latest.kind === "week" ? "Разбор недели" : latest.kind === "month" ? "Разбор месяца" : "Разбор дня"}</span>
              <span class="k-cap">{claudeAt(latest.at)}</span>
            </span>
            <p style={{ margin: 0, fontSize: "16px", lineHeight: "23px", color: "#f5f5f7" }}>{head}</p>
            {rest[0] && <p style={{ margin: 0, fontSize: "16px", lineHeight: "22px", color: "#d1d1d6" }}>{split(rest[0])[0]}</p>}
            {(latest.used_note || latest.changes.length > 0) && (
              <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {latest.used_note && <span class="k-pill">Учёл твою заметку</span>}
                {latest.changes.length > 0 && (
                  <span class="k-pill" style={{ background: "rgba(255,255,255,0.10)", color: "#d1d1d6" }}>
                    {`Изменил ${latest.changes.length} ${plural(latest.changes.length, "вещь", "вещи", "вещей")}`}
                  </span>
                )}
              </span>
            )}
          </button>
        )}
        <section class="k-card" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <h2 class="k-h2" style={{ fontSize: "20px", lineHeight: "26px" }}>
            Спроси Claude о своих делах
          </h2>
          <label for="k-ask" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Вопрос для Claude
          </label>
          <div class="k-askbox">
            <textarea id="k-ask" rows={2} placeholder="Например: как мне успеть всё в пятницу?" value={q} onInput={(e) => setQ((e.target as HTMLTextAreaElement).value)} />
            <button aria-label="Спросить в Claude" style={q.trim() ? { background: "#f5f5f7", color: "#000" } : undefined} onClick={ask}>
              <svg class="k-ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, strokeWidth: 2 }}>
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          </div>
          <p class="k-cap" style={{ margin: 0 }}>
            Откроется Claude с этим вопросом (он же скопируется). Claude сам посмотрит твои дела, сон и заметки.
          </p>
        </section>
        {past.length > 0 && (
          <section class="k-card clip">
            <div style={{ padding: "16px 18px 6px" }}>
              <h2 class="k-h2">Прошлые разборы</h2>
            </div>
            {past.map((r) => (
              <button key={r.id} class="k-btnreset k-lr" onClick={() => push("review", { id: r.id })}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                  <span style={{ fontSize: "16px" }}>{reviewTitle(r)}</span>
                  <span class="k-cap" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {split(r.text)[0]}
                  </span>
                </span>
                <Chevron color="#636366" />
              </button>
            ))}
          </section>
        )}
        <section class="k-card clip">
          <div style={{ padding: "16px 18px 6px" }}>
            <h2 class="k-h2">Настройки</h2>
          </div>
          <button class="k-btnreset k-lr" onClick={() => void copy(SCHEDULE_PROMPT, "Текст задания")}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "16px" }}>Обновлять разбор</span>
              <span class="k-cap">Скопировать задание для Claude: разбор каждое воскресенье</span>
            </span>
            <Chevron color="#636366" />
          </button>
          <button class="k-btnreset k-lr" onClick={() => void issue(true)}>
            <span style={{ flex: 1, fontSize: "16px" }}>Выдать новый токен</span>
            <Chevron color="#636366" />
          </button>
          <button class="k-btnreset k-lr" onClick={() => void off()}>
            <span style={{ flex: 1, fontSize: "16px" }}>Отключить Claude</span>
          </button>
        </section>
      </main>
    </Page>
  );
}

const KIND_TITLE = { week: "Разбор недели", month: "Разбор месяца", day: "Разбор дня", plan: "План дня" } as const;

export function ClaudeReviewScreen({ id }: { id: string }) {
  const r = resource<Review>(`/reviews/${id}`).value.data;
  if (!r) return <Page>{null}</Page>;
  const [head, rest] = split(r.text);
  const sub = r.kind === "week" ? reviewTitle(r).replace(/^Неделя /, "") : r.kind === "month" ? reviewTitle(r) : reviewTitle(r).replace(/^День, /, "");
  return (
    <Page>
      <Head small title={KIND_TITLE[r.kind]} sub={sub} />
      <main class="k-main">
        <section class="k-sum claude" style={{ gap: "10px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ClaudeLogo />
            <span class="k-cap">Claude, {claudeAt(r.at)}</span>
          </span>
          <p class="k-sumtext" style={{ color: "#f5f5f7", fontSize: "17px", lineHeight: "24px" }}>
            {head}
          </p>
          {r.used_note && (
            <span>
              <Pill coral>Учёл твою заметку</Pill>
            </span>
          )}
        </section>
        {rest && (
          <section class="k-card k-review" style={{ padding: "16px 18px" }}>
            <Markdown text={rest} />
          </section>
        )}
        {r.changes.length > 0 && (
          <section class="k-card clip">
            <div class="k-cardhead">
              <h2 class="k-h2">Что Claude изменил</h2>
            </div>
            {r.changes.map((c, i) => (
              <div key={i} class="k-lr">
                <ClaudeLogo size={16} />
                <span style={{ flex: 1, fontSize: "15px" }}>{c}</span>
              </div>
            ))}
          </section>
        )}
        <button class="k-btn ghost" onClick={() => openLink(`${CLAUDE_URL}/new?q=${encodeURIComponent(`Расскажи подробнее про ${KIND_TITLE[r.kind].toLowerCase()} (${sub}) в Keel.`)}`)}>
          Спросить Claude об этом
        </button>
      </main>
    </Page>
  );
}
