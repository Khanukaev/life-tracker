import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect } from "preact/hooks";
import { animateScreen } from "./motion/screen";
import { TabBar } from "./components/TabBar";
import { Toast } from "./components/Toast";
import { current, dayDate, dayMode, sheet, tab } from "./lib/router";
import { resource } from "./lib/store";
import type { DayView, Me } from "./lib/types";
import { ClaudeScreen, ReviewsScreen } from "./screens/Claude";
import { HabitDetail, TaskDetail } from "./screens/Detail";
import { ImportScreen } from "./screens/Import";
import { Onboarding, ProfileScreen, Stub } from "./screens/Misc";
import { NormsScreen, SettingsScreen } from "./screens/Settings";
import { TodayScreen } from "./screens/Today";

// Sheets are split into their own chunk: not needed for the first paint.
const Sheets = lazy(() => import("./sheets"));

export function App() {
  const me = resource<Me>("/me").value.data;
  const scr = current.value;
  const screenKey = `${tab.value}|${scr?.name ?? ""}|${scr?.params?.id ?? ""}|${dayDate.value ?? ""}|${dayMode.value}|${me?.onboarded}`;
  // Before the new screen is painted (layout effect, not rAF): mark which cards stagger in.
  useLayoutEffect(() => {
    animateScreen();
  }, [screenKey]);

  if (me && !me.onboarded) {
    return (
      <>
        <Onboarding />
        <Toast />
      </>
    );
  }

  let body;
  if (scr) {
    body =
      scr.name === "task" ? <TaskDetail id={scr.params!.id!} /> :
      scr.name === "habit" ? <HabitDetail id={scr.params!.id!} /> :
      scr.name === "profile" ? <ProfileScreen /> :
      scr.name === "settings" ? <SettingsScreen /> :
      scr.name === "norms" ? <NormsScreen /> :
      scr.name === "claude" ? <ClaudeScreen /> :
      scr.name === "reviews" ? <ReviewsScreen /> :
      <ImportScreen />;
  } else {
    body =
      tab.value === "today" ? <TodayScreen /> :
      tab.value === "plan" ? <Stub title="План" text="Здесь будет то, что впереди: просроченное, ближайшие дни и дела без даты." /> :
      <Stub title="Итоги" text="Здесь будут итоги недели и месяца: привычки, задачи и сон." />;
  }

  // «Добавь первое дело»: on the first, still empty «Сегодня».
  const day = resource<DayView>("/views/day").value.data;
  const hint = !scr && tab.value === "today" && !dayDate.value && !!day && day.habits.length === 0 && day.tasks.length === 0;

  return (
    <>
      {body}
      <TabBar hint={hint} />
      {sheet.value && (
        <Suspense fallback={null}>
          <Sheets />
        </Suspense>
      )}
      <Toast />
    </>
  );
}
