import React, { useMemo, useState } from "react";
import type { Product } from "@playita/shared";
import { stockLabel } from "@playita/shared";
import { Share } from "@capacitor/share";
import { Modal } from "./ui.js";
import { Button, Input, Select } from "./material.js";
import {
  needsReplenishment,
  supplierName,
  orderUnit,
  validOrderQuantity,
  replenishmentText,
} from "./replenishment.js";
export function ReplenishmentOrder({
  products,
  initialSupplier,
  close,
}: {
  products: Product[];
  initialSupplier: string;
  close: () => void;
}) {
  const [supplier, setSupplier] = useState(initialSupplier),
    [draft, setDraft] = useState<
      Record<string, { selected: boolean; quantity: string }>
    >({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const candidates = products.filter(needsReplenishment);
  const suppliers = [...new Set(products.map(supplierName))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const listed = candidates.filter(
    (p) => supplier === "all" || supplierName(p) === supplier,
  );
  const selected = listed.filter((p) => draft[p.id]?.selected !== false);
  const ready =
    selected.length > 0 &&
    selected.every((p) => validOrderQuantity(p, draft[p.id]?.quantity || ""));
  const text = useMemo(
    () =>
      ready
        ? replenishmentText(
            selected.map((product) => ({
              product,
              quantity: draft[product.id]?.quantity || "",
            })),
          )
        : "",
    [products, supplier, draft, ready],
  );
  function update(
    id: string,
    change: Partial<{ selected: boolean; quantity: string }>,
  ) {
    setDraft((d) => ({
      ...d,
      [id]: { selected: true, quantity: "", ...d[id], ...change },
    }));
    setMessage("");
  }
  async function share() {
    if (!ready) return;
    setBusy(true);
    setMessage("");
    try {
      await Share.share({
        title: "Pedido · Minimarket La Playita",
        text,
        dialogTitle: "Compartir pedido",
      });
    } catch {
      setMessage("No se compartió el pedido. Puedes copiarlo o descargarlo.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Pedido copiado.");
    } catch {
      setMessage(
        "No se pudo copiar. Puedes seleccionar el texto del pedido o descargarlo.",
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "pedido-la-playita.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Modal
      title="Preparar pedido a proveedor"
      close={() => {
        if (!busy) close();
      }}
    >
      <p>
        Productos agotados o por reponer. Indica cuánto pedir; el mínimo es una
        alerta, no una cantidad de compra.
      </p>
      <label>
        Proveedor
        <Select
          value={supplier}
          onChange={(e) => {
            setSupplier(e.target.value);
            setMessage("");
          }}
        >
          <option value="all">Todos los proveedores</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </label>
      {listed.length === 0 && (
        <p>No hay productos pendientes de reposición para este proveedor.</p>
      )}
      <ul className="replenishment-list">
        {listed.map((p) => (
          <li key={p.id}>
            <label className="check">
              <Input
                type="checkbox"
                checked={draft[p.id]?.selected !== false}
                onChange={(e) => update(p.id, { selected: e.target.checked })}
              />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {supplierName(p)} · Quedan: {stockLabel(p, p.available)}
                </small>
              </span>
            </label>
            <label>
              Cantidad ({orderUnit(p)})
              <Input
                type="number"
                inputMode={p.kind === "unit" ? "numeric" : "decimal"}
                min={
                  p.kind === "unit" ? 1 : p.weightUnit === "lb" ? 0.002 : 0.001
                }
                max="100000000"
                step={
                  p.kind === "unit" ? 1 : p.weightUnit === "lb" ? 0.002 : 0.001
                }
                disabled={draft[p.id]?.selected === false}
                value={draft[p.id]?.quantity || ""}
                placeholder="Cuánto pedir"
                aria-label={`Cantidad a pedir de ${p.name}`}
                onChange={(e) => update(p.id, { quantity: e.target.value })}
              />
            </label>
          </li>
        ))}
      </ul>
      {selected.length > 0 && !ready && (
        <p>Completa una cantidad válida para cada producto seleccionado.</p>
      )}
      {ready && (
        <details>
          <summary>Ver texto del pedido</summary>
          <pre className="order-share-preview">{text}</pre>
        </details>
      )}
      <div className="actions">
        <Button disabled={!ready || busy} onClick={() => void share()}>
          Compartir pedido
        </Button>
        <Button
          tone="secondary"
          disabled={!ready || busy}
          onClick={() => void copy()}
        >
          Copiar
        </Button>
        <Button variant="outlined" disabled={!ready || busy} onClick={download}>
          Descargar
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      <small>
        Compartir no registra una compra ni modifica existencias. Elige tú la
        aplicación y el destinatario.
      </small>
    </Modal>
  );
}
