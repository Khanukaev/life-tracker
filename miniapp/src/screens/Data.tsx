/** Profile → «Выгрузить мои данные» (export, also a backup) and the import from the old
 * tracker: paste or pick the JSON, see a dry-run preview, then import. Safe to repeat. */

import { useState } from "preact/hooks";
import { ApiError, get, post } from "../lib/api";
import { shortDate, plural } from "../lib/format";
import { haptic } from "../lib/haptic";
import { canEdit } from "../lib/net";
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
  tasks_created: number;
  tasks_updated: number;
  goals_skipped: number;
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

const n = (k: number, one: string, few: string, many: string) => `${k} ${plural(k, one, few, many)}`;

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div class="k-lr">
      <span style={{ flex: 1, fontSize: "16px" }}>{label}</span>
      <span class="v">{value}</span>
    </div>
  );
}

function Report({ r }: { r: ImportReport }) {
  return (
    <section class="k-card clip">
      {r.period && <Line label="Период" value={`${shortDate(r.period[0])} — ${shortDate(r.period[1])}`} />}
      <Line label="Дни" value={`${r.days} · сон ${r.sleep_nights}`} />
      <Line label="Отметки привычек" value={String(r.habit_marks)} />
      <Line label="Привычки" value={`${r.habits_created.length} новых${r.habits_reused.length ? ` · ${r.habits_reused.length} уже есть` : ""}`} />
      <Line label="Задачи" value={`${r.tasks_created} новых${r.tasks_updated ? ` · ${r.tasks_updated} обновится` : ""}`} />
      {r.reviews > 0 && <Line label="Разборы" value={String(r.reviews)} />}
    </section>
  );
}

function Export() {
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
  const save = async () => {
    const text = await load();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `keel-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    haptic.success();
  };
  return (
    <section class="k-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 class="k-h2">Выгрузить мои данные</h2>
      <p class="k-lead" style={{ fontSize: "15px", lineHeight: "21px" }}>
        Всё в одном JSON: привычки, дни, сон, задачи, заметки и разборы. Подходит как резервная копия и для переноса в другой аккаунт — через этот же экран.
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button class="k-btn" disabled={busy} onClick={() => void load().then((t) => (t ? copy(t, "JSON") : undefined))}>
          Скопировать
        </button>
        <button class="k-btn ghost" disabled={busy} onClick={() => void save()}>
          Сохранить файл
        </button>
      </div>
    </section>
  );
}

export function DataScreen() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    if (!canEdit()) return;
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
      if (dryRun) setPreview(r);
      else {
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

  const pick = (e: Event) => {
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
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <header class="k-head">
        <h1 class="k-h1 detail">Данные</h1>
        <p class="k-sub">Копия и перенос из старого трекера</p>
      </header>
      <main class="k-main">
        <Export />
        {done ? (
          <>
            <section class="k-card" style={{ padding: "16px 18px" }}>
              <p class="k-lead" style={{ margin: 0, fontSize: "15px", lineHeight: "21px" }}>
                Готово: {n(done.days, "день", "дня", "дней")} истории, {n(done.habits_created.length, "новая привычка", "новые привычки", "новых привычек")} и{" "}
                {n(done.tasks_created, "задача", "задачи", "задач")} перенесены.
              </p>
            </section>
            <Report r={done} />
            <button class="k-btn ghost" onClick={() => setDone(null)}>
              Перенести ещё файл
            </button>
          </>
        ) : (
          <section class="k-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h2 class="k-h2">Перенести из старого трекера</h2>
            <p class="k-lead" style={{ margin: 0, fontSize: "15px", lineHeight: "21px" }}>
              В старом трекере открой «Данные и Claude» → «Скопировать данные (JSON)» и вставь сюда или выбери файл. Данные добавятся к текущим, повторный перенос ничего не задвоит. Цели старого трекера не переносятся.
            </p>
            <textarea
              class="k-ta"
              aria-label="JSON из старого трекера"
              placeholder='{"settings": …, "days": …, "tasks": …}'
              value={text}
              spellcheck={false}
              style={{ minHeight: 120, fontFamily: "var(--mono)", fontSize: "13px", lineHeight: "18px" }}
              onInput={(e) => {
                setText((e.target as HTMLTextAreaElement).value);
                setPreview(null);
                setError(null);
              }}
            />
            <label class="k-btnreset k-cap" style={{ fontSize: "15px", color: "#aeaeb2", cursor: "pointer" }}>
              Выбрать файл .json
              <input type="file" accept="application/json,.json" hidden onChange={pick} />
            </label>
            {error && (
              <p role="alert" class="k-cap" style={{ margin: 0, color: "#ff6961", fontSize: "14px" }}>
                {error}
              </p>
            )}
            {preview && (
              <>
                <span class="k-lab">Что перенесётся</span>
                <Report r={preview} />
                {preview.warnings.map((w) => (
                  <p key={w} class="k-cap" style={{ margin: 0 }}>
                    ⚠︎ {w}
                  </p>
                ))}
              </>
            )}
            <button class="k-btn" disabled={busy || !text.trim()} onClick={() => void run(!preview)}>
              {busy ? "Секунду…" : preview ? "Перенести" : "Проверить"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
