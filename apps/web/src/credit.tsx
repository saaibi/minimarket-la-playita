import React, { useEffect, useState } from "react";
import { auth } from "./session.js";
import { Button, Input, Select } from "./material.js";
import { Modal, money } from "./ui.js";
import type { OrderDraft } from "@playita/shared";
type Pending = { path: string; body: string; key: string };
const storageKey = (owner: string) => "playita-credit-attempt:" + owner;
function pending(owner: string): Pending | null {
  const raw = localStorage.getItem(storageKey(owner));
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (
    typeof p.body !== "string" ||
    typeof p.key !== "string" ||
    !/^\/credit\/(checkout|sales|sales\/[0-9a-f-]+\/payments)$/.test(p.path)
  )
    throw Error("Revisa el intento pendiente antes de continuar");
  return p;
}
export async function creditMutation(
  owner: string,
  path: string,
  payload: unknown,
) {
  const body = JSON.stringify(payload),
    old = pending(owner);
  if (old && (old.path !== path || old.body !== body))
    throw Error(
      "Hay una operación sin confirmar. Reinténtala desde Créditos antes de registrar otra.",
    );
  const attempt = old || { path, body, key: crypto.randomUUID() };
  // Persist before sending. Unknown network/5xx outcomes must reuse this key.
  localStorage.setItem(storageKey(owner), JSON.stringify(attempt));
  const response = await auth.request(
    path,
    { method: "POST", headers: { "Idempotency-Key": attempt.key }, body },
    owner,
  );
  const result = await response.json();
  if (response.ok || (response.status >= 400 && response.status < 500))
    localStorage.removeItem(storageKey(owner));
  if (!response.ok)
    throw Error(
      result.message ||
        "No se pudo confirmar la operación. Reintenta la misma solicitud.",
    );
  return result;
}
async function get(owner: string, path: string) {
  const r = await auth.request(path, {}, owner);
  if (!r.ok) throw Error("No se pudo consultar el crédito");
  return r.json();
}
export type CheckoutDraft = {
  clientId: string;
  mode: string;
  received: string;
};
export function Checkout({
  owner,
  lines,
  total,
  onSaved,
  onBusy,
  draft,
  onDraftChange,
}: {
  owner: string;
  lines: OrderDraft["lines"];
  total: number;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
  draft?: CheckoutDraft;
  onDraftChange?: (draft: CheckoutDraft) => void;
}) {
  const [localDraft, setLocalDraft] = useState<CheckoutDraft>({
      clientId: "",
      mode: "cash",
      received: "",
    }),
    [clients, setClients] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState<Pending | null>(null);
  const current = draft || localDraft,
    { clientId, mode, received } = current,
    update = onDraftChange || setLocalDraft;
  const setClientId = (clientId: string) => update({ ...current, clientId }),
    setMode = (mode: string) => update({ ...current, mode }),
    setReceived = (received: string) => update({ ...current, received });
  useEffect(() => {
    void get(owner, "/credit/clients")
      .then(setClients)
      .catch(() =>
        setError(
          "No se pudieron consultar clientes; puedes registrar pago completo sin cliente.",
        ),
      );
    try {
      setAttempt(pending(owner));
    } catch (e: any) {
      setError(e.message);
    }
  }, [owner]);
  const client = clients.find((c) => c.id === clientId),
    balance = client?.balanceCop || 0,
    cash = Number(received),
    extra = Math.max(0, cash - total),
    abono = mode === "cash_and_payment" ? Math.min(extra, balance) : 0,
    change = mode === "credit" ? 0 : Math.max(0, cash - total - abono);
  async function submit(retry = false) {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const payload =
        retry && attempt
          ? JSON.parse(attempt.body)
          : {
              lines,
              mode,
              ...(clientId ? { clientId } : {}),
              ...(mode !== "credit" ? { cashReceived: cash } : {}),
              abonoCop: abono,
            };
      await creditMutation(owner, "/credit/checkout", payload);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy(false);
      setAttempt(pending(owner));
    }
  }
  return (
    <section className="checkout">
      <div className="checkout-modes" role="group" aria-label="Tipo de cobro">
        {[
          ["cash", "Pago completo"],
          ["credit", "A crédito"],
          ["cash_and_payment", "Pago + abono"],
        ].map(([id, label]) => (
          <Button
            key={id}
            type="button"
            aria-pressed={mode === id}
            disabled={busy || !!attempt}
            onClick={() => setMode(id!)}
          >
            {label}
          </Button>
        ))}
      </div>
      <label>
        Cliente {mode === "cash" ? "(opcional)" : "registrado"}
        <Select
          value={clientId}
          disabled={busy || !!attempt}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">
            {mode === "cash" ? "Cliente general" : "Selecciona una cuenta"}
          </option>
          {clients
            .filter((c) => c.active && (mode !== "credit" || c.creditEnabled))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
      </label>
      {client && (
        <p>
          Deuda anterior: <strong>{money(balance)}</strong>
        </p>
      )}
      {mode !== "credit" && (
        <label>
          Efectivo recibido (COP)
          <Input
            type="number"
            inputMode="numeric"
            min={total}
            max={2000000000}
            step={1}
            value={received}
            disabled={busy || !!attempt}
            onChange={(e) => setReceived(e.target.value)}
          />
        </label>
      )}
      <div className="checkout-summary" aria-live="polite">
        <p>
          Productos de esta canasta: <strong>{money(total)}</strong>
        </p>
        {mode === "credit" ? (
          <p>
            Se suma a la deuda: <strong>{money(total)}</strong> · Nuevo saldo{" "}
            {money(balance + total)}
          </p>
        ) : (
          <>
            <p>
              Abono a deuda anterior: <strong>{money(abono)}</strong>
            </p>
            <p>
              Cambio: <strong>{money(change)}</strong>
            </p>
            {mode === "cash_and_payment" && (
              <p>Saldo restante: {money(balance - abono)}</p>
            )}
          </>
        )}
      </div>
      {mode === "cash_and_payment" && (!client || !balance) && (
        <p>
          Selecciona un cliente con deuda pendiente. El excedente del pago se
          abonará a sus pedidos más antiguos.
        </p>
      )}
      {mode === "credit" && client && !client.creditEnabled && (
        <p>
          Este cliente no tiene crédito habilitado. Debe autorizarlo un
          administrador.
        </p>
      )}
      {mode === "credit" && (
        <p>
          Confirma después de entregar los productos. No registra efectivo
          recibido.
        </p>
      )}
      <p role="alert">{error}</p>
      {attempt ? (
        <>
          <p>
            Hay una operación por confirmar; no registres el cobro otra vez.
          </p>
          {attempt.path === "/credit/checkout" ? (
            <Button
              className="primary"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              Reintentar la misma operación
            </Button>
          ) : (
            <p>Consulta la operación pendiente en Créditos.</p>
          )}
        </>
      ) : (
        <Button
          className="primary"
          type="button"
          disabled={
            busy ||
            !lines.length ||
            (mode !== "cash" && !clientId) ||
            (mode === "credit" && !client?.creditEnabled) ||
            (mode !== "credit" &&
              (!Number.isSafeInteger(cash) || cash < total)) ||
            (mode === "cash_and_payment" && abono <= 0)
          }
          onClick={() => void submit()}
        >
          {busy
            ? "Registrando…"
            : mode === "credit"
              ? "Anotar a crédito"
              : mode === "cash_and_payment"
                ? "Cobrar y abonar " + money(abono)
                : "Confirmar pago"}
        </Button>
      )}
    </section>
  );
}
export function Credits({
  owner,
  onChange,
}: {
  owner: string;
  onChange: (saleRecovered?: boolean) => Promise<void>;
}) {
  const [clients, setClients] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [payment, setPayment] = useState<any>(null),
    [amount, setAmount] = useState(""),
    [attempt, setAttempt] = useState<Pending | null>(null);
  async function load() {
    setClients(await get(owner, "/credit/clients"));
    setAttempt(pending(owner));
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, [owner]);
  async function mutate(path: string, payload: unknown, after?: () => void) {
    setBusy(true);
    setMessage("");
    try {
      await creditMutation(owner, path, payload);
      after?.();
      setMessage("Registro guardado");
      await load();
      if (detail) setDetail(await get(owner, "/credit/clients/" + detail.id));
      await onChange(path === "/credit/sales" || path === "/credit/checkout");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      setAttempt(pending(owner));
    }
  }
  return (
    <section className="credit-module">
      <h1>Créditos</h1>
      <p>
        Productos entregados a nombre de cada cliente, abonos en efectivo y
        saldo por cobrar.
      </p>
      {attempt && (
        <section className="panel">
          <h2>Operación por confirmar</h2>
          <p>
            La respuesta anterior no quedó confirmada. Reintenta con la misma
            clave antes de registrar otra operación. No vuelvas a recibir dinero
            por este reintento.
          </p>
          <Button
            disabled={busy}
            onClick={() => void mutate(attempt.path, JSON.parse(attempt.body))}
          >
            Consultar / reintentar operación pendiente
          </Button>
        </section>
      )}
      <p>
        Solo cuentas registradas. Para un cliente nuevo, debe registrarse con
        Google o el administrador crear su cuenta en Ajustes.
      </p>
      <p role="status">{message}</p>
      <Button
        type="button"
        disabled={busy}
        onClick={() => void load().catch((e) => setMessage(e.message))}
      >
        Actualizar saldos
      </Button>
      <p className="price">
        Por cobrar: {money(clients.reduce((n, c) => n + c.balanceCop, 0))}
      </p>
      <div className="cards">
        {clients.map((c) => (
          <article className="panel" key={c.id}>
            <h2>{c.name}</h2>
            <small>
              Crédito {c.creditEnabled ? "habilitado" : "deshabilitado"}
            </small>
            <small>{c.contact}</small>
            <p>
              Debe: <strong>{money(c.balanceCop)}</strong>
            </p>
            <small>
              Créditos {money(c.chargedCop)} · Abonos {money(c.paidCop)}
            </small>
            <Button
              onClick={() =>
                void get(owner, "/credit/clients/" + c.id)
                  .then(setDetail)
                  .catch((e) => setMessage(e.message))
              }
            >
              Ver pedidos y abonos
            </Button>
          </article>
        ))}
      </div>
      {!clients.length && <p>No hay clientes de crédito registrados.</p>}
      {detail && !payment && (
        <Modal title={"Crédito · " + detail.name} close={() => setDetail(null)}>
          <p className="price">Debe: {money(detail.balanceCop)}</p>
          {detail.orders.map((o: any) => (
            <article className="panel" key={o.id}>
              <h3>
                {new Date(o.createdAt).toLocaleString("es-CO", {
                  timeZone: "America/Bogota",
                })}
              </h3>
              {o.lines.map((l: any, i: number) => (
                <p key={i}>
                  {l.productName} · {l.quantity}{" "}
                  {l.kind === "weight" ? "g" : l.presentationName || "unidades"}{" "}
                  <strong>{money(l.totalCop)}</strong>
                </p>
              ))}
              <p>
                Total {money(o.totalCop)} · Abonado {money(o.paidCop)} ·{" "}
                <strong>Saldo {money(o.balanceCop)}</strong>
              </p>
              {o.payments.map((p: any) => (
                <small key={p.id}>
                  Abono {money(p.amountCop)} ·{" "}
                  {new Date(p.createdAt).toLocaleString("es-CO", {
                    timeZone: "America/Bogota",
                  })}
                </small>
              ))}
              {o.balanceCop > 0 && (
                <Button
                  disabled={busy || !!attempt}
                  onClick={() => {
                    setPayment(o);
                    setAmount("");
                  }}
                >
                  Registrar abono recibido
                </Button>
              )}
            </article>
          ))}
        </Modal>
      )}
      {payment && (
        <Modal
          title="Abono en efectivo"
          close={() => {
            if (!busy) setPayment(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                "/credit/sales/" + payment.id + "/payments",
                { amountCop: Number(amount) },
                () => setPayment(null),
              );
            }}
          >
            <p>
              Cliente: {detail?.name}. Saldo {money(payment.balanceCop)}.
              Confirma solo después de recibir el efectivo.
            </p>
            <label>
              Abono recibido (COP)
              <Input
                type="number"
                required
                min={1}
                max={payment.balanceCop}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <p role="alert">{message}</p>
            <Button type="submit" disabled={busy}>
              Confirmar abono recibido
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function BuyerProfile({
  owner,
  guest,
}: {
  owner: string;
  guest: boolean;
}) {
  const [profile, setProfile] = useState<any>(null),
    [orders, setOrders] = useState<any[]>([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setError("");
      const [p, list] = await Promise.all([
        get(owner, "/credit/me"),
        get(owner, "/orders"),
      ]);
      setProfile(p);
      setOrders(list);
    } catch {
      setError("No se pudo consultar tu cuenta. Vuelve a actualizar.");
    }
  }
  useEffect(() => {
    if (!guest) void load();
  }, [owner, guest]);
  if (guest)
    return (
      <section className="panel">
        <h1>Mi cuenta</h1>
        <p>
          Entra con tu cuenta de Google para consultar tu crédito, saldo y
          pedidos registrados a tu nombre.
        </p>
      </section>
    );
  function orderDetails(o: any, credit?: any) {
    return (
      <details className="panel" key={o.id}>
        <summary>
          {new Date(o.createdAt).toLocaleString("es-CO", {
            timeZone: "America/Bogota",
          })}{" "}
          · {money(o.totalCop)} · {credit ? "A crédito" : "Pedido"}
        </summary>
        <ul className="customer-list">
          {o.lines.map((l: any, i: number) => (
            <li key={i}>
              {l.productName} · {l.quantity}{" "}
              {l.kind === "weight" ? "g" : l.presentationName || "unidades"} ·{" "}
              {money(l.totalCop)}
            </li>
          ))}
        </ul>
        {credit && (
          <>
            <p>
              Abonado: {money(credit.paidCop)} · Debe:{" "}
              <strong>{money(credit.balanceCop)}</strong>
            </p>
            {credit.payments.map((p: any) => (
              <small key={p.id}>
                Abono {money(p.amountCop)} ·{" "}
                {new Date(p.createdAt).toLocaleString("es-CO", {
                  timeZone: "America/Bogota",
                })}
              </small>
            ))}
          </>
        )}
      </details>
    );
  }
  return (
    <section className="buyer-profile">
      <h1>Mi cuenta</h1>
      <Button type="button" onClick={() => void load()}>
        Actualizar mi información
      </Button>
      <p role="alert">{error}</p>
      {profile && (
        <>
          <h2>{profile.name}</h2>
          <p>
            Crédito:{" "}
            <strong>
              {profile.creditEnabled ? "Habilitado" : "No habilitado"}
            </strong>
          </p>
          <p className="price">Debes: {money(profile.balanceCop)}</p>
          <h2>Compras a crédito y abonos</h2>
          {profile.orders.length ? (
            profile.orders.map((o: any) => orderDetails(o, o))
          ) : (
            <p>No tienes compras a crédito registradas.</p>
          )}
          <h2>Otros pedidos</h2>
          {orders.filter((o) => !o.creditClientId).length ? (
            orders.filter((o) => !o.creditClientId).map((o) => orderDetails(o))
          ) : (
            <p>No hay otros pedidos registrados.</p>
          )}
        </>
      )}
    </section>
  );
}
