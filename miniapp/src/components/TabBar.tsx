import { haptic } from "../lib/haptic";
import { goTab, openSheet, tab, type Tab } from "../lib/router";
import { Icon } from "./ui";

const LEFT: [Tab, string, string][] = [
  ["day", "День", "day"],
  ["now", "Сейчас", "bolt"],
];
const RIGHT: [Tab, string, string][] = [
  ["review", "Итоги", "stats"],
  ["profile", "Профиль", "person"],
];

export function TabBar() {
  const item = ([id, label, icon]: [Tab, string, string]) => (
    <button key={id} class={`tab${tab.value === id ? " on" : ""}`} aria-current={tab.value === id} onClick={() => goTab(id)}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
  return (
    <div class="tabbar-wrap">
      <nav class="tabbar" aria-label="Навигация">
        {LEFT.map(item)}
        <button
          class="fab"
          aria-label="Добавить задачу"
          onClick={() => {
            haptic.light();
            openSheet("task", {});
          }}
        >
          <Icon name="plus" />
        </button>
        {RIGHT.map(item)}
      </nav>
    </div>
  );
}
