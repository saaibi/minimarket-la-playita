import React from "react";
import { Input, Button } from "./material.js";
import { money } from "./ui.js";
export type OpeningInfo = { id: string; amountCop: number; note: string };
export function OpeningBalanceFields({
  enabled,
  existing,
  amount,
  note,
  onAmount,
  onNote,
}: {
  enabled: boolean;
  existing?: OpeningInfo | null;
  amount: string;
  note: string;
  onAmount: (v: string) => void;
  onNote: (v: string) => void;
}) {
  if (existing)
    return (
      <p>
        Saldo anterior registrado: <strong>{money(existing.amountCop)}</strong>.
        Consulta su saldo y abonos en Créditos.
      </p>
    );
  if (!enabled) return null;
  return (
    <fieldset className="opening-balance-fields">
      <legend>Saldo anterior (opcional)</legend>
      <p>
        Deuda previa sin detalle de productos. Se registra una sola vez y no
        cuenta como venta.
      </p>
      <label>
        Valor pendiente anterior (COP)
        <Input
          type="number"
          min="1"
          max="2000000000"
          step="1"
          inputMode="numeric"
          value={amount}
          placeholder="Sin saldo anterior"
          onChange={(e) => onAmount(e.target.value)}
        />
      </label>
      {amount !== "" && (
        <label>
          Nota del saldo anterior
          <Input
            required
            minLength={3}
            maxLength={300}
            spellCheck
            lang="es"
            value={note}
            onChange={(e) => onNote(e.target.value)}
          />
        </label>
      )}
    </fieldset>
  );
}
export function openingPayload(
  enabled: boolean,
  existing: OpeningInfo | null | undefined,
  amount: string,
  note: string,
) {
  return enabled && !existing && amount !== ""
    ? { openingBalance: { amountCop: Number(amount), note } }
    : {};
}
export function OpeningBalanceDetails({
  value,
  onPayment,
  disabled = false,
}: {
  value: any;
  onPayment?: () => void;
  disabled?: boolean;
}) {
  return (
    <article className="panel opening-balance-detail">
      <h3>Saldo anterior</h3>
      <p>{value.note}</p>
      <small>
        Registrado{" "}
        {new Date(value.createdAt).toLocaleString("es-CO", {
          timeZone: "America/Bogota",
        })}
      </small>
      <p>
        Inicial: {money(value.totalCop)} · Abonado: {money(value.paidCop)} ·{" "}
        <strong>Debe: {money(value.balanceCop)}</strong>
      </p>
      {value.payments.map((p: any) => (
        <small key={p.id}>
          Abono {money(p.amountCop)} ·{" "}
          {new Date(p.createdAt).toLocaleString("es-CO", {
            timeZone: "America/Bogota",
          })}
        </small>
      ))}
      {onPayment && value.balanceCop > 0 && (
        <Button disabled={disabled} onClick={onPayment}>
          Registrar abono al saldo anterior
        </Button>
      )}
    </article>
  );
}

export function accountSaveError(value: string) {
  if (value.includes("OPENING_ALREADY_RECORDED"))
    return "Esta cuenta ya tiene un saldo anterior registrado. Consulta sus abonos en Créditos.";
  if (value.includes("CREDIT_DISABLED"))
    return "Habilita el crédito para registrar un saldo anterior.";
  if (value.includes("EMAIL_IN_USE"))
    return "El correo ya pertenece a otra cuenta.";
  return "No se pudo guardar la cuenta. Revisa el correo, los campos y los permisos.";
}
