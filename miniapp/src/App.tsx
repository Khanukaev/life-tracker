import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect } from "preact/hooks";
import { animateScreen } from "./motion/screen";
import { TabBar } from "./components/TabBar";
import { Toast } from "./components/Toast";
import { current, dayDate, dayMode, period, sheet, tab } from "./lib/router";
import { resource } from "./lib/store";
import type { DayView, Me } from "./lib/types";
import { ClaudeReviewScreen, ClaudeScreen, ClaudeTokenScreen } from "./screens/Claude";
import { DataScreen } from "./screens/Data";
import { HabitDetail, TaskDetail } from "./screens/Detail";
import { Onboarding } from "./screens/Onboarding";
import { PlanScreen } from "./screens/Plan";
import { AboutScreen, ProfileScreen } from "./screens/Profile";
import { ResultsHabits, ResultsScreen, ResultsSleep, ResultsTasks } from "./screens/Results";
import { TodayScreen } from "./screens/Today";

// Sheets are split into their own chunk: not needed for the first paint.
const Sheets = lazy(() => import("./sheets"));

export function App() {
  const me = resource<Me>("/me").value.data;
  const scr = current.value;
  const screenKey = `${tab.value}|${scr?.name ?? ""}|${scr?.params?.id ?? ""}|${dayDate.value ?? ""}|${dayMode.value}|${period.value}|${me?.onboarded}`;
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
    const id = scr.params?.id ?? "";
    body =
      scr.name === "task" ? <TaskDetail id={id} /> :
      scr.name === "habit" ? <HabitDetail id={id} /> :
      scr.name === "profile" ? <ProfileScreen /> :
      scr.name === "data" ? <DataScreen /> :
      scr.name === "about" ? <AboutScreen /> :
      scr.name === "claude" ? <ClaudeScreen /> :
      scr.name === "claude-token" ? <ClaudeTokenScreen /> :
      scr.name === "review" ? <ClaudeReviewScreen id={id} /> :
      scr.name === "res-habits" ? <ResultsHabits /> :
      scr.name === "res-tasks" ? <ResultsTasks /> :
      <ResultsSleep />;
  } else {
    body = tab.value === "today" ? <TodayScreen /> : tab.value === "plan" ? <PlanScreen /> : <ResultsScreen />;
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
