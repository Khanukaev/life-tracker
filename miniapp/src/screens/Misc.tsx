/** First run (Onboard0), the «План» and «Итоги» placeholders, and the Profile hub. */

import type { ComponentChildren } from "preact";
import { Chevron, ClaudeLogo } from "../components/icons";
import { patch } from "../lib/api";
import { haptic } from "../lib/haptic";
import { push, type ScreenName } from "../lib/router";
import { mutate, resource, setData } from "../lib/store";
import type { Me } from "../lib/types";

function Feature({ icon, title, text }: { icon: ComponentChildren; title: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
      <span style={{ width: 44, height: 44, flex: "none", borderRadius: 14, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "2px" }}>
        <span style={{ fontSize: "17px", fontWeight: 600 }}>{title}</span>
        <span class="k-cap" style={{ fontSize: "15px", lineHeight: "20px" }}>
          {text}
        </span>
      </span>
    </div>
  );
}

/** The Mini App opens only from the bot after /start: the name and the right to write are
 * already there, so nothing is asked — one screen and «Начать». */
export function Onboarding() {
  const start = () => {
    haptic.success();
    void mutate({
      apply: () => setData<Me>("/me", (m) => ({ ...m, onboarded: true })),
      request: () => patch("/me", { onboarded: true }),
    });
  };
  return (
    <div class="k-page" style={{ minHeight: "100vh", paddingBottom: "120px" }}>
      <div class="k-bg" aria-hidden="true" />
      <header class="k-head" />
      <main class="k-main">
        <section style={{ padding: "28px 4px 0", display: "flex", flexDirection: "column", gap: "14px" }}>
          <h1 style={{ margin: 0, fontSize: "36px", lineHeight: "42px", fontWeight: 700, letterSpacing: "-0.03em" }}>Здесь твой день</h1>
          <p style={{ margin: "-6px 0 0", fontSize: "17px", lineHeight: "24px", color: "#d1d1d6", maxWidth: "340px" }}>
            Привычки, дела и сон в одном месте. Без лишнего.
          </p>
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: "22px", padding: "18px 4px 0" }}>
          <Feature
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 22, height: 22, fill: "none", stroke: "#69ff79", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                <circle cx="12" cy="12" r="8.5" />
                <path d="M8.5 12.2l2.4 2.3 4.6-4.8" />
              </svg>
            }
            title="Отмечай одним касанием"
            text="Привычки и задачи на сегодня — в одном списке"
          />
          <Feature
            icon={
              <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 20, height: 20, fill: "#c9b8ff" }}>
                <path d="M9.2 1.2 3.4 9.1h3.9L6.6 14.8l5.9-8H8.6z" />
              </svg>
            }
            title="Знай свою энергию"
            text="По сну посчитаем, когда у тебя пик, а когда лучше отдохнуть"
          />
          <Feature
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 22, height: 22, fill: "none", stroke: "#8fa6e0", strokeWidth: 2, strokeLinecap: "round" }}>
                <path d="M5 20v-6M12 20V5M19 20v-10" />
              </svg>
            }
            title="Смотри итоги"
            text="Неделя и месяц: что получается и что проседает"
          />
          <Feature
            icon={<ClaudeLogo size={22} />}
            title="Подключи Claude, если хочешь"
            text="Он посмотрит твои дела, сон и подскажет, как сделать неделю легче и быть продуктивнее. Это можно сделать позже в профиле"
          />
        </div>
      </main>
      <div style={{ position: "fixed", left: "20px", right: "20px", bottom: "max(24px, calc(var(--safe-bottom) + 16px))", zIndex: 2 }}>
        <button class="k-save" style={{ width: "100%" }} onClick={start}>
          Начать
        </button>
      </div>
    </div>
  );
}

/** «План» and «Итоги» are built in part 3 of the redesign. */
export function Stub({ title, text }: { title: string; text: string }) {
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <header class="k-head">
        <h1 class="k-h1">{title}</h1>
      </header>
      <main class="k-main">
        <section class="k-sum">
          <p class="k-motto">{text}</p>
        </section>
      </main>
    </div>
  );
}

/** Profile hub until ProfileGlass is built: leads to the screens that already exist. */
export function ProfileScreen() {
  const me = resource<Me>("/me").value.data;
  const row = (name: ScreenName, title: string, sub?: string, icon?: ComponentChildren) => (
    <button class="k-btnreset k-lr" onClick={() => push(name)}>
      {icon}
      <span class="t">
        <span>{title}</span>
        {sub && <span class="k-cap">{sub}</span>}
      </span>
      <Chevron color="#636366" />
    </button>
  );
  return (
    <div class="k-page">
      <div class="k-bg" aria-hidden="true" />
      <header class="k-head">
        <h1 class="k-h1 detail">{me?.first_name ?? "Профиль"}</h1>
        <p class="k-sub">Профиль и настройки</p>
      </header>
      <main class="k-main">
        <section class="k-card clip">{row("claude", "Claude", "Коннектор, ключ доступа и разборы", <ClaudeLogo />)}</section>
        <section class="k-card clip">
          {row("settings", "Напоминания и отклик", "Сообщения бота, вибрация, часовой пояс")}
          {row("norms", "Сон", "Цель отбоя и сколько нужно спать")}
          {row("import", "Импорт и экспорт", "Перенос данных и копия в JSON")}
        </section>
      </main>
    </div>
  );
}
