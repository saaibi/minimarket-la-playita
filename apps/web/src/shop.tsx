import { remainingStock, assertCartAddition } from "./cart-stock.js";
import { Credits, Checkout, BuyerProfile } from "./credit.js";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import { Button, Input, Select, TextSizeSettings } from "./material.js";
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  type Product,
  type OrderDraft,
  type Schedule,
  grams,
  lineTotal,
  isStoreOpen,
} from "@playita/shared";
import {
  openNativeOutbox,
  Outbox,
  Synchronizer,
  type OutboxRow,
} from "@playita/mobile";
import { auth, useSession, native, base } from "./session.js";
import { Brand, Icon, Modal, money, roles, modulesFor } from "./ui.js";
import { Inventory, Settings } from "./management.js";
type Order = {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  clientName: string;
  creditClientId?: string;
  clientReference: string;
  totalCop: number;
  createdAt: string;
  channel: string;
  lines: {
    productName: string;
    presentationName: string;
    quantity: number;
    kind: string;
    totalCop: number;
  }[];
};
type Notice = {
  id: string;
  kind: string;
  read: boolean;
  createdAt: string;
  payload: {
    orderId?: string;
    name?: string;
    available?: number;
    minimum?: number;
    kind?: string;
  };
};
const stateName: Record<string, string> = {
  confirmed: "Nuevo",
  accepted: "Aceptado",
  ready: "Listo para recoger",
  delivered: "Entregado",
  cancelled: "Cancelado",
};
const statusName: Record<string, string> = {
  pending_sync: "Pendiente de conexión",
  syncing: "Enviando",
  synced: "Confirmado en tienda",
  conflict: "Requiere revisión",
};
export function Shop() {
  const session = useSession()!,
    role = session.actor.role,
    admin = role === "admin",
    staff = role !== "buyer";
  const [view, setView] = useState(
      staff ? (admin ? "inventory" : "pos") : "catalog",
    ),
    [products, setProducts] = useState<Product[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [schedule, setSchedule] = useState<Schedule | null>(null),
    [notices, setNotices] = useState<Notice[]>([]),
    [cart, setCart] = useState<OrderDraft["lines"]>([]),
    [client, setClient] = useState(""),
    [reference, setReference] = useState(""),
    [cash, setCash] = useState(""),
    [checkoutDraft, setCheckoutDraft] = useState({
      clientId: "",
      mode: "cash",
      received: "",
    }),
    [clients, setClients] = useState<
      { id: string; name: string; contact: string }[]
    >([]),
    [category, setCategory] = useState("all"),
    [payment, setPayment] = useState<"cash" | "nequi">("cash"),
    [rows, setRows] = useState<OutboxRow[]>([]),
    [message, setMessage] = useState("Consultando la tienda…"),
    [cartOpen, setCartOpen] = useState(false),
    [bellOpen, setBellOpen] = useState(false),
    [noticeTab, setNoticeTab] = useState("orders"),
    [selected, setSelected] = useState<Order | null>(null),
    [confirmRemoveSale, setConfirmRemoveSale] = useState(false),
    [search, setSearch] = useState(""),
    [orderFilter, setOrderFilter] = useState("active"),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState<string | null>(null),
    [pendingSale, setPendingSale] = useState(false);
  const [ownCreditEnabled, setOwnCreditEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    const refreshCredit = async () => {
      if (staff || session.mode !== "authenticated") return;
      try {
        const r = await auth.request("/credit/me", {}, session.actor.id);
        if (r.ok) {
          const profile = await r.json();
          if (active) {
            setOwnCreditEnabled(profile.creditEnabled === true);
            if (!profile.creditEnabled)
              setView((current) =>
                current === "profile" ? "catalog" : current,
              );
          }
        }
      } catch {
        /* Keep current navigation while offline. */
      }
    };
    void refreshCredit();
    window.addEventListener("focus", refreshCredit);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshCredit);
    };
  }, [session.actor.id, session.mode, staff]);
  const cartSnapshot = useRef(cart);
  cartSnapshot.current = cart;
  const box = useRef<Outbox | null>(null),
    worker = useRef<Synchronizer | null>(null),
    webAttempt = useRef<{ key: string; payload: string; route: string } | null>(
      null,
    );
  async function request(path: string, init: RequestInit = {}) {
    const r = await auth.request(path, init, session.actor.id);
    const d = await r.json();
    if (!r.ok)
      throw Error(
        d.message ||
          (
            {
              FORBIDDEN: "No tienes permiso para esta acción",
              VALIDATION_ERROR: "Revisa los campos y las presentaciones",
              PAYMENT_NOT_INTEGRATED: "Nequi todavía no está integrado",
            } as any
          )[d.code] ||
          d.code ||
          "No fue posible completar la solicitud",
      );
    return d;
  }
  async function reload() {
    const [list, os, config, ns] = await Promise.all([
      request("/inventory"),
      request("/orders"),
      request("/settings"),
      request("/notifications"),
    ]);
    setProducts(list);
    setOrders(os);
    setSchedule(config);
    setNotices(ns);
    if (staff) setClients(await request("/clients"));
    // A cache write failure must not turn an accepted server action into an error.
    try {
      await box.current?.saveCatalog(list);
    } catch {
      setMessage(
        "La tienda está actualizada; no se pudo guardar la copia sin conexión.",
      );
    }
  }
  useEffect(() => {
    let active = true,
      ownBox: Outbox | null = null,
      ownWorker: Synchronizer | null = null;
    const socket = io(base.startsWith("/") ? window.location.origin : base, {
      withCredentials: true,
      autoConnect: false,
    });
    async function update() {
      if (ownBox && active) setRows(await ownBox.list());
    }
    async function refresh() {
      try {
        const list = await request("/inventory");
        const [os, config, ns] = await Promise.all([
          request("/orders"),
          request("/settings"),
          request("/notifications"),
        ]);
        if (active) {
          setProducts(list);
          setOrders(os);
          setSchedule(config);
          setNotices(ns);
          if (staff) setClients(await request("/clients"));
          setMessage("Información actualizada de la tienda");
          try {
            await ownBox?.saveCatalog(list);
          } catch {
            if (active)
              setMessage(
                "La tienda está actualizada; no se pudo guardar la copia sin conexión.",
              );
          }
        }
      } catch {
        const cached = await ownBox?.catalog().catch(() => null);
        if (active) {
          if (cached)
            setProducts(
              (cached.data as Product[]).map((p) =>
                admin ? p : (({ costCop, ...rest }) => rest)(p),
              ),
            );
          setMessage(
            cached
              ? "Sin conexión. Catálogo guardado; disponibilidad pendiente de confirmar."
              : "No fue posible consultar la tienda. Revisa la conexión o vuelve a ingresar.",
          );
        }
      }
    }
    async function work() {
      try {
        await auth.flushLogout();
        if (
          auth.current?.actor.id === session.actor.id &&
          auth.current.mode === "authenticated"
        )
          await ownWorker?.sync();
        await update();
      } catch {
        if (active)
          setMessage(
            "Envío pausado. Tus pendientes se conservan para esta misma cuenta.",
          );
      }
    }
    void (async () => {
      try {
        if (native) {
          ownBox = await openNativeOutbox(session.actor.id);
          if (!active) return;
          ownWorker = new Synchronizer(
            ownBox,
            auth.transport(session.actor.id),
          );
          box.current = ownBox;
          worker.current = ownWorker;
          await update();
          const pending = staff ? await ownBox.pendingSale() : null;
          if (pending) {
            const d = JSON.parse(pending.payload) as OrderDraft;
            setCart(d.lines);
            setClient(d.client?.name || "");
            setReference(d.client?.reference || "");
            setPendingSale(true);
            setCash(
              String(
                (d as OrderDraft & { cashReceived?: number }).cashReceived ||
                  "",
              ),
            );
            setView("pos");
            setCartOpen(true);
          }
        }
        await refresh();
        if (session.mode === "authenticated") {
          socket.auth = await auth.socketCredentials(session.actor.id);
          if (active) socket.connect();
        }
      } catch {
        if (active)
          setMessage(
            "No se pudo abrir la sesión local. Los datos conservados no se han borrado.",
          );
      }
    })();
    socket.on("connect", () => {
      void refresh();
      void work();
    });
    socket.on("change", () => void refresh());
    const interval = setInterval(() => void work(), 5000),
      renew = setTimeout(
        () => {
          if (session.mode === "authenticated")
            void auth
              .refresh()
              .catch(() =>
                setMessage("Vuelve a ingresar para enviar tus pendientes."),
              );
        },
        Math.max(1000, session.accessExpiresAt - Date.now() - 30000),
      );
    window.addEventListener("online", work);
    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(renew);
      socket.disconnect();
      window.removeEventListener("online", work);
      box.current = null;
      worker.current = null;
    };
  }, [session]);
  const total = cart.reduce(
    (sum, l) =>
      sum +
      lineTotal(
        products.find((p) => p.id === l.productId)?.kind || "unit",
        l.quantity,
        l.expectedPriceCop,
      ),
    0,
  );
  const open = schedule ? isStoreOpen(schedule) : null;
  async function send() {
    if (busy) return;
    setBusy(true);
    let saleKey: string | undefined;
    try {
      if (!cart.length) throw Error("Tu canasta está vacía");
      const sale = staff;
      const draft: OrderDraft = {
        lines: cart,
        paymentMethod: sale ? "cash" : payment,
        ...(client.trim()
          ? {
              client: {
                name: client.trim(),
                ...(reference.trim() ? { reference: reference.trim() } : {}),
              },
            }
          : {}),
      };
      if (sale) {
        if (session.mode !== "authenticated" || !navigator.onLine)
          throw Error(
            "La venta POS requiere conexión y sesión activa. No se confirma un cobro sin respuesta de la tienda.",
          );
        if (!Number.isSafeInteger(Number(cash)) || Number(cash) < total)
          throw Error("El efectivo recibido no cubre el total");
        const payload = JSON.stringify({
          ...draft,
          cashReceived: Number(cash),
        });
        if (native) {
          if (!box.current)
            throw Error("Preparando almacenamiento local; vuelve a intentar");
          saleKey = await box.current.prepareSale({
            ...draft,
            cashReceived: Number(cash),
          });
          setPendingSale(true);
        } else {
          if (webAttempt.current && webAttempt.current.payload !== payload)
            throw Error(
              "Retoma la solicitud pendiente antes de cambiar la venta",
            );
          if (!webAttempt.current)
            webAttempt.current = {
              key: crypto.randomUUID(),
              payload,
              route: "/sales",
            };
          saleKey = webAttempt.current.key;
        }
        const response = await auth.request(
          "/sales",
          {
            method: "POST",
            headers: { "Idempotency-Key": saleKey },
            body: payload,
          },
          session.actor.id,
        );
        const data = await response.json();
        if (!response.ok) {
          if ([400, 409, 422].includes(response.status)) {
            await box.current?.finishSale(saleKey, data, true);
            webAttempt.current = null;
            setPendingSale(false);
          }
          throw Error(
            data.message ||
              "No se confirmó la venta. Reintenta con la misma canasta.",
          );
        }
        await box.current?.finishSale(saleKey, data);
        setPendingSale(false);
        webAttempt.current = null;
        setMessage(
          "Venta registrada · " + money(data.totalCop) + " · Efectivo recibido",
        );
        setSelected(data);
      } else if (native) {
        if (!box.current) throw Error("Preparando almacenamiento local");
        if (revision) {
          await box.current.revise(revision, draft);
          setRevision(null);
        } else await box.current.enqueue(draft);
        setRows(await box.current.list());
        if (session.mode === "authenticated") await worker.current?.sync();
        setRows(await box.current.list());
        setMessage(
          "Pedido guardado. Revisa su confirmación en Mis pedidos; sin red no reserva inventario.",
        );
      } else {
        const payload = JSON.stringify(draft);
        if (webAttempt.current && webAttempt.current.payload !== payload)
          throw Error(
            "Reintenta primero la solicitud pendiente con la misma canasta",
          );
        if (!webAttempt.current)
          webAttempt.current = {
            key: crypto.randomUUID(),
            payload,
            route: "/orders",
          };
        const response = await auth.request(
          "/orders",
          {
            method: "POST",
            headers: { "Idempotency-Key": webAttempt.current.key },
            body: payload,
          },
          session.actor.id,
        );
        const data = await response.json();
        if (!response.ok) {
          if ([400, 409, 422].includes(response.status))
            webAttempt.current = null;
          throw Error(
            data.message ||
              "No fue posible confirmar el pedido; reintenta con la misma canasta",
          );
        }
        webAttempt.current = null;
        setMessage("Pedido recibido por la tienda. El pago sigue pendiente.");
        setSelected(data);
      }
      setCart([]);
      setClient("");
      setReference("");
      setCash("");
      setCartOpen(false);
      await reload();
    } catch (e) {
      setMessage(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  async function action(o: Order, action: string) {
    setBusy(true);
    try {
      const updated = await request("/orders/" + o.id + "/actions", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action }),
      });
      if (selected?.id === o.id) setSelected(updated);
      await reload();
      setMessage("Pedido actualizado");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (
      (session.actor.guest &&
        rows.some((r) => !r.resolved_by && r.status !== "synced")) ||
      pendingSale
    ) {
      setMessage(
        "Resuelve los pendientes de esta cuenta antes de salir para conservar su recuperación.",
      );
      return;
    }
    await auth.logout();
  }
  async function openNotice(n: Notice) {
    try {
      await request("/notifications/" + n.id + "/read", {
        method: "POST",
        body: "{}",
      });
      setNotices((ns) =>
        ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      );
      if (n.payload.orderId) {
        setSelected(await request("/orders/" + n.payload.orderId));
        setView("orders");
        setBellOpen(false);
      } else {
        setView("inventory");
        setBellOpen(false);
      }
    } catch (e) {
      setMessage(String(e));
    }
  }
  function noticesBody() {
    const list = notices.filter((n) =>
      noticeTab === "orders"
        ? n.kind.startsWith("order.")
        : n.kind === "inventory.changed",
    );
    return (
      <>
        <div className="notification-tabs">
          <Button
            aria-pressed={noticeTab === "orders"}
            onClick={() => setNoticeTab("orders")}
          >
            Pedidos
          </Button>
          {staff && (
            <Button
              aria-pressed={noticeTab === "inventory"}
              onClick={() => setNoticeTab("inventory")}
            >
              Inventario
            </Button>
          )}
        </div>
        <Button
          onClick={() =>
            void (async () => {
              try {
                await Promise.all(
                  list
                    .filter((n) => !n.read)
                    .map((n) =>
                      request("/notifications/" + n.id + "/read", {
                        method: "POST",
                        body: "{}",
                      }),
                    ),
                );
                await reload();
              } catch {
                setMessage("No se pudieron marcar los avisos");
              }
            })()
          }
        >
          Marcar esta sección como leída
        </Button>
        {list.length ? (
          list.map((n) => (
            <Button
              className={"notification " + (n.read ? "" : "unread")}
              key={n.id}
              onClick={() => void openNotice(n)}
            >
              <strong>
                {n.kind.startsWith("order.")
                  ? "Pedido · " + (stateName[n.kind.slice(6)] || "Actualizado")
                  : "Inventario actualizado"}
              </strong>
              <small>
                {new Date(n.createdAt).toLocaleString("es-CO", {
                  timeZone: "America/Bogota",
                })}{" "}
                · {n.read ? "Leída" : "Sin leer"}
              </small>
              {n.kind === "inventory.changed" && (
                <span>
                  {n.payload.name}
                  <small>
                    {n.payload.available} disponibles · Mínimo{" "}
                    {n.payload.minimum}{" "}
                    {n.payload.kind === "weight" ? "g" : "unidades"}
                  </small>
                </span>
              )}
              <span>
                {n.payload.orderId
                  ? "Ver pedido y acciones"
                  : "Consultar inventario"}
              </span>
            </Button>
          ))
        ) : (
          <p className="empty">No hay notificaciones en esta sección.</p>
        )}
      </>
    );
  }
  function orderCard(o: Order, detail = true) {
    return (
      <article className="panel order-card" key={o.id}>
        <div className="heading">
          <div>
            <small>
              {new Date(o.createdAt).toLocaleString("es-CO", {
                timeZone: "America/Bogota",
              })}{" "}
              · {o.channel === "pos" ? "Venta POS" : "Recogida en tienda"}
            </small>
            <h3>{o.clientName}</h3>
            <small>Pedido {o.id.slice(0, 8)}</small>
          </div>
          <span className="tag">{stateName[o.status]}</span>
        </div>
        <p className="price">{money(o.totalCop)}</p>
        <small>
          {o.creditClientId
            ? o.paymentStatus === "paid"
              ? "Crédito saldado"
              : "Crédito pendiente"
            : o.paymentStatus === "paid"
              ? "Efectivo confirmado"
              : o.paymentMethod === "nequi"
                ? "Nequi pendiente · integración no disponible"
                : "Efectivo pendiente"}
        </small>
        {detail && <Button onClick={() => setSelected(o)}>Ver detalle</Button>}
        {!["delivered", "cancelled"].includes(o.status) && (
          <div className="actions">
            {staff && o.status === "confirmed" && (
              <Button disabled={busy} onClick={() => void action(o, "accept")}>
                Aceptar
              </Button>
            )}
            {staff && o.status === "accepted" && (
              <Button disabled={busy} onClick={() => void action(o, "ready")}>
                Marcar listo
              </Button>
            )}
            {staff &&
              o.paymentMethod === "cash" &&
              o.paymentStatus !== "paid" && (
                <Button
                  disabled={busy}
                  onClick={() => void action(o, "pay_cash")}
                >
                  Confirmar efectivo recibido
                </Button>
              )}
            {staff && o.status === "ready" && o.paymentStatus === "paid" && (
              <Button
                className="primary"
                disabled={busy}
                onClick={() => void action(o, "deliver")}
              >
                Entregar
              </Button>
            )}
            {o.paymentStatus !== "paid" && (
              <Button disabled={busy} onClick={() => void action(o, "cancel")}>
                Cancelar pedido
              </Button>
            )}
          </div>
        )}
      </article>
    );
  }
  const filteredOrders = orders.filter((o) =>
    view === "history"
      ? o.status === "delivered" &&
        (o.paymentStatus === "paid" || !!o.creditClientId)
      : orderFilter === "all" || !["delivered", "cancelled"].includes(o.status),
  );
  return (
    <>
      <aside className="sidebar">
        <Brand />
        <p className="aside-label">CERCA DE TI, CADA DÍA</p>
        <nav aria-label="Módulos">
          {modulesFor(role)
            .filter(
              ([id]) =>
                (id !== "settings" ||
                  !admin ||
                  session.mode === "authenticated") &&
                (id !== "profile" || ownCreditEnabled),
            )
            .map(([id, label]) => (
              <Button
                key={id}
                className={view === id ? "active" : ""}
                disabled={pendingSale && id !== "pos"}
                onClick={() => {
                  setView(id);
                  if (id === "notifications") setNoticeTab("orders");
                }}
              >
                <Icon name={id === "notifications" ? "bell" : id} />
                <span>{label}</span>
              </Button>
            ))}
        </nav>
        <div className="aside-bottom">
          Hecho para nuestra comunidad.<small>Recogida en tienda · COP</small>
        </div>
      </aside>
      <div className="shell">
        <div className="sticky-shop-top">
          <header>
            <div className="header-brand">
              <Brand compact />
              <div>
                <Chip
                  className="store-status"
                  size="small"
                  role="status"
                  aria-live="polite"
                  label={
                    open === null
                      ? "Consultando horario"
                      : open
                        ? "Abierta"
                        : "Cerrada"
                  }
                  color={open === null ? "default" : open ? "success" : "error"}
                  variant="outlined"
                />
              </div>
            </div>
            <div className="header-actions">
              <Button
                className="icon-button"
                aria-label="Ver canasta"
                onClick={() => setCartOpen(true)}
              >
                <Icon name="basket" />
                {cart.length > 0 && (
                  <span className="badge">{cart.length}</span>
                )}
              </Button>
              <Button
                className="icon-button"
                aria-label="Notificaciones"
                onClick={() => {
                  setNoticeTab("orders");
                  setBellOpen(true);
                }}
              >
                <Icon name="bell" />
                {notices.some((n) => !n.read) && (
                  <span className="badge">
                    {notices.filter((n) => !n.read).length}
                  </span>
                )}
              </Button>
              <div className="identity">
                <strong>{roles[role]}</strong>
                <small>{session.actor.label}</small>
              </div>
              <Button onClick={() => void logout()}>Salir</Button>
            </div>
          </header>
          <div className="environment-banner">RECOGIDA EN TIENDA · COP</div>
          {cart.length > 0 && (
            <div className="cart-dock">
              <span>
                {cart.length} líneas en la canasta{" "}
                <strong>{money(total)}</strong>
              </span>
              <Button onClick={() => setCartOpen(true)}>Ver canasta</Button>
            </div>
          )}
        </div>
        <main>
          <p className="status" role="status">
            {message}
          </p>
          {session.mode === "offline" && (
            <p className="notice">
              Sesión local sin autenticar. Conserva tu cuenta y vuelve a
              ingresar para sincronizar.
            </p>
          )}
          {view === "inventory" && staff && (
            <Inventory
              products={products}
              admin={admin && session.mode === "authenticated"}
              api={request}
              reload={reload}
              ordersCount={
                orders.filter(
                  (o) => !["delivered", "cancelled"].includes(o.status),
                ).length
              }
              salesTotal={orders
                .filter((o) => o.status === "delivered")
                .reduce((s, o) => s + o.totalCop, 0)}
              onNavigate={setView}
            />
          )}
          {(view === "catalog" || view === "pos") && (
            <>
              <section className={view === "catalog" ? "intro hero" : "intro"}>
                <p className="eyebrow">DEL CAMPO A TU MESA</p>
                <h1>
                  {view === "pos" ? (
                    "Una venta, bien hecha"
                  ) : (
                    <>
                      Lo de siempre,
                      <br />
                      más cerca de ti.
                    </>
                  )}
                </h1>
                <p>
                  {view === "pos"
                    ? "Agrega productos y registra pagos, créditos o abonos desde la canasta."
                    : "Elige tus productos y recógelos en La Playita."}
                </p>
                <small>Precios en COP</small>
                {view === "catalog" && (
                  <img
                    className="store-photo"
                    src="/assets/tienda.jpg"
                    alt="La tienda La Playita"
                  />
                )}
              </section>
              <div className="toolbar">
                <Input
                  aria-label="Buscar productos"
                  placeholder="Buscar producto o código…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select
                  aria-label="Categoría"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">Todas las categorías</option>
                  {[
                    ...new Set(products.map((p) => p.category || "Despensa")),
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                {view !== "pos" && (
                  <Button onClick={() => setCartOpen(true)}>
                    Canasta · {money(total)}
                  </Button>
                )}
              </div>
              <div className="cards">
                {products
                  .filter(
                    (p) =>
                      (p.name + " " + (p.code || ""))
                        .normalize("NFD")
                        .replace(/\p{Diacritic}/gu, "")
                        .toLocaleLowerCase()
                        .includes(
                          search
                            .normalize("NFD")
                            .replace(/\p{Diacritic}/gu, "")
                            .toLocaleLowerCase(),
                        ) &&
                      (category === "all" ||
                        (p.category || "Despensa") === category),
                  )
                  .map((p) => (
                    <ProductCard
                      key={p.id}
                      p={p}
                      disabled={pendingSale}
                      remaining={remainingStock(p, cart)}
                      add={(line) => {
                        assertCartAddition(p, cartSnapshot.current, line);
                        const next = [...cartSnapshot.current, line];
                        cartSnapshot.current = next;
                        setCart(next);
                        setMessage("Producto agregado a tu canasta");
                      }}
                    />
                  ))}
              </div>
              {!products.length && (
                <p className="empty">
                  No hay catálogo disponible. La primera consulta requiere
                  conexión.
                </p>
              )}
            </>
          )}
          {view === "profile" && !staff && ownCreditEnabled && (
            <BuyerProfile
              owner={session.actor.id}
              guest={!!session.actor.guest}
            />
          )}
          {view === "credit" && staff && (
            <Credits
              owner={session.actor.id}
              onChange={async (saleRecovered) => {
                if (saleRecovered) {
                  setCart([]);
                  setCheckoutDraft({
                    clientId: "",
                    mode: "cash",
                    received: "",
                  });
                }
                await reload();
              }}
            />
          )}
          {(view === "orders" || view === "history") && (
            <>
              <div className="heading">
                <div>
                  <p className="eyebrow">TODO EN UN SOLO LUGAR</p>
                  <h1>
                    {view === "history"
                      ? "Ventas registradas"
                      : staff
                        ? "Pedidos"
                        : "Mis pedidos"}
                  </h1>
                  <p>
                    Últimos 100 pedidos consultados. Pagos y entregas se
                    registran por separado.
                  </p>
                </div>
                {view === "orders" && (
                  <Select
                    aria-label="Filtrar pedidos"
                    value={orderFilter}
                    onChange={(e) => setOrderFilter(e.target.value)}
                  >
                    <option value="active">Pendientes</option>
                    <option value="all">Todos</option>
                  </Select>
                )}
              </div>
              {view === "history" && (
                <div className="stats">
                  <div className="stat">
                    Ventas cargadas<b>{filteredOrders.length}</b>
                  </div>
                  <div className="stat">
                    Total de ventas cargadas
                    <b>
                      {money(
                        filteredOrders.reduce((n, o) => n + o.totalCop, 0),
                      )}
                    </b>
                  </div>
                </div>
              )}
              <div className="cards orders">
                {filteredOrders.map((o) => orderCard(o))}
              </div>
              {!filteredOrders.length && (
                <p className="empty">
                  No hay{" "}
                  {view === "history"
                    ? "ventas registradas"
                    : "pedidos para este filtro"}
                  .
                </p>
              )}
              {native && (
                <section className="panel">
                  <h2>Pedidos guardados en este dispositivo</h2>
                  <Button
                    onClick={() =>
                      void worker.current
                        ?.sync()
                        .then(async () => {
                          if (box.current) setRows(await box.current.list());
                          await reload();
                        })
                        .catch(() =>
                          setMessage(
                            "No se pudo sincronizar; tus pendientes se conservan.",
                          ),
                        )
                    }
                  >
                    Reintentar envío
                  </Button>
                  {rows.map((r) => (
                    <div className="queue" key={r.request_key}>
                      <strong>{statusName[r.status]}</strong>
                      {r.status === "conflict" && !r.resolved_by && (
                        <Button
                          onClick={() => {
                            const d = JSON.parse(r.payload) as OrderDraft;
                            setCart(d.lines);
                            setClient(d.client?.name || "");
                            setPayment(d.paymentMethod);
                            setRevision(r.request_key);
                            setCartOpen(true);
                            setMessage(
                              "Revisa cantidades y precios; la solicitud original se conservará.",
                            );
                          }}
                        >
                          Revisar en canasta
                        </Button>
                      )}
                      {r.resolved_by && (
                        <small>
                          Se creó una revisión; original conservado.
                        </small>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {view === "notifications" && (
            <>
              <h1>Notificaciones</h1>
              {noticesBody()}
            </>
          )}
          {view === "settings" && !admin && (
            <>
              <div className="heading">
                <h1>Ajustes</h1>
              </div>
              <TextSizeSettings />
            </>
          )}
          {view === "settings" && admin && session.mode === "authenticated" && (
            <Settings api={request} schedule={schedule} reload={reload} />
          )}
        </main>
        <footer>Minimarket La Playita · Recogida en tienda · COP</footer>
      </div>
      {cartOpen && (
        <Modal
          title={staff ? "Venta actual" : "Tu canasta"}
          close={() => setCartOpen(false)}
        >
          {pendingSale && (
            <p className="notice">
              Venta pendiente de respuesta. Reintenta sin cambiar su contenido
              para evitar duplicados.
            </p>
          )}
          {cart.length ? (
            cart.map((l, i) => (
              <div className="cartline" key={i}>
                <div>
                  <strong>
                    {products.find((p) => p.id === l.productId)?.name ||
                      "Producto"}
                  </strong>
                  <small>
                    {l.quantity}{" "}
                    {products.find((p) => p.id === l.productId)?.kind ===
                    "weight"
                      ? "g"
                      : products
                          .find((p) => p.id === l.productId)
                          ?.presentations.find((v) => v.id === l.presentationId)
                          ?.name || "unidades"}{" "}
                    ·{" "}
                    {money(
                      lineTotal(
                        products.find((p) => p.id === l.productId)?.kind ||
                          "unit",
                        l.quantity,
                        l.expectedPriceCop,
                      ),
                    )}
                  </small>
                </div>
                <Button
                  disabled={pendingSale || busy}
                  onClick={() => setCart((c) => c.filter((_, j) => i !== j))}
                >
                  Quitar
                </Button>
              </div>
            ))
          ) : (
            <p className="empty">Tu canasta está vacía.</p>
          )}
          {!staff && (
            <label>
              Cliente (opcional)
              <Input
                maxLength={100}
                value={client}
                disabled={pendingSale || busy}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Cliente general"
              />
            </label>
          )}
          {!staff && (
            <label>
              Forma de pago
              <Select
                value={payment}
                disabled={busy}
                onChange={(e) => setPayment(e.target.value as "cash" | "nequi")}
              >
                <option value="cash">Efectivo al recoger</option>
                <option value="nequi">
                  Nequi · sin integración, pago pendiente
                </option>
              </Select>
            </label>
          )}
          {staff && pendingSale && (
            <>
              <label>
                Efectivo recibido (COP)
                <Input
                  inputMode="numeric"
                  type="number"
                  min="0"
                  step="1"
                  disabled={pendingSale || busy}
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
              </label>
              <p className="notice">
                {Number(cash) >= total
                  ? "Cambio: " + money(Number(cash) - total)
                  : "Faltan " +
                    money(total - Number(cash)) +
                    " para completar el pago"}
              </p>
            </>
          )}
          <div className="total">
            <strong>Total</strong>
            <strong>{money(total)}</strong>
          </div>
          <p>
            {staff
              ? "Revisa el cliente y el tipo de cobro antes de confirmar. Requiere conexión."
              : payment === "nequi"
                ? "No se procesa ni confirma un pago Nequi desde la aplicación."
                : "La tienda confirma el pago en efectivo al recoger."}
          </p>
          {staff && !pendingSale && (
            <Checkout
              owner={session.actor.id}
              lines={cart}
              total={total}
              onBusy={setBusy}
              draft={checkoutDraft}
              onDraftChange={setCheckoutDraft}
              onSaved={() => {
                setCart([]);
                setCheckoutDraft({ clientId: "", mode: "cash", received: "" });
                setCartOpen(false);
                setCash("");
                setMessage("Venta registrada");
                void reload().catch(() =>
                  setMessage(
                    "Registro guardado; vuelve a consultar los datos.",
                  ),
                );
              }}
            />
          )}
          {revision && (
            <p>
              Se enviará una revisión nueva y se conservará el pedido local
              original.
            </p>
          )}
          <p role="alert">{message}</p>
          {(!staff || pendingSale) && (
            <Button
              className="primary"
              disabled={busy || !cart.length}
              onClick={() => void send()}
            >
              {busy
                ? "Procesando…"
                : staff
                  ? "Confirmar efectivo y registrar venta"
                  : revision
                    ? "Enviar revisión"
                    : "Enviar pedido"}
            </Button>
          )}
          <Button disabled={busy} onClick={() => setCartOpen(false)}>
            Cerrar canasta
          </Button>
        </Modal>
      )}
      {bellOpen && (
        <Modal title="Notificaciones" close={() => setBellOpen(false)}>
          {noticesBody()}
        </Modal>
      )}
      {selected && (
        <Modal
          title={"Pedido " + selected.id.slice(0, 8)}
          close={() => setSelected(null)}
        >
          {orderCard(selected, false)}
          {selected.lines.map((l, i) => (
            <div className="cartline" key={i}>
              <span>
                {l.productName}
                <small>
                  {l.quantity}{" "}
                  {l.kind === "weight" ? "g" : l.presentationName || "unidades"}
                </small>
              </span>
              <strong>{money(l.totalCop)}</strong>
            </div>
          ))}
          {selected.channel === "pos" && !selected.creditClientId && (
            <p>
              Recibido: {money((selected as any).cashReceived || 0)} · Cambio:{" "}
              {money((selected as any).cashChange || 0)}
            </p>
          )}
          {admin &&
            selected.status === "delivered" &&
            selected.paymentStatus === "paid" &&
            selected.paymentMethod === "cash" &&
            !selected.creditClientId && (
              <section className="panel">
                <p>
                  Retirar un registro de prueba lo excluye de Ventas y sus
                  totales. El inventario no cambia y queda trazabilidad
                  recuperable en Ajustes.
                </p>
                {!confirmRemoveSale ? (
                  <Button
                    type="button"
                    onClick={() => setConfirmRemoveSale(true)}
                  >
                    Retirar venta de prueba
                  </Button>
                ) : (
                  <>
                    <p>
                      ¿Retirar esta venta por {money(selected.totalCop)} sin
                      cambiar el inventario?
                    </p>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          try {
                            await request(
                              "/sales/" + selected.id + "/removal",
                              {
                                method: "POST",
                                headers: {
                                  "Idempotency-Key": crypto.randomUUID(),
                                },
                                body: JSON.stringify({
                                  removed: true,
                                  reason:
                                    "Retiro de venta ficticia autorizado por administrador; conservar inventario",
                                }),
                              },
                            );
                            setSelected(null);
                            setConfirmRemoveSale(false);
                            await reload();
                            setMessage(
                              "Venta de prueba retirada. El inventario conserva sus cantidades.",
                            );
                          } catch {
                            setMessage(
                              "No se pudo retirar el registro. Consulta el estado antes de reintentar.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        })()
                      }
                    >
                      Confirmar retiro sin cambiar inventario
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmRemoveSale(false)}
                    >
                      Conservar venta
                    </Button>
                  </>
                )}
              </section>
            )}
          <p>
            Cliente: {selected.clientName}
            {selected.clientReference ? " · " + selected.clientReference : ""}
          </p>
        </Modal>
      )}
    </>
  );
}
export function ProductCard({
  p,
  add,
  disabled = false,
  remaining = p.available,
}: {
  p: Product;
  add: (line: OrderDraft["lines"][number]) => void;
  disabled?: boolean;
  remaining?: number;
}) {
  const [n, setN] = useState("1"),
    [unit, setUnit] = useState<"kg" | "lb">("kg"),
    [id, setId] = useState(p.presentations[0]?.id || ""),
    [error, setError] = useState("");
  const pres = p.presentations.find((v) => v.id === id) || p.presentations[0],
    price = pres?.priceCop ?? p.priceCop;
  return (
    <Card component="article" className="card product-card" variant="outlined">
      <div
        className={"product-art" + (p.photo ? " has-photo" : "")}
        aria-hidden="true"
      >
        {p.photo ? (
          <img src={p.photo} alt={p.name} />
        ) : p.name.toLocaleLowerCase().includes("huevo") ? (
          "🥚"
        ) : p.kind === "weight" ? (
          "🥔"
        ) : (
          "🛒"
        )}
      </div>
      <span className="tag">
        {p.kind === "weight" ? "Por peso" : "Por presentación"}
      </span>
      <h3>{p.name}</h3>
      <small>{p.category || "Despensa"}</small>
      {p.description && <small>{p.description}</small>}
      <small>
        Disponible para agregar: {remaining}{" "}
        {p.kind === "weight" ? "g" : "unidades base"}
      </small>
      <p className="price">
        {money(
          p.kind === "weight" && unit === "lb" ? Math.round(price / 2) : price,
        )}
        <small>
          {p.kind === "weight"
            ? unit === "lb"
              ? "por libra"
              : "por kilo"
            : pres?.name}
        </small>
      </p>
      <div className="buyline">
        <label>
          Cantidad
          <Input
            type="number"
            min={p.kind === "weight" ? ".001" : "1"}
            step={p.kind === "weight" ? ".001" : "1"}
            max={
              p.kind === "weight"
                ? remaining / (unit === "lb" ? 500 : 1000)
                : Math.floor(remaining / (pres?.factor || 1))
            }
            value={n}
            onChange={(e) => setN(e.target.value)}
          />
        </label>
        <label>
          {p.kind === "weight" ? "Unidad" : "Presentación"}
          {p.kind === "weight" ? (
            <Select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "kg" | "lb")}
            >
              <option value="kg">Kilo</option>
              <option value="lb">Libra</option>
            </Select>
          ) : (
            <Select
              value={pres?.id || ""}
              onChange={(e) => setId(e.target.value)}
            >
              {p.presentations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {money(v.priceCop)}
                </option>
              ))}
            </Select>
          )}
        </label>
      </div>
      <Button
        className="primary"
        disabled={disabled || remaining <= 0}
        onClick={() => {
          try {
            const quantity =
              p.kind === "weight" ? grams(Number(n), unit) : Number(n);
            if (!Number.isSafeInteger(quantity) || quantity <= 0)
              throw Error("Cantidad inválida");
            const line = {
              productId: p.id,
              ...(p.kind === "unit" ? { presentationId: pres?.id } : {}),
              quantity,
              expectedPriceCop: price,
            };
            assertCartAddition({ ...p, available: remaining }, [], line);
            add(line);
            setError("");
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "No se pudo agregar el producto",
            );
          }
        }}
      >
        + Agregar
      </Button>
      <small role="alert">{error}</small>
    </Card>
  );
}
