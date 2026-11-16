import { stockLabel, type Product } from "@playita/shared";
export const supplierName = (p: Product) =>
  p.supplier?.trim() || "Sin proveedor";
export const needsReplenishment = (p: Product) =>
  p.available <= (p.minimum || 0);
export function orderUnit(p: Product) {
  return p.kind === "weight"
    ? p.weightUnit === "lb"
      ? "libras"
      : "kilos"
    : "unidades";
}
export function validOrderQuantity(p: Product, value: string) {
  if (!value.trim()) return false;
  const n = Number(value);
  const factor = p.kind === "unit" ? 1 : p.weightUnit === "lb" ? 500 : 1000;
  return (
    Number.isFinite(n) &&
    n > 0 &&
    n <= 100000000 &&
    Math.abs(n * factor - Math.round(n * factor)) < 0.000001
  );
}
export function replenishmentText(
  lines: { product: Product; quantity: string }[],
) {
  if (
    !lines.length ||
    lines.some((l) => !validOrderQuantity(l.product, l.quantity))
  )
    throw Error("INVALID_QUANTITY");
  const groups = new Map<string, typeof lines>();
  for (const line of lines) {
    const supplier = supplierName(line.product);
    groups.set(supplier, [...(groups.get(supplier) || []), line]);
  }
  const parts = ["Minimarket La Playita", "Solicitud de pedido"];
  for (const [supplier, items] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b, "es"),
  )) {
    parts.push("", `Proveedor: ${supplier}`);
    for (const { product: p, quantity } of items)
      parts.push(
        `• ${p.name}${p.code ? ` [${p.code}]` : ""}: ${Number(quantity).toLocaleString("es-CO", { maximumFractionDigits: 3 })} ${orderUnit(p)} · Quedan: ${stockLabel(p, p.available)}`,
      );
  }
  return parts.join("\n");
}
