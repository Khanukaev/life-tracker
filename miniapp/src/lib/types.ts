/** API types (mirror backend/lifetracker/schemas). Times "HH:MM", day minutes as numbers. */

export type Uuid = string;
export type HabitType = "check" | "count" | "bedtime";
export type Status = "done" | "missed" | "rest" | "pending" | "nodata" | "future";

export interface Me {
  id: Uuid;
  telegram_id: number;
  first_name: string;
  username: string | null;
  language: string;
  timezone: string;
  reminder_time: string | null;
  morning_time: string | null;
  week_note_time: string | null;
  haptics: boolean;
  onboarded: boolean;
  motto: string | null;
  start_date: string;
}

export interface Settings {
  bed_target: string;
  sleep_need_h: number;
  usual_bed: string;
  usual_wake: string;
  model_bias: number[];
  model_n: number;
}

export interface Schedule {
  kind: "daily" | "weekdays" | "cycle";
  pattern?: string | null;
  anchor?: string | null;
}

export interface CountConfig {
  norm: number;
  step: number;
}

export interface Habit {
  id: Uuid;
  name: string;
  type: HabitType;
  config: Record<string, any>;
  schedule: Schedule;
  active: boolean;
  remind_at: string | null;
  position: number;
}

export interface Task {
  id: Uuid;
  title: string;
  description: string;
  date: string | null;
  start_time: string | null;
  duration_min: number;
  important: boolean;
  fresh: boolean;
  remind_at: string | null;
  done: boolean;
  done_at: string | null;
  created_by: "me" | "claude";
  created_at: string;
  updated_at: string;
}

export interface DayTask extends Task {
  overdue: boolean;
  low_energy: boolean;
}

export interface ScoreItem {
  kind: "sleep" | "habit" | "task";
  ref: Uuid;
  label: string;
  w: number;
  v: number;
  points: number;
  max_points: number;
  note: string;
}

export interface Gain {
  kind: string;
  ref: Uuid;
  label: string;
  points: number;
}

export interface WeekBar {
  date: string;
  pct: number | null;
}

export interface Score {
  pct: number;
  delta: number | null;
  avg7: number | null;
  week: WeekBar[];
  items: ScoreItem[];
  gains: Gain[];
  gains_total: number;
  bed_gain: number;
}

export interface HabitRow {
  id: Uuid;
  name: string;
  type: HabitType;
  config: Record<string, any>;
  schedule: Schedule;
  status: Status;
  due: boolean;
  value: any;
  streak: number;
  streak_base: number;
}

export interface ZoneSpan {
  zone: string;
  start: number;
  end: number;
  avg: number;
}

export interface PlanItem {
  title: string;
  start?: string | null;
  dur?: number;
  note?: string;
}

export interface Review {
  id: Uuid;
  kind: "day" | "week" | "month" | "plan";
  date: string;
  text: string;
  by: "claude" | "schedule" | "me";
  at: string;
  used_note: boolean;
  changes: string[];
  items?: PlanItem[] | null;
  applied_at?: string | null;
}

export interface SleepRec {
  bed: string;
  wake: string;
  quality: "bad" | "ok" | "good";
  duration_min: number;
}

export interface DayView {
  date: string;
  today: string;
  relation: "today" | "past" | "future";
  now_min: number | null;
  date_label: string;
  energy_now: number | null;
  energy_zone: string | null;
  score: Score | null;
  phrase: string | null;
  phrases: string[];
  sleep: SleepRec | null;
  sleep_planned: { bed: string; need_h: number } | null;
  habits: HabitRow[];
  tasks: DayTask[];
  timeline: {
    wake: number;
    bed: number;
    zones: ZoneSpan[];
    curve: (number | null)[];
    free: { start: number; end: number; zone: string | null }[];
    now: { zone: string; until: number; idx: number | null; next_zone: string | null } | null;
  };
  plan?: Review | null;
}

export interface NowView {
  today: string;
  now_min: number;
  idx: number | null;
  zone: string;
  window: ZoneSpan | null;
  next_focus: ZoneSpan | null;
  sleep_logged: boolean;
  last_feel: { t: string; v: string; pred: number | null; err: number | null } | null;
  curve: (number | null)[];
  q_hi: number;
  q_lo: number;
  avg: number | null;
  max: number;
  max_at: number | null;
  min: number;
  min_at: number | null;
  windows: ZoneSpan[];
}

export interface ReviewView {
  period: "week" | "month";
  start: string;
  end: string;
  label: string;
  habits: { id: Uuid; name: string; pct: number | null; dots: Status[]; streak: number; best: number }[];
}

export interface McpStatus {
  url: string;
  active: boolean;
  prefix: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export interface McpIssued {
  url: string;
  token: string;
  prefix: string;
}
