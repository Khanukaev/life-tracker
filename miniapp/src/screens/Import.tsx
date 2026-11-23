/** «Перенести из старого трекера»: paste or pick the JSON, see a preview (a dry run on the
 * server — exactly what will happen), then import. Re-importing the same file is safe. */

import { useState } from "preact/hooks";
import { Icon, Sec, StackHead } from "../components/ui";
import { ApiError, get, post } from "../lib/api";
import { shortDate } from "../lib/format";
import { haptic } from "../lib/haptic";
import { invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { copy } from "./Claude";

export interface ImportReport {
  dry_run: boolean;
  days: number;
  sleep_nights: number;
  habit_marks: number;
  habits_created: string[];
  habits_reused: string[];
  spheres_created: string[];
  tasks_created: number;
  tasks_updated: number;
  goals_created: number;
  goals_updated: number;
  reviews: number;
  period: [string, string] | null;
  warnings: string[];
}

type Parsed = { ok: true; data: unknown } | { ok: false; error: string };

export function parseExport(text: string): Parsed {
  const t = text.trim();
  if (!t) return { ok: false, error: "Вставь JSON из старого трекера" };
  try {
    const data = JSON.parse(t) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Ожидается JSON-объект" };
    const keys = ["settings", "days", "tasks", "goals"];
    if (!keys.some((k) => k in (data as Record<string, unknown>))) {
      return { ok: false, error: "Это не похоже на экспорт трекера: нет settings, days, tasks или goals" };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Не получается прочитать JSON — скопируй его целиком" };
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}

/** «Скопировать данные (JSON)» — the same layout the import reads, so it is also a backup. */
function ExportCard() {
  const [busy, setBusy] = useState(false);
  const load = async (): Promise<string | null> => {
    setBusy(true);
    try {
      return JSON.stringify(await get<unknown>("/export"), null, 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось. Проверь связь");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const copyJson = async () => {
    const text = await load();
    if (text) await copy(text, "JSON");
  };
  const saveFile = async () => {
    const text = await load();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `life-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    haptic.success();
  };
  return (
    <section>
      <Sec title="Скопировать мои данные" />
      <div class="card" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px" }}>
        <span class="s" style={{ fontSize: "15px", lineHeight: "21px" }}>
          Всё в одном JSON: привычки, дни, сон, задачи, цели и разборы. Подходит как резервная копия и для переноса в другой аккаунт — через этот же экран.
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn lg" style={{ flex: 1 }} disabled={busy} onClick={() => void copyJson()}>
            Скопировать JSON
          </button>
          <button class="btn lg" style={{ flex: 1 }} disabled={busy} onClick={() => void saveFile()}>
            Сохранить файл
          </button>
        </div>
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div class="row">
      <span class="t" style={{ flex: 1 }}>{label}</span>
      <span class="s mono">{value}</span>
    </div>
  );
}

function Report({ r }: { r: ImportReport }) {
  return (
    <div class="card list">
      {r.period && <Line label="Период" value={`${shortDate(r.period[0])} — ${shortDate(r.period[1])}`} />}
      <Line label="Дни" value={`${r.days} · сон ${r.sleep_nights}`} />
      <Line label="Отметки привычек" value={String(r.habit_marks)} />
      <Line
        label="Привычки"
        value={`${r.habits_created.length} новых${r.habits_reused.length ? ` · ${r.habits_reused.length} уже есть` : ""}`}
      />
      <Line label="Задачи" value={`${r.tasks_created} новых${r.tasks_updated ? ` · ${r.tasks_updated} обновится` : ""}`} />
      <Line label="Цели" value={`${r.goals_created} новых${r.goals_updated ? ` · ${r.goals_updated} обновится` : ""}`} />
      {r.reviews > 0 && <Line label="Разборы" value={String(r.reviews)} />}
      {r.spheres_created.length > 0 && <Line label="Сферы" value={r.spheres_created.join(", ")} />}
    </div>
  );
}

export function ImportScreen() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    const parsed = parseExport(text);
    if (!parsed.ok) {
      setError(parsed.error);
      haptic.error();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await post<ImportReport>(`/import${dryRun ? "?dry_run=true" : ""}`, parsed.data);
      if (dryRun) {
        setPreview(r);
      } else {
        setDone(r);
        setPreview(null);
        setText("");
        haptic.success();
        invalidate("/"); // every screen may have changed
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не получилось. Проверь связь");
      haptic.error();
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast("Файл больше 20 МБ");
    void file.text().then((t) => {
      setText(t);
      setPreview(null);
      setError(null);
    });
  };

  return (
    <div class="page">
      <StackHead back="Профиль" title="Данные" />
      <main class="main" style={{ paddingTop: "12px" }}>
        {done ? (
          <>
            <div class="note" style={{ alignItems: "center" }}>
              <Icon name="check" size={22} style={{ color: "var(--accent)" }} />
              <span class="s" style={{ fontSize: "15px", lineHeight: "21px", color: "var(--soft)" }}>
                Готово: {plural(done.days, "день", "дня", "дней")} истории, {plural(done.habits_created.length, "новая привычка", "новые привычки", "новых привычек")},{" "}
                {plural(done.tasks_created, "задача", "задачи", "задач")} и {plural(done.goals_created, "цель", "цели", "целей")} перенесены.
              </span>
            </div>
            <Report r={done} />
            <button class="btn lg" onClick={() => setDone(null)}>
              Перенести ещё файл
            </button>
          </>
        ) : (
          <>
            <ExportCard />

            <section>
              <Sec title="Перенести из старого трекера или копии" />
              <div class="card" style={{ padding: "16px" }}>
                <ol class="steps-list">
                  <li>Открой старый трекер → карточка <b>«Данные и Claude»</b>.</li>
                  <li>Нажми <b>«Скопировать данные (JSON)»</b>.</li>
                  <li>Вставь сюда или выбери сохранённый файл .json. Копия из этого приложения тоже подходит.</li>
                </ol>
                <p class="s" style={{ margin: "12px 0 0" }}>
                  Данные добавятся к текущим, ничего не удалится. Повторный перенос того же файла ничего не задвоит.
                </p>
              </div>
            </section>

            <section>
              <Sec title="JSON" end={<label class="link" style={{ cursor: "pointer" }}>Выбрать файл<input type="file" accept="application/json,.json" hidden onChange={pickFile} /></label>} />
              <textarea
                class="card mono"
                aria-label="JSON из старого трекера"
                placeholder='{"settings": …, "days": …, "tasks": …, "goals": …}'
                value={text}
                onInput={(e) => {
                  setText((e.target as HTMLTextAreaElement).value);
                  setPreview(null);
                  setError(null);
                }}
                spellcheck={false}
                style={{ width: "100%", minHeight: "140px", padding: "14px", fontSize: "13px", lineHeight: "18px", resize: "vertical", color: "var(--text)" }}
              />
              {error && (
                <div class="note" role="alert" style={{ marginTop: "10px" }}>
                  <Icon name="warn" size={20} style={{ color: "var(--accent)" }} />
                  <span class="s" style={{ fontSize: "15px", color: "var(--soft)" }}>{error}</span>
                </div>
              )}
            </section>

            {preview ? (
              <section>
                <Sec title="Что перенесётся" />
                <Report r={preview} />
                {preview.warnings.map((w) => (
                  <div class="s" key={w} style={{ marginTop: "8px" }}>⚠︎ {w}</div>
                ))}
                <button class="btn acc lg" style={{ width: "100%", marginTop: "14px" }} disabled={busy} onClick={() => void run(false)}>
                  {busy ? "Переношу…" : "Перенести"}
                </button>
              </section>
            ) : (
              <button class="btn acc lg" disabled={busy || !text.trim()} onClick={() => void run(true)}>
                {busy ? "Проверяю…" : "Проверить"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
