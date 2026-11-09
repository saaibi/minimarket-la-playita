import React from "react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { grams, type Product, type OrderDraft } from "@playita/shared";
import {
  openNativeOutbox,
  Outbox,
  Synchronizer,
  type OutboxRow,
} from "@playita/mobile";
import {
  auth,
  useSession,
  native,
  base,
  backendConfigured,
} from "./session.js";
import { Login, Protected } from "./login.js";
import { StaffUsers } from "./staff.js";
import "./style.css";
function App() {
  const session = useSession()!,
    [products, setProducts] = useState<Product[]>([]),
    [cart, setCart] = useState<OrderDraft["lines"]>([]),
    [rows, setRows] = useState<OutboxRow[]>([]),
    [orders, setOrders] = useState<unknown[]>([]),
    [message, setMessage] = useState("Consultando tienda…"),
    [client, setClient] = useState(""),
    [revision, setRevision] = useState<{ key: string; text: string } | null>(
      null,
    );
  const box = useRef<Outbox | null>(null),
    worker = useRef<Synchronizer | null>(null);
  async function request(path: string, init: RequestInit = {}) {
    const response = await auth.request(path, init, session.actor.id),
      data = await response.json();
    if (!response.ok) throw Error(data.code || "Solicitud rechazada");
    return data;
  }
  useEffect(() => {
    let active = true,
      ownBox: Outbox | null = null,
      ownWorker: Synchronizer | null = null;
    const socket = io(base, { withCredentials: true, autoConnect: false });
    const update = async () => {
      if (ownBox && active) setRows(await ownBox.list());
    };
    const refresh = async () => {
      try {
        const list = (await request("/inventory")) as Product[];
        if (active) {
          setProducts(list);
          setOrders((await request("/orders")) as unknown[]);
          setMessage(
            "Inventario consultado. Reserva y pago se validan en servidor.",
          );
          await ownBox?.saveCatalog(list);
        }
      } catch {
        const cached = await ownBox?.catalog();
        if (active) {
          if (cached)
            setProducts(
              (cached.data as Product[]).map((p) =>
                session.actor.role === "admin"
                  ? p
                  : (({ costCop, ...rest }) => rest)(p),
              ),
            );
          setMessage(
            cached
              ? "Catálogo guardado: disponibilidad sin garantía global sin red."
              : "Conexión o sesión no disponible. Reautentica para enviar pedidos.",
          );
        }
      }
    };
    const work = async () => {
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
            "Sincronización pausada. Cola conservada; reautentica la misma cuenta.",
          );
      }
    };
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
        }
        await refresh();
        if (session.mode === "authenticated") {
          socket.auth = await auth.socketCredentials(session.actor.id);
          if (active) socket.connect();
        }
      } catch {
        if (active)
          setMessage(
            "No se pudo iniciar la persistencia o sesión; no se borró la cola.",
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
                setMessage("Sesión vencida. Reautentica antes de sincronizar."),
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
  async function send() {
    try {
      if (!cart.length) throw Error("Carrito vacío");
      const draft: OrderDraft = {
        lines: cart,
        paymentMethod: "cash",
        ...(client.trim() ? { client: { name: client.trim() } } : {}),
      };
      if (native) {
        if (!box.current) throw Error("SQLite aún no está listo");
        await box.current.enqueue(draft);
        setRows(await box.current.list());
        setCart([]);
        setMessage(
          "Guardado pending_sync. Aún no pagado, confirmado ni reservado globalmente.",
        );
        if (session.mode === "authenticated") {
          await worker.current?.sync();
          setRows(await box.current.list());
        }
      } else {
        const o = await request("/orders", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(draft),
        });
        setMessage("Pedido confirmado: " + o.id);
        setCart([]);
        setProducts((await request("/inventory")) as Product[]);
        setOrders((await request("/orders")) as unknown[]);
      }
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function logout() {
    if (
      session.actor.guest &&
      rows.some((r) => !r.resolved_by && r.status !== "synced")
    ) {
      setMessage(
        "Conserva la sesión invitada hasta sincronizar o revisar sus pendientes. No se reasignan a otra cuenta.",
      );
      return;
    }
    await auth.logout();
  }
  return (
    <>
      <header>
        <span className="mark">⌂</span>
        <div>
          <strong>Minimarket La Playita</strong>
          <small>
            Desarrollo · {native ? "Móvil SQLite" : "Web conectada"}
          </small>
        </div>
        <button onClick={() => void logout()}>Salir</button>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">DEL CAMPO A TU MESA</p>
          <h1>Tu tienda, a la mano.</h1>
          <p>Recogida en tienda · COP · Libra = 500 g.</p>
          <small>
            {session.actor.label} · {session.actor.role} ·{" "}
            {session.mode === "offline"
              ? "Modo local: reautenticar para enviar"
              : "Sesión activa"}
          </small>
        </section>
        {session.actor.role === "admin" && session.mode === "authenticated" && (
          <Link to="/admin/users">Gestionar administradores y vendedores</Link>
        )}
        {session.mode === "offline" && !session.actor.guest && (
          <button onClick={() => void auth.logout()}>
            Reautenticar (cola conservada)
          </button>
        )}
        <p role="status" className="status">
          {message}
        </p>
        <h2>Catálogo</h2>
        <div className="cards">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              add={(line) => setCart((c) => [...c, line])}
            />
          ))}
        </div>
        {!products.length && (
          <p className="empty">
            Sin catálogo disponible. La primera visita requiere conexión.
          </p>
        )}
        <section className="panel">
          <h2>Pedido actual</h2>
          {cart.map((line, i) => (
            <div className="row" key={i}>
              <span>
                {products.find((p) => p.id === line.productId)?.name} ·{" "}
                {line.quantity}{" "}
                {products.find((p) => p.id === line.productId)?.kind ===
                "weight"
                  ? "g"
                  : "paquetes"}
              </span>
              <button
                onClick={() => setCart((c) => c.filter((_, j) => i !== j))}
              >
                Quitar
              </button>
            </div>
          ))}
          <label>
            Nombre opcional · vacío = Cliente general
            <input
              maxLength={100}
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </label>
          <p>Efectivo al recoger. Sin procesamiento de pagos Nequi.</p>
          <button disabled={!cart.length} onClick={() => void send()}>
            {native ? "Guardar pedido durable" : "Enviar pedido online"}
          </button>
        </section>
        {native && (
          <section className="panel">
            <h2>Cola de esta identidad</h2>
            <button
              onClick={() => {
                void worker.current
                  ?.sync()
                  .then(async () => {
                    if (box.current) setRows(await box.current.list());
                  })
                  .catch(() =>
                    setMessage(
                      "Sesión/conexión no disponible. Pendientes conservados.",
                    ),
                  );
              }}
            >
              Sincronizar
            </button>
            {rows.map((row) => (
              <article className="queue" key={row.request_key}>
                <strong>{row.status}</strong>
                <small>
                  {row.request_key} · {row.attempts} intentos
                </small>
                <p>{row.last_error}</p>
                {row.response && <pre>{row.response}</pre>}
                {row.resolved_by && (
                  <small>Revisión creada; original conservado.</small>
                )}
                {row.status === "conflict" && !row.resolved_by && (
                  <button
                    onClick={() =>
                      setRevision({
                        key: row.request_key,
                        text: JSON.stringify(JSON.parse(row.payload), null, 2),
                      })
                    }
                  >
                    Revisar conflicto
                  </button>
                )}
              </article>
            ))}
          </section>
        )}
        {revision && (
          <section className="panel">
            <h2>Revisión explícita</h2>
            <p>
              Editor técnico temporal. No modifica el original ni confirma el
              pedido.
            </p>
            <textarea
              rows={10}
              value={revision.text}
              onChange={(e) =>
                setRevision({ ...revision, text: e.target.value })
              }
            />
            <button
              onClick={() => {
                void (async () => {
                  try {
                    await box.current!.revise(
                      revision.key,
                      JSON.parse(revision.text),
                    );
                    setRevision(null);
                    setRows(await box.current!.list());
                  } catch {
                    setMessage("Revisa la solicitud antes de guardar.");
                  }
                })();
              }}
            >
              Guardar revisión pendiente
            </button>
            <button onClick={() => setRevision(null)}>Cancelar</button>
          </section>
        )}
        <section className="panel">
          <h2>Mis pedidos recuperados por REST</h2>
          {orders.map((o, i) => (
            <pre key={i}>{JSON.stringify(o, null, 2)}</pre>
          ))}
          {!orders.length && <p className="empty">Sin pedidos recuperados.</p>}
        </section>
      </main>
      <footer>
        Desarrollo local · Sin publicación de la app · Prototipo separado
      </footer>
    </>
  );
}
function ProductCard({
  p,
  add,
}: {
  p: Product;
  add: (line: OrderDraft["lines"][number]) => void;
}) {
  const [n, setN] = useState("1"),
    [unit, setUnit] = useState<"kg" | "lb">("kg"),
    [id, setId] = useState(p.presentations[0]?.id || ""),
    [error, setError] = useState("");
  const pres = p.presentations.find((v) => v.id === id),
    price = pres?.priceCop ?? p.priceCop;
  return (
    <article className="panel">
      <span className="pill">
        {p.kind === "weight" ? "Por peso" : "Por presentación"}
      </span>
      <h3>{p.name}</h3>
      <small>
        Disponibles al consultar: {p.available}{" "}
        {p.kind === "weight" ? "g" : "unidades base"}
      </small>
      <p className="price">
        {price.toLocaleString("es-CO")} COP
        <small>
          {p.kind === "weight"
            ? "por kilo"
            : `${pres?.name} · ${pres?.factor} unidades base`}
        </small>
      </p>
      {p.costCop !== undefined && <small>Costo admin: {p.costCop} COP</small>}
      <label>
        Cantidad
        <input
          type="number"
          min={p.kind === "weight" ? ".001" : "1"}
          step={p.kind === "weight" ? ".001" : "1"}
          value={n}
          onChange={(e) => setN(e.target.value)}
        />
      </label>
      {p.kind === "weight" ? (
        <label>
          Unidad
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as "kg" | "lb")}
          >
            <option value="kg">Kilo</option>
            <option value="lb">Libra · 500 g</option>
          </select>
        </label>
      ) : (
        <label>
          Presentación
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {p.presentations.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.factor} un. · {v.priceCop} COP
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        onClick={() => {
          try {
            const quantity =
              p.kind === "weight" ? grams(Number(n), unit) : Number(n);
            if (!Number.isSafeInteger(quantity) || quantity <= 0)
              throw Error("Cantidad inválida");
            add({
              productId: p.id,
              quantity,
              expectedPriceCop: price,
              ...(p.kind === "unit" ? { presentationId: id } : {}),
            });
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        Agregar
      </button>
      <small>Precios ilustrativos.</small>
      <p role="alert">{error}</p>
    </article>
  );
}
function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!backendConfigured) return;
    void auth
      .restore()
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  if (!backendConfigured)
    return (
      <main>
        <article>
          <h1>Minimarket La Playita</h1>
          <p>Versión de prueba Android · 0.1.0</p>
          <h2>API de pruebas no configurada</h2>
          <p>
            La aplicación está instalada. Para iniciar sesión, consultar
            inventario y enviar pedidos necesita una API HTTPS disponible.
          </p>
          <p>
            Esta compilación no incluye datos de demostración ni confirma
            pedidos sin conexión. El acceso estará disponible en una nueva
            compilación con la API configurada.
          </p>
        </article>
      </main>
    );
  if (!ready)
    return (
      <main>
        <p role="status">Comprobando sesión…</p>
      </main>
    );
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app/*"
          element={
            <Protected>
              <App />
            </Protected>
          }
        />
        <Route
          path="/admin/users"
          element={
            <Protected admin>
              <StaffUsers />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
