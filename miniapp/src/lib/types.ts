/** API types (mirror backend/lifetracker/schemas). Times "HH:MM", day minutes as numbers. */

export type Uuid = string;
export type Zone = "focus" | "steady" | "recharge";
export type Importance = "normal" | "important" | "critical";
export type HabitType = "check" | "bedtime" | "water" | "minutes" | "dual";
export type Status = "done" | "missed" | "rest" | "pending" | "nodata" | "future";

export interface Me {
  id: Uuid;
  telegram_id: number;
  first_name: string;
  username: string | null;
  language: string;
  timezone: string;
  reminder_time: string | null;
  morning_ping: boolean;
  theme: "base" | "glass" | null;
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
  kind: "daily" | "every" | "cycle";
  n?: number | null;
  pattern?: string | null;
  anchor?: string | null;
}

export interface Habit {
  id: Uuid;
  name: string;
  type: HabitType;
  sphere_id: Uuid | null;
  is_key: boolean;
  config: Record<string, any>;
  schedule: Schedule;
  active: boolean;
  position: number;
}

export interface Sphere {
  id: Uuid;
  name: string;
  position: number;
}

export interface Task {
  id: Uuid;
  title: string;
  description: string;
  date: string | null;
  start_time: string | null;
  duration_min: number;
  energy: Zone;
  sphere_id: Uuid | null;
  importance: Importance;
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

export interface Slot {
  date: string;
  start: number;
  end: number;
  fit: number;
  avg: number;
  zone: string | null;
}

export interface ListTask extends DayTask {
  slot: Slot | null;
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
  is_key: boolean;
  sphere_id: Uuid | null;
  config: Record<string, any>;
  schedule: Schedule;
  status: Status;
  due: boolean;
  value: any;
  streak: number;
  streak_base: number;
}

export interface ZoneSpan {
  zone: Zone;
  start: number;
  end: number;
  avg: number;
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
  sleep: { bed: string; wake: string; quality: string; duration_min: number } | null;
  sleep_planned: { bed: string; need_h: number } | null;
  critical: DayTask[];
  critical_overload: boolean;
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
  train: { start: number; end: number } | null;
  factors: { key: string; label: string; val: number; note: string }[];
  personal: number;
  personal_n: number;
  debt_h: number;
  late_min: number;
  irr_sd_h: number | null;
  hormones: {
    step_min: number;
    alertness: number[];
    motivation: number[];
    cortisol: number[];
    melatonin: number[];
    now: Record<string, number> | null;
    melatonin_rise: number;
  };
}

export interface ReviewView {
  period: "week" | "month";
  start: string;
  end: string;
  label: string;
  prev_anchor: string;
  next_anchor: string | null;
  scores: WeekBar[];
  avg: number | null;
  days_70: number;
  best_run_70: number;
  best_day: WeekBar | null;
  alerts: { kind: string; title: string; subtitle: string; severe: boolean }[];
  habits_pct: number | null;
  tasks_pct: number | null;
  tasks_done: number;
  tasks_total: number;
  habits: { id: Uuid; name: string; pct: number | null; dots: Status[]; streak: number; best: number }[];
  spheres: { id: Uuid; name: string; streak: number; best: number; pct: number | null }[];
  bed_goal: number;
  nights: { date: string; bed: number | null; on_time: boolean | null }[];
}

export interface GoalCard {
  id: Uuid;
  title: string;
  criterion: string;
  kind: "subtasks" | "streak" | "count" | "manual";
  stage: number;
  deadline: string | null;
  sphere_id: Uuid | null;
  sphere_name: string | null;
  archived: boolean;
  progress: { pct: number; label: string; cur?: number | null; t?: number | null };
  overdue: boolean;
  overdue_steps: number;
  steps: { id: Uuid; title: string; done: boolean; deadline: string | null; overdue: boolean }[];
  cells: { date: string; ok: string }[];
}

export interface GoalsView {
  base: GoalCard[];
  next: GoalCard[];
  archived: GoalCard[];
  history: { goal_id: Uuid; goal_title: string; by: string; what: string; at: string }[];
  base_holds: boolean;
}

export interface GoalDetail {
  id: Uuid;
  title: string;
  criterion: string;
  deadline: string | null;
  stage: number;
  kind: GoalCard["kind"];
  target: number | null;
  window_days: number | null;
  manual_pct: number | null;
  sphere_id: Uuid | null;
  archived: boolean;
  position: number;
  habit_ids: Uuid[];
  subtasks: { id: Uuid; title: string; deadline: string | null; done: boolean; done_at: string | null; position: number }[];
  history: { at: string; by: string; what: string }[];
}

export interface TaskCounts {
  inbox: number;
  today: number;
  overdue: number;
  overdue_critical: number;
  upcoming: number;
  done: number;
}

export interface TasksView {
  view: string;
  counts: TaskCounts;
  items: ListTask[];
  loads: { zone: Zone; need_min: number; free_min: number; task_ids: Uuid[] }[];
  critical_today: number;
}

export interface ProfileView {
  goals: GoalCard[];
  goals_total: number;
  tasks: TaskCounts;
  habits: { id: Uuid; name: string; type: HabitType; active: boolean; sphere_name: string | null; schedule_label: string; streak: number }[];
  spheres: { id: Uuid; name: string; count: number }[];
}

export interface HabitTemplate {
  key: string;
  name: string;
  type: HabitType;
  config?: Record<string, any>;
  schedule?: Schedule;
  sphere: string;
  hint: string;
}

export interface Review {
  id: Uuid;
  kind: "day" | "week";
  date: string;
  text: string;
  by: "claude" | "schedule" | "me";
  at: string;
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
