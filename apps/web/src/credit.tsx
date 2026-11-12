import React, { useEffect, useState } from "react";
import { auth } from "./session.js";
import { Button, Input, Select } from "./material.js";
import { Modal, money, roles } from "./ui.js";
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
  if (
    response.ok ||
    response.status === 400 ||
    response.status === 422 ||
    (response.status === 409 && result.code !== "IDEMPOTENCY_MISMATCH")
  )
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
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState<Pending | null>(null);
  const current = draft || localDraft,
    { clientId, received } = current,
    update = onDraftChange || setLocalDraft;
  async function loadClients() {
    setLoading(true);
    try {
      const list = await get(owner, "/credit/clients");
      setClients(Array.isArray(list) ? list : []);
      setError("");
    } catch {
      setError("No se pudieron consultar cuentas. Pulsa Actualizar cuentas.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadClients();
    try {
      setAttempt(pending(owner));
    } catch (e: any) {
      setError(e.message);
    }
  }, [owner]);
  const client = clients.find((c) => c.id === clientId),
    balance = client?.balanceCop || 0,
    cash = Number(received),
    newCredit = Math.max(0, total - cash),
    abono = Math.min(Math.max(0, cash - total), balance),
    change = Math.max(0, cash - total - abono),
    paidNow = Math.min(Math.max(0, cash), total),
    futureBalance = balance + newCredit - abono;
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
              mode: "auto",
              ...(clientId ? { clientId } : {}),
              cashReceived: cash,
              expectedTotalCop: total,
              expectedBalanceCop: balance,
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
      <label>
        Cliente (obligatorio si queda saldo pendiente)
        <Select
          value={clientId}
          disabled={busy || !!attempt || loading}
          onChange={(e) => update({ ...current, clientId: e.target.value })}
        >
          <option value="">Cliente general</option>
          {clients
            .filter(
              (c) =>
                c.active &&
                (received === "" || newCredit === 0 || c.creditEnabled),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.role ? " · " + roles[c.role as keyof typeof roles] : ""}
              </option>
            ))}
        </Select>
      </label>
      <Button
        type="button"
        disabled={busy || loading || !!attempt}
        onClick={() => void loadClients()}
      >
        {loading ? "Cargando cuentas…" : "Actualizar cuentas"}
      </Button>
      <label>
        Efectivo recibido (COP)
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={2000000000}
          step={1}
          value={received}
          disabled={busy || !!attempt}
          placeholder="0 para dejar todo a crédito"
          onChange={(e) => update({ ...current, received: e.target.value })}
        />
      </label>
      {client && (
        <p>
          Crédito:{" "}
          <strong>
            {client.creditEnabled ? "Habilitado" : "No habilitado"}
          </strong>
        </p>
      )}
      {newCredit > 0 &&
        received !== "" &&
        !clients.some((c) => c.active && c.creditEnabled) && (
          <p>
            No hay cuentas con crédito habilitado. El administrador puede
            activarlo en Ajustes → Clientes → Editar cliente.
          </p>
        )}
      <div className="checkout-summary" aria-live="polite">
        {client && (
          <p>
            Deuda actual: <strong>{money(balance)}</strong>
          </p>
        )}
        <p>
          Productos de esta canasta: <strong>{money(total)}</strong>
        </p>
        <p>
          Pago de esta compra: <strong>{money(paidNow)}</strong>
        </p>
        <p>
          Nuevo crédito: <strong>{money(newCredit)}</strong>
        </p>
        <p>
          Abono a deuda anterior: <strong>{money(abono)}</strong>
        </p>
        <p>
          Cambio: <strong>{money(change)}</strong>
        </p>
        {client && (
          <p>
            Saldo después de confirmar: <strong>{money(futureBalance)}</strong>
          </p>
        )}
      </div>
      {client && balance > 0 && (
        <p>
          El excedente se abona a la deuda anterior; después de saldarla, el
          resto es cambio.
        </p>
      )}
      {newCredit > 0 && (
        <p>
          Para anotar saldo pendiente selecciona una cuenta activa con crédito
          habilitado. Confirma después de entregar los productos.
        </p>
      )}
      <p role="alert">{error}</p>
      {attempt ? (
        <>
          <p>
            Hay una operación por confirmar. No registres el cobro otra vez.
          </p>
          {attempt.path === "/credit/checkout" ? (
            <Button
              className="primary"
              type="button"
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
            received.trim() === "" ||
            !Number.isSafeInteger(cash) ||
            cash < 0 ||
            (newCredit > 0 && (!client?.active || !client?.creditEnabled))
          }
          onClick={() => void submit()}
        >
          {busy
            ? "Registrando…"
            : newCredit > 0
              ? "Anotar a crédito " + money(newCredit)
              : abono > 0
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
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("enabled"),
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
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const visibleClients = clients.filter(
    (c) =>
      (filter === "enabled" ? c.creditEnabled : c.balanceCop > 0) &&
      normalize(c.name + " " + (c.contact || "")).includes(
        normalize(search.trim()),
      ),
  );
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
      <div className="form-grid">
        <label>
          Buscar cuenta
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre o correo"
          />
        </label>
        <label>
          Mostrar
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="enabled">Crédito habilitado</option>
            <option value="pending">Saldos pendientes</option>
          </Select>
        </label>
      </div>
      <p className="price">
        Por cobrar total: {money(clients.reduce((n, c) => n + c.balanceCop, 0))}
      </p>
      <div className="cards">
        {visibleClients.map((c) => (
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
      {!visibleClients.length && (
        <p>No hay cuentas que coincidan con este filtro.</p>
      )}
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
