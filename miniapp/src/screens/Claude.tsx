/** «Подключить Claude» and «Разборы»: the user's own Claude works with the tracker
 * through the MCP server; its reviews come back here. */

import type { CSSProperties } from "preact";
import { useState } from "preact/hooks";
import { Markdown } from "../components/Markdown";
import { Icon, Sec, StackHead } from "../components/ui";
import { ApiError, del, post } from "../lib/api";
import { relDay } from "../lib/format";
import { haptic } from "../lib/haptic";
import { invalidate, resource } from "../lib/store";
import { toast } from "../lib/toast";
import type { DayView, McpIssued, McpStatus, Review } from "../lib/types";

export const SCHEDULE_PROMPT =
  "Каждый день в 21:00 посмотри мой «Трекер жизни» и разбери день: рейтинг, сон и энергию, " +
  "привычки и задачи. Отметь, что получилось, где просел и почему, и дай 1–2 конкретных " +
  "совета на завтра. Сохрани разбор в трекер через save_review (kind: day).";

export async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Old webviews: fall back to a hidden textarea + execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  haptic.success();
  toast(`${what} скопирован`);
}

function when(iso: string | null): string {
  if (!iso) return "ещё не использовался";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function CopyRow({ label, value, what }: { label: string; value: string; what: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span class="s">{label}</span>
      <div style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
        <div class="secret" style={{ flex: 1 }}>{value}</div>
        <button class="btn" aria-label={`Скопировать: ${what}`} onClick={() => void copy(value, what)}>
          Копировать
        </button>
      </div>
    </div>
  );
}

export function ClaudeScreen() {
  const status = resource<McpStatus>("/mcp/token").value.data;
  // The token exists in plain text only in this response; it is kept in memory, never cached.
  const [issued, setIssued] = useState<McpIssued | null>(null);
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    if (status?.active && !confirm("Старый токен перестанет работать. Перевыпустить?")) return;
    setBusy(true);
    try {
      const t = await post<McpIssued>("/mcp/token");
      setIssued(t);
      setShown(true);
      haptic.success();
      invalidate("/mcp/token");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось. Проверь связь");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirm("Отключить Claude? Токен перестанет работать сразу.")) return;
    try {
      await del("/mcp/token");
      setIssued(null);
      haptic.warning();
      toast("Claude отключён");
      invalidate("/mcp/token");
    } catch {
      toast("Не получилось. Проверь связь");
    }
  };

  const url = issued?.url ?? status?.url ?? "";
  const connected = !!(issued || status?.active);
  return (
    <div class="page">
      <StackHead back="Профиль" title="Подключить Claude" />
      <main class="main" style={{ paddingTop: "12px" }}>
        <div class="note" data-motion="enter" style={{ alignItems: "center" }}>
          <Icon name="spark" size={22} style={{ color: "var(--accent)" }} />
          <span class="s" style={{ fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>
            Твой Claude сможет смотреть отметки, сон, энергию и задачи, отмечать привычки, ставить задачи и присылать сюда разборы.
            Видит он только твои данные.
          </span>
        </div>

        <section>
          <Sec title="Адрес и токен" end={connected ? <span style={{ color: "var(--green, #30d158)" }}>подключено</span> : undefined} />
          <div class="card" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px" }}>
            {url && <CopyRow label="Адрес MCP-сервера" value={url} what="Адрес" />}

            {issued ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span class="s">Токен — сохрани сейчас, второй раз его не показать</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <div class={`secret${shown ? "" : " masked"}`} style={{ flex: 1 }}>
                    {shown ? issued.token : `${issued.prefix}••••••••••••••••`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button class="btn" style={{ flex: 1 }} onClick={() => setShown(!shown)}>
                    {shown ? "Скрыть" : "Показать"}
                  </button>
                  <button class="btn acc" style={{ flex: 1 }} onClick={() => void copy(issued.token, "Токен")}>
                    Копировать
                  </button>
                </div>
              </div>
            ) : status?.active ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span class="s">Токен</span>
                <div class="secret masked">{status.prefix}••••••••••••••••</div>
                <span class="s">
                  Использовался: {when(status.last_used_at)}. Сам токен хранится только в виде хеша — показать его снова нельзя. Потерял — перевыпусти.
                </span>
              </div>
            ) : (
              <span class="s" style={{ fontSize: "15px" }}>Токена пока нет. Выпусти его — он понадобится в Claude.</span>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <button class="btn acc lg" style={{ flex: 1 }} disabled={busy || !status} onClick={() => void issue()}>
                {connected ? "Перевыпустить токен" : "Выпустить токен"}
              </button>
              {connected && (
                <button class="btn lg" onClick={() => void revoke()}>
                  Отключить
                </button>
              )}
            </div>
          </div>
        </section>

        <section>
          <Sec title="Как подключить" />
          <div class="card" style={{ padding: "16px" }}>
            <ol class="steps-list">
              <li>Открой Claude → <b>Настройки → Коннекторы</b> → <b>Добавить свой коннектор</b> (Add custom connector).</li>
              <li>Название — «Трекер жизни», адрес — <b>адрес MCP-сервера</b> выше.</li>
              <li>
                В разделе <b>Request headers</b> добавь заголовок <b>Authorization</b> со значением <b>Bearer</b> и токеном через пробел.
              </li>
              <li>Сохрани и включи коннектор в чате. Попроси: «посмотри мой трекер и разбери день».</li>
              <li>Разборы появятся здесь, в «Разборах», и по кнопке ✦ на экране «День».</li>
            </ol>
            <p class="s" style={{ margin: "12px 0 0" }}>Токен можно выпустить и в боте командой /connect.</p>
          </div>
        </section>

        <section>
          <Sec title="Разбор каждый вечер" />
          <div class="card" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px" }}>
            <span class="s" style={{ fontSize: "15px", lineHeight: "21px" }}>
              Создай в Claude запланированную задачу с этим текстом — и разбор будет приходить сам:
            </span>
            <div class="secret" style={{ fontFamily: "inherit", fontSize: "15px", lineHeight: "21px", userSelect: "text" }}>
              {SCHEDULE_PROMPT}
            </div>
            <button class="btn lg" onClick={() => void copy(SCHEDULE_PROMPT, "Текст")}>
              Скопировать текст задачи
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ReviewCard({ r, today }: { r: Review; today?: string }) {
  const label = r.kind === "week" ? "Неделя" : today ? relDay(r.date, today) : r.date;
  return (
    <article class="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span class="t" style={{ fontWeight: 600 }}>{label}</span>
        <span class="tag">{r.by === "me" ? "Ты" : "Claude"}</span>
      </div>
      <Markdown text={r.text} />
    </article>
  );
}

export function ReviewsScreen() {
  const reviews = resource<Review[]>("/reviews").value;
  const today = resource<DayView>("/views/day").value.data?.today;
  const list = reviews.data;
  return (
    <div class="page">
      <StackHead back="Профиль" title="Разборы" />
      <main class="main" style={{ paddingTop: "12px" }}>
        {list && list.length === 0 && (
          <div class="note" style={{ alignItems: "center" }}>
            <Icon name="spark" size={22} style={{ color: "var(--accent)" }} />
            <span class="s" style={{ fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>
              Пока пусто. Подключи Claude и попроси разобрать день — разбор сохранится здесь.
            </span>
          </div>
        )}
        {list?.map((r, i) => (
          <div key={r.id} data-motion={i < 4 ? "enter" : "reveal"} style={{ "--i": i } as CSSProperties}>
            <ReviewCard r={r} today={today} />
          </div>
        ))}
      </main>
    </div>
  );
}
