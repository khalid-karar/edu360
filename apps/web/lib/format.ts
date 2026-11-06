const TZ = "Asia/Riyadh";
const base = { timeZone: TZ, numberingSystem: "latn" } as const;
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { ...base, ...o });

const DAY = fmt({ weekday: "long", day: "numeric", month: "long" });
const TIME = fmt({ hour: "numeric", minute: "2-digit", hour12: true });
const SHORT = fmt({ weekday: "short", day: "numeric", month: "short" });

export const dayLabel = (d: string | Date) => DAY.format(new Date(d));
export const shortDay = (d: string | Date) => SHORT.format(new Date(d));
export const timeLabel = (d: string | Date) => TIME.format(new Date(d));
export const dateTime = (d: string | Date) => `${dayLabel(d)} · ${timeLabel(d)}`;
/** Calendar day in Riyadh, as YYYY-MM-DD, for grouping. */
export const dayKey = (d: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(d));

export const sar = (halalas: number) => {
  const v = halalas / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2)} ر.س`;
};

/** "2026-11-08" + "16:00" in Riyadh time (UTC+3, no daylight saving) to an ISO instant. */
export const riyadhToIso = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`).toISOString();
export const riyadhToday = () => dayKey(new Date());

export const STATUS_AR: Record<string, { label: string; tone: "wait" | "ok" | "bad" | "done" }> = {
  awaiting_payment: { label: "بانتظار الدفع", tone: "wait" },
  requested: { label: "بانتظار موافقة المعلّم", tone: "wait" },
  confirmed: { label: "مؤكد", tone: "ok" },
  completed: { label: "مكتمل", tone: "done" },
  declined: { label: "مرفوض", tone: "bad" },
  cancelled: { label: "ملغي", tone: "bad" },
  no_show_teacher: { label: "غياب المعلّم", tone: "bad" },
  no_show_learner: { label: "غياب المتعلّم", tone: "bad" },
};
