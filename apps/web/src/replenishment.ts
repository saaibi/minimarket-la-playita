import { type Product } from "@playita/shared";
export const supplierName = (p: Product) =>
  p.supplier?.trim() || "Sin proveedor";
export const needsReplenishment = (p: Product) =>
  p.available <= (p.minimum || 0);
export type PurchaseOption = {
  id: string;
  label: string;
  unit: string;
  step: number;
  package: boolean;
};
export function purchaseOptions(p: Product): PurchaseOption[] {
  const options: PurchaseOption[] = [];
  const labels =
    p.purchasePresentations ??
    (p.purchasePresentation?.trim() ? [p.purchasePresentation.trim()] : []);
  for (const [index, label] of labels.entries())
    if (label.trim())
      options.push({
        id: index === 0 ? "purchase" : "purchase:" + label,
        label: label.trim(),
        unit: label.trim(),
        step: 1,
        package: true,
      });
  if (p.kind === "unit") {
    options.push({
      id: "unit",
      label: "Unidad",
      unit: "unidades",
      step: 1,
      package: false,
    });
    p.presentations.forEach((v, i) => {
      if (v.factor > 1)
        options.push({
          id: "presentation:" + (v.id || i),
          label: `${v.name} (${v.factor} unidades)`,
          unit: `${v.name} (${v.factor} unidades)`,
          step: 1,
          package: true,
        });
    });
  } else {
    const preferred = p.weightUnit === "lb" ? "lb" : "kg";
    for (const unit of [preferred, preferred === "lb" ? "kg" : "lb"])
      options.push({
        id: unit,
        label: unit === "lb" ? "Libra" : "Kilo",
        unit: unit === "lb" ? "libras" : "kilos",
        step: unit === "lb" ? 0.002 : 0.001,
        package: false,
      });
  }
  return options;
}
export function purchaseOption(p: Product, id?: string) {
  const options = purchaseOptions(p);
  return id === undefined ? options[0] : options.find((o) => o.id === id);
}
export function orderUnit(p: Product, id?: string) {
  return purchaseOption(p, id)?.unit || "";
}
export function validOrderQuantity(
  p: Product,
  value: string,
  presentation?: string,
) {
  const option = purchaseOption(p, presentation),
    n = Number(value);
  if (!value.trim() || !option) return false;
  return (
    Number.isFinite(n) &&
    n > 0 &&
    n <= 100000000 &&
    Math.abs(n / option.step - Math.round(n / option.step)) < 0.000001
  );
}
export function replenishmentText(
  lines: { product: Product; quantity: string; presentation?: string }[],
) {
  if (
    !lines.length ||
    lines.some(
      (l) => !validOrderQuantity(l.product, l.quantity, l.presentation),
    )
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
    for (const { product: p, quantity, presentation } of items)
      parts.push(
        `• ${p.name}${p.code ? ` [${p.code}]` : ""}: ${Number(quantity).toLocaleString("es-CO", { maximumFractionDigits: 3 })} ${purchaseOption(p, presentation)?.package ? "× " : ""}${orderUnit(p, presentation)}`,
      );
  }
  return parts.join("\n");
}
