import React, { useState } from "react";
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
  const suppliers = [...new Set(products.map(supplierName))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const [supplier, setSupplier] = useState(
      initialSupplier !== "all" && suppliers.includes(initialSupplier)
        ? initialSupplier
        : suppliers.length === 1
          ? suppliers[0]!
          : "",
    ),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [added, setAdded] = useState<string[]>([]),
    [adding, setAdding] = useState(false),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const pool = products.filter((p) => supplierName(p) === supplier);
  const listed = pool.filter(
    (p) => needsReplenishment(p) || added.includes(p.id),
  );
  const selected = listed.filter((p) => Number(draft[p.id] || 0) > 0);
  const invalid = listed.some((p) => {
    const q = draft[p.id] || "";
    return q.trim() !== "" && Number(q) !== 0 && !validOrderQuantity(p, q);
  });
  const ready = selected.length > 0 && !invalid;
  const text = ready
    ? replenishmentText(
        selected.map((product) => ({
          product,
          quantity: draft[product.id] || "",
        })),
      )
    : "";
  const normalize = (s: string) =>
    s
      .toLocaleLowerCase("es")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  const others = pool.filter(
    (p) =>
      !listed.some((l) => l.id === p.id) &&
      normalize(p.name + " " + (p.code || "")).includes(normalize(search)),
  );
  function update(id: string, value: string) {
    setDraft((d) => ({ ...d, [id]: value }));
    setMessage("");
  }
  function change(p: Product, delta: number) {
    const current = Number(draft[p.id] || 0);
    update(
      p.id,
      String(
        Math.min(
          100000000,
          Math.max(0, (Number.isFinite(current) ? current : 0) + delta),
        ),
      ),
    );
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
      <label>
        Proveedor
        <Select
          value={supplier}
          onChange={(e) => {
            setSupplier(e.target.value);
            setAdding(false);
            setSearch("");
            setMessage("");
          }}
        >
          <option value="" disabled>
            Elige el proveedor
          </option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </label>
      {!suppliers.length && <p>No hay productos registrados.</p>}
      {supplier && (
        <>
          <p>Cambia la cantidad con − y +. En cero no se pide.</p>
          {!listed.length && (
            <p>
              No hay productos agotados o por reponer. Puedes añadir otro
              producto.
            </p>
          )}
          <ul className="replenishment-list simple-order-list">
            {listed.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    Presentación: <strong>{orderUnit(p)}</strong>
                  </small>
                  <small>Quedan: {stockLabel(p, p.available)}</small>
                </div>
                <div className="order-quantity">
                  <Button
                    type="button"
                    variant="outlined"
                    aria-label={`Pedir menos ${p.name}`}
                    disabled={Number(draft[p.id] || 0) <= 0}
                    onClick={() => change(p, -1)}
                  >
                    −
                  </Button>
                  <Input
                    type="number"
                    inputMode={
                      p.purchasePresentation?.trim() || p.kind === "unit"
                        ? "numeric"
                        : "decimal"
                    }
                    min="0"
                    max="100000000"
                    step={
                      p.purchasePresentation?.trim() || p.kind === "unit"
                        ? 1
                        : p.weightUnit === "lb"
                          ? 0.002
                          : 0.001
                    }
                    value={draft[p.id] ?? "0"}
                    aria-label={`Cantidad a pedir de ${p.name}`}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => update(p.id, e.target.value)}
                  />
                  <Button
                    type="button"
                    aria-label={`Pedir más ${p.name}`}
                    onClick={() => change(p, 1)}
                  >
                    +
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            tone="secondary"
            onClick={() => setAdding((a) => !a)}
          >
            {adding ? "Cerrar búsqueda" : "Añadir otro producto"}
          </Button>
          {adding && (
            <section className="other-supplier-products">
              <label>
                Buscar producto de este proveedor
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre o código"
                />
              </label>
              <ul>
                {others.slice(0, 20).map((p) => (
                  <li key={p.id}>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => {
                        setAdded((ids) => [...ids, p.id]);
                        update(p.id, "1");
                        setAdding(false);
                        setSearch("");
                      }}
                    >
                      {p.name} · {orderUnit(p)}
                    </Button>
                  </li>
                ))}
              </ul>
              {!others.length && (
                <p>No hay más productos de este proveedor que coincidan.</p>
              )}
              {others.length > 20 && (
                <p>Escribe el nombre para encontrar más productos.</p>
              )}
            </section>
          )}
          {invalid && (
            <p role="alert">
              Revisa las cantidades. Las presentaciones de compra se piden en
              números enteros.
            </p>
          )}
          {ready && (
            <details>
              <summary>Ver texto del pedido</summary>
              <pre className="order-share-preview">{text}</pre>
            </details>
          )}
          <div className="actions">
            <Button
              type="button"
              disabled={!ready || busy}
              onClick={() => void share()}
            >
              Compartir pedido
            </Button>
            <Button
              type="button"
              tone="secondary"
              disabled={!ready || busy}
              onClick={() => void copy()}
            >
              Copiar
            </Button>
            <Button
              type="button"
              variant="outlined"
              disabled={!ready || busy}
              onClick={download}
            >
              Descargar
            </Button>
          </div>
          {message && <p role="status">{message}</p>}
          <small>
            Solo se incluyen las cantidades mayores a cero. Compartir no
            registra una compra ni modifica existencias.
          </small>
        </>
      )}
    </Modal>
  );
}
