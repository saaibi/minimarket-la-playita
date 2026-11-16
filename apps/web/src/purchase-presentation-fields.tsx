import React from "react";
import { Button, Input } from "./material.js";
export function purchaseNamesValid(values: string[]) {
  return (
    values.every((v) => v.trim().length > 0 && v.trim().length <= 80) &&
    new Set(values.map((v) => v.trim().toLocaleLowerCase("es"))).size ===
      values.length
  );
}
export function PurchasePresentationFields({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="purchase-presentation-fields">
      <legend>Presentaciones de compra</legend>
      <p>
        Solo para pedidos al proveedor. Agrega, por ejemplo, arroba, caja de 12
        o tira de 24 unidades.
      </p>
      {values.map((value, i) => (
        <div className="purchase-presentation-row" key={i}>
          <label>
            Presentación de compra {i + 1}
            <Input
              required
              spellCheck
              lang="es"
              maxLength={80}
              value={value}
              placeholder="Ej.: caja de 12 unidades"
              onChange={(e) =>
                onChange(values.map((v, j) => (j === i ? e.target.value : v)))
              }
            />
          </label>
          <Button
            tone="error"
            type="button"
            aria-label={`Quitar presentación de compra ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            Quitar
          </Button>
        </div>
      ))}
      {!purchaseNamesValid(values) && (
        <p role="alert">
          Escribe nombres diferentes y completa los campos vacíos.
        </p>
      )}
      <Button
        type="button"
        tone="secondary"
        disabled={values.length >= 20}
        onClick={() => onChange([...values, ""])}
      >
        Agregar presentación de compra
      </Button>
      <small>
        La unidad individual y las presentaciones de venta seguirán disponibles
        al preparar el pedido. Esto no cambia existencias ni precios.
      </small>
    </fieldset>
  );
}
