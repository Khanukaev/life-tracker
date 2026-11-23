/** All bottom sheets (loaded lazily: not part of the first screen bundle). */

import { sheet } from "../lib/router";
import { ClaudeSheet, ProfileSheet, SphereSheet } from "./small";
import { GoalSheet } from "./GoalSheet";
import { HabitSheet } from "./HabitSheet";
import { SleepSheet } from "./SleepSheet";
import { TaskSheet } from "./TaskSheet";

export default function Sheets() {
  const s = sheet.value;
  if (!s) return null;
  const key = JSON.stringify(s.props);
  switch (s.kind) {
    case "task":
      return <TaskSheet key={key} {...s.props} />;
    case "sleep":
      return <SleepSheet key={key} date={s.props.date} />;
    case "habit":
      return <HabitSheet key={key} id={s.props.id} />;
    case "goal":
      return <GoalSheet key={key} id={s.props.id} />;
    case "sphere":
      return <SphereSheet key={key} id={s.props.id} name={s.props.name} />;
    case "profile":
      return <ProfileSheet />;
    case "claude":
      return <ClaudeSheet key={key} date={s.props.date} kind={s.props.kind} />;
  }
}
