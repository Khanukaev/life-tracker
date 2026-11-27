import { lazy, Suspense } from "preact/compat";
import { useLayoutEffect } from "preact/hooks";
import { animateScreen } from "./motion/screen";
import { TabBar } from "./components/TabBar";
import { Toast } from "./components/ui";
import { current, dayDate, sheet, tab } from "./lib/router";
import { resource } from "./lib/store";
import type { Me } from "./lib/types";
import { DayScreen } from "./screens/Day";
import { NowScreen } from "./screens/Now";
import { ClaudeScreen, ReviewsScreen } from "./screens/Claude";
import { ImportScreen } from "./screens/Import";
import { Onboarding } from "./screens/Onboarding";
import { ProfileScreen } from "./screens/Profile";
import { ReviewScreen } from "./screens/Review";
import { GoalsScreen } from "./screens/Goals";
import { HabitsScreen } from "./screens/Habits";
import { NormsScreen, PastDayScreen, SettingsScreen } from "./screens/Settings";
import { TasksScreen } from "./screens/Tasks";

// Sheets are split into their own chunk: not needed for the first paint.
const Sheets = lazy(() => import("./sheets"));

export function App() {
  const me = resource<Me>("/me").value.data;
  const scr = current.value;
  const screenKey = `${tab.value}|${scr?.name ?? ""}|${scr?.params?.view ?? ""}|${dayDate.value ?? ""}|${me?.onboarded}`;
  // Before the new screen is painted (layout effect, not rAF): mark which cards stagger in
  // and which reveal on scroll. Nothing here waits for a frame.
  useLayoutEffect(() => {
    animateScreen();
  }, [screenKey]);

  if (me && !me.onboarded) {
    return (
      <>
        <div class="glass-bg" aria-hidden="true" />
        <Onboarding me={me} />
        <Toast />
      </>
    );
  }

  let body;
  if (scr) {
    body =
      scr.name === "tasks" ? <TasksScreen initial={scr.params?.view} /> :
      scr.name === "goals" ? <GoalsScreen /> :
      scr.name === "habits" ? <HabitsScreen /> :
      scr.name === "settings" ? <SettingsScreen /> :
      scr.name === "norms" ? <NormsScreen /> :
      scr.name === "claude" ? <ClaudeScreen /> :
      scr.name === "reviews" ? <ReviewsScreen /> :
      scr.name === "import" ? <ImportScreen /> :
      <PastDayScreen />;
  } else {
    body =
      tab.value === "day" ? <DayScreen /> :
      tab.value === "now" ? <NowScreen /> :
      tab.value === "review" ? <ReviewScreen /> :
      <ProfileScreen />;
  }

  return (
    <>
      <div class="glass-bg" aria-hidden="true" />
      {body}
      <TabBar />
      {sheet.value && (
        <Suspense fallback={null}>
          <Sheets />
        </Suspense>
      )}
      <Toast />
    </>
  );
}
