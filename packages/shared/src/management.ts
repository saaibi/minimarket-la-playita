import { z } from "zod";
const money = z.number().int().min(0).max(100000000);
export const productWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(80).default("Despensa"),
    code: z.string().trim().max(80).default(""),
    supplier: z.string().trim().max(150).default(""),
    description: z.string().trim().max(1000).default(""),
    photo: z
      .union([
        z.literal(""),
        z
          .string()
          .max(300000)
          .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
      ])
      .default(""),
    kind: z.enum(["unit", "weight"]),
    priceCop: money,
    costCop: money,
    minimum: z.number().int().min(0).max(100000000),
    visible: z.boolean(),
    version: z.number().int().positive().optional(),
    initialStock: z.number().int().min(0).max(100000000).optional(),
    presentations: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            name: z.string().trim().min(1).max(80),
            factor: z.number().int().positive().max(1000000),
            priceCop: money,
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .refine(
    (p) =>
      p.kind === "weight"
        ? p.presentations.length === 0
        : p.presentations.some((v) => v.factor === 1),
    "Unidades requieren presentación base factor 1; peso no usa presentaciones",
  )
  .refine(
    (p) =>
      new Set(p.presentations.map((v) => v.factor)).size ===
      p.presentations.length,
    "Factores únicos",
  );
export type ProductWrite = z.infer<typeof productWriteSchema>;
export const stockAdjustmentSchema = z
  .object({
    delta: z
      .number()
      .int()
      .min(-100000000)
      .max(100000000)
      .refine((n) => n !== 0),
    reason: z.string().trim().min(3).max(200),
    version: z.number().int().positive(),
  })
  .strict();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const day = z
  .object({ closed: z.boolean(), open: time, close: time })
  .strict()
  .refine(
    (d) => d.closed || d.open !== d.close,
    "El cierre debe ser posterior a la apertura",
  );
export const scheduleSchema = z
  .object({
    days: z.array(day).length(7),
    override: z.enum(["auto", "open", "closed"]),
    overrideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type Schedule = z.infer<typeof scheduleSchema>;
export function bogotaDate(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => p.find((v) => v.type === k)!.value)
    .join("-");
}
export function isStoreOpen(schedule: Schedule, now = new Date()) {
  if (schedule.override !== "auto") return schedule.override === "open";
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const i = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    p.find((x) => x.type === "weekday")!.value,
  );
  const clock =
    p.find((x) => x.type === "hour")!.value +
    ":" +
    p.find((x) => x.type === "minute")!.value;
  const d = schedule.days[i]!,
    prev = schedule.days[(i + 6) % 7]!;
  return (
    (!d.closed &&
      (d.open < d.close
        ? clock >= d.open && clock < d.close
        : clock >= d.open)) ||
    (!prev.closed && prev.open > prev.close && clock < prev.close)
  );
}
export const clientWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    contact: z.string().trim().max(100),
    version: z.number().int().positive().optional(),
  })
  .strict();
