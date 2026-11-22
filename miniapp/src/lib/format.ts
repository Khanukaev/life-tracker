/** Formatting helpers. Minutes are "minutes of the logical day" (01:30 at night = 1530). */

export const pad = (n: number) => String(n).padStart(2, "0");

/** JavaScript Math.round, used by the domain formulas (kept explicit for clarity). */
export const jsRound = (x: number) => Math.round(x);

export function hhmm(min: number): string {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
}

export function toMin(s: string | null | undefined): number | null {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "8 ч 20 м", "45 мин", "2 ч" (short form from the redesign). */
export function dur(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} мин`;
  if (!m) return `${h} ч`;
  return `${h} ч ${m} м`;
}

/** Duration in hours for chips: 1,5 ч. */
export function durChip(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = min / 60;
  return `${String(h).replace(".", ",")} ч`;
}

const WD = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const WD_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** "Воскресенье, 22 ноября". */
export function longDate(iso: string): string {
  const d = parseDate(iso);
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** "22 ноя". */
export function shortDate(iso: string): string {
  const d = parseDate(iso);
  return `${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}

/** "Чт, 26 нояб"-style label used in task meta. */
export function weekdayDate(iso: string): string {
  const d = parseDate(iso);
  return `${WD_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MON_SHORT[d.getUTCMonth()]}`;
}

export function weekdayShort(iso: string): string {
  return WD_SHORT[parseDate(iso).getUTCDay()] ?? "";
}

export function relDay(iso: string, today: string): string {
  if (iso === today) return "Сегодня";
  if (iso === addDays(today, 1)) return "Завтра";
  if (iso === addDays(today, -1)) return "Вчера";
  return weekdayDate(iso);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

export const ZONE_NAME: Record<string, string> = {
  focus: "Focus",
  steady: "Steady",
  recharge: "Recharge",
  sleep: "Сон",
};

export const ZONE_COLOR: Record<string, string> = {
  focus: "var(--accent)",
  steady: "var(--steady)",
  recharge: "var(--recharge)",
};

export const ZONE_DOT: Record<string, string> = {
  focus: "var(--accent)",
  steady: "var(--steady-dot)",
  recharge: "var(--recharge-dot)",
};
