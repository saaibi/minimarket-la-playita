import { baseQuantity, type Product, type OrderDraft } from "@playita/shared";
type Lines = OrderDraft["lines"];
export function cartBaseQuantity(product: Product, lines: Lines) {
  return lines
    .filter((line) => line.productId === product.id)
    .reduce((sum, line) => {
      const presentation = product.presentations.find(
        (p) => p.id === line.presentationId,
      );
      if (product.kind === "unit" && line.presentationId && !presentation)
        return Infinity;
      return (
        sum +
        baseQuantity(product.kind, line.quantity, presentation?.factor ?? 1)
      );
    }, 0);
}
export function remainingStock(product: Product, lines: Lines) {
  return Math.max(0, product.available - cartBaseQuantity(product, lines));
}
export function assertCartAddition(
  product: Product,
  lines: Lines,
  line: Lines[number],
) {
  const requested = cartBaseQuantity(product, [line]),
    remaining = remainingStock(product, lines);
  if (
    !Number.isSafeInteger(requested) ||
    requested <= 0 ||
    requested > remaining
  )
    throw Error(
      `Solo quedan ${remaining} ${product.kind === "weight" ? "g" : "unidades base"} disponibles para agregar; lo que ya está en la canasta está descontado.`,
    );
}
