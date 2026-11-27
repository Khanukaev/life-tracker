/** All bottom sheets (loaded lazily: not part of the first screen bundle). */

import { sheet } from "../lib/router";
import { AddSheet } from "./AddSheet";
import { AssignSheet } from "./AssignSheet";
import { EnergySheet } from "./EnergySheet";
import { NoteSheet } from "./NoteSheet";
import { SleepSheet } from "./SleepSheet";

export default function Sheets() {
  const s = sheet.value;
  if (!s) return null;
  const key = JSON.stringify(s.props);
  switch (s.kind) {
    case "add":
      return <AddSheet key={key} taskId={s.props.taskId} habitId={s.props.habitId} />;
    case "energy":
      return <EnergySheet key={key} />;
    case "sleep":
      return <SleepSheet key={key} date={s.props.date} />;
    case "note":
      return <NoteSheet key={key} kind={s.props.kind} anchor={s.props.anchor} />;
    case "assign":
      return <AssignSheet key={key} id={s.props.id} task={s.props.task} />;
  }
}
