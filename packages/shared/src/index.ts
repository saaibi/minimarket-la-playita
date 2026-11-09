import { z } from "zod";
export const roleSchema = z.enum(["admin", "seller", "buyer"]);
export type Role = z.infer<typeof roleSchema>;
export type Actor = { id: string; role: Role };
export const orderDraftSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            productId: z.uuid(),
            presentationId: z.uuid().optional(),
            quantity: z.number().int().positive().max(1_000_000),
            expectedPriceCop: z.number().int().nonnegative().max(100_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    paymentMethod: z.enum(["cash", "nequi"]),
    client: z
      .object({
        name: z.string().trim().min(1).max(100),
        reference: z.string().trim().max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OrderDraft = z.infer<typeof orderDraftSchema>;
export type OrderResult = {
  id: string;
  status: "confirmed" | "accepted" | "ready" | "delivered" | "cancelled";
  paymentStatus: "pending" | "not_integrated" | "paid";
  totalCop: number;
  clientName: string;
  [key: string]: unknown;
};
export type ApiError = { code: string; message: string; details?: unknown };
export type Presentation = {
  id: string;
  name: string;
  factor: number;
  priceCop: number;
};
export type Product = {
  id: string;
  name: string;
  kind: "unit" | "weight";
  priceCop: number;
  stock: number;
  reserved: number;
  available: number;
  version: number;
  costCop?: number;
  presentations: Presentation[];
};
export const actionSchema = z
  .object({
    action: z.enum(["accept", "ready", "pay_cash", "deliver", "cancel"]),
  })
  .strict();
export function baseQuantity(
  kind: "unit" | "weight",
  quantity: number,
  factor = 1,
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(factor) ||
    factor <= 0
  )
    throw Error("Cantidad/factor inválidos");
  const base = kind === "weight" ? quantity : quantity * factor;
  if (!Number.isSafeInteger(base)) throw Error("Cantidad fuera de rango");
  return base;
}
export function lineTotal(
  kind: "unit" | "weight",
  quantity: number,
  price: number,
) {
  return Math.round((quantity * price) / (kind === "weight" ? 1000 : 1));
}
export function grams(value: number, unit: "kg" | "lb") {
  const result = value * (unit === "kg" ? 1000 : 500);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw Error("Usa una cantidad representable en gramos enteros");
  return result;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
