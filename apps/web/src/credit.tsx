import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import React, { useEffect, useState, useRef } from "react";
import { openNativeOutbox, type Outbox } from "@playita/mobile";
import { native, auth } from "./session.js";
import { Button, Input, Select } from "./material.js";
import { Modal, money, roles } from "./ui.js";
import type { OrderDraft } from "@playita/shared";
type Pending = { path: string; body: string; key: string };
const storageKey = (owner: string) => "playita-credit-attempt:" + owner;
function browserPending(owner: string): Pending | null {
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
const nativeBoxes = new Map<string, Promise<Outbox>>();
function creditBox(owner: string) {
  if (!nativeBoxes.has(owner))
    nativeBoxes.set(
      owner,
      openNativeOutbox(owner).catch((error) => {
        nativeBoxes.delete(owner);
        throw error;
      }),
    );
  return nativeBoxes.get(owner)!;
}
async function pending(owner: string): Promise<Pending | null> {
  if (!native) return browserPending(owner);
  const box = await creditBox(owner),
    legacy = browserPending(owner);
  if (legacy) {
    await box.prepareCreditAttempt(legacy.key, JSON.stringify(legacy));
    localStorage.removeItem(storageKey(owner));
  }
  const row = await box.pendingCreditAttempt();
  return row ? JSON.parse(row.payload) : null;
}
async function saveAttempt(owner: string, attempt: Pending) {
  if (native)
    await (
      await creditBox(owner)
    ).prepareCreditAttempt(attempt.key, JSON.stringify(attempt));
  else localStorage.setItem(storageKey(owner), JSON.stringify(attempt));
}
async function finishAttempt(owner: string, key: string) {
  if (native) await (await creditBox(owner)).finishCreditAttempt(key);
  else localStorage.removeItem(storageKey(owner));
}
export async function creditMutation(
  owner: string,
  path: string,
  payload: unknown,
) {
  const body = JSON.stringify(payload),
    old = await pending(owner);
  if (old && (old.path !== path || old.body !== body))
    throw Error(
      "Hay una operación sin confirmar. Reinténtala desde Créditos antes de registrar otra.",
    );
  const attempt = old || { path, body, key: crypto.randomUUID() };
  // Persist before sending. Unknown network/5xx outcomes must reuse this key.
  await saveAttempt(owner, attempt);
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
    await finishAttempt(owner, attempt.key);
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
    [clientSearch, setClientSearch] = useState(""),
    [clients, setClients] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState<Pending | null>(null);
  const current = draft || localDraft,
    { clientId, received } = current,
    update = onDraftChange || setLocalDraft;
  const clientsLoading = useRef(false);
  async function loadClients() {
    if (clientsLoading.current) return;
    clientsLoading.current = true;
    setLoading(true);
    try {
      const list = await get(owner, "/credit/clients");
      setClients(Array.isArray(list) ? list : []);
      setError("");
    } catch {
      setError(
        "No se pudieron consultar cuentas. Vuelve a abrir el selector para reintentar.",
      );
    } finally {
      clientsLoading.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadClients();
    void pending(owner)
      .then(setAttempt)
      .catch((e) => setError(e.message));
  }, [owner]);
  const client = clients.find((c) => c.id === clientId),
    balance = client?.balanceCop || 0,
    cash = Number(received),
    newCredit = Math.max(0, total - cash),
    abono = client?.creditEnabled
      ? Math.min(Math.max(0, cash - total), balance)
      : 0,
    change = Math.max(0, cash - total - abono),
    paidNow = Math.min(Math.max(0, cash), total),
    futureBalance = balance + newCredit - abono;
  useEffect(() => {
    if (client) setClientSearch(client.name);
  }, [client?.id, client?.name]);
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
              expectedCreditEnabled: !!client?.creditEnabled,
            };
      await creditMutation(owner, "/credit/checkout", payload);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy(false);
      setAttempt(await pending(owner));
    }
  }
  return (
    <section className="checkout">
      <div className="account-picker">
        <label htmlFor="checkout-client">Cliente (opcional)</label>
        <Autocomplete
          id="checkout-client"
          options={[
            { id: "", name: "Cliente general" },
            ...clients.filter((c) => c.active),
          ]}
          value={client || null}
          inputValue={clientSearch}
          blurOnSelect
          onInputChange={(_event, text, reason) => {
            if (reason === "input" || reason === "clear") {
              setClientSearch(text);
              if (clientId) update({ ...current, clientId: "" });
            }
          }}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          disabled={busy || !!attempt}
          onOpen={() => void loadClients()}
          loading={loading}
          loadingText="Actualizando cuentas…"
          onChange={(_event, selected) => {
            setClientSearch(selected?.id ? selected.name : "");
            update({ ...current, clientId: selected?.id || "" });
          }}
          noOptionsText="No se encontraron cuentas"
          openText="Buscar cliente"
          closeText="Cerrar opciones"
          clearText="Borrar cliente"
          size="small"
          fullWidth
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Cliente general · buscar cuenta"
            />
          )}
          renderOption={(props, option) => {
            const { key, ...rest } = props;
            return (
              <li
                key={key}
                {...rest}
                className={`${props.className || ""} account-option`}
              >
                <span>{option.name}</span>
                {option.role && (
                  <small>{roles[option.role as keyof typeof roles]}</small>
                )}
              </li>
            );
          }}
        />
      </div>
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
          placeholder={
            client?.creditEnabled
              ? "0 para dejar todo a crédito"
              : "Ingresa el efectivo recibido"
          }
          onChange={(e) => update({ ...current, received: e.target.value })}
        />
      </label>
      {client?.creditEnabled ? (
        <>
          <p>
            Crédito: <strong>Habilitado</strong>
          </p>
          <div className="checkout-summary" aria-live="polite">
            <p>
              Deuda actual: <strong>{money(balance)}</strong>
            </p>
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
            <p>
              Saldo después de confirmar:{" "}
              <strong>{money(futureBalance)}</strong>
            </p>
          </div>
          {balance > 0 && (
            <p>
              El excedente se abona a la deuda anterior; después de saldarla, el
              resto es cambio.
            </p>
          )}
        </>
      ) : (
        <div
          className={
            "cash-feedback " +
            (received.trim() === ""
              ? "neutral"
              : newCredit > 0
                ? "shortage"
                : "change")
          }
          role="status"
        >
          {received.trim() === "" ? (
            <p>Ingresa el efectivo recibido para calcular el cambio.</p>
          ) : newCredit > 0 ? (
            <p>
              Faltan: <strong>{money(newCredit)}</strong>
            </p>
          ) : (
            <p>
              Cambio: <strong>{money(change)}</strong>
            </p>
          )}
        </div>
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
            : newCredit > 0 && client?.creditEnabled
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
  refreshToken = 0,
}: {
  owner: string;
  onChange: (saleRecovered?: boolean) => Promise<void>;
  refreshToken?: number;
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
    setAttempt(await pending(owner));
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, [owner, refreshToken]);
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
      setAttempt(await pending(owner));
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
      <div className="cards credit-grid">
        {visibleClients.map((c) => (
          <article className="panel credit-account-card" key={c.id}>
            <h2>{c.name}</h2>
            <small>
              Crédito {c.creditEnabled ? "habilitado" : "deshabilitado"}
            </small>
            {c.contact && <small>{c.contact}</small>}
            <p
              className={
                "credit-account-balance " +
                (c.balanceCop > 0 ? "outstanding" : "settled")
              }
            >
              {c.balanceCop > 0 ? "Debe:" : "Al día:"}{" "}
              <strong>{money(c.balanceCop)}</strong>
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
  refreshToken = 0,
}: {
  owner: string;
  guest: boolean;
  refreshToken?: number;
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
  }, [owner, guest, refreshToken]);
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
