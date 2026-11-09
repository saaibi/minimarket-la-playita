import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { io } from "socket.io-client";
import { grams, type Product, type OrderDraft } from "@playita/shared";
import {
  openNativeOutbox,
  Outbox,
  Synchronizer,
  httpTransport,
  type OutboxRow,
} from "@playita/mobile";
import "./style.css";
const apiUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:4300",
  native = Capacitor.isNativePlatform();
type Session = { token: string; id: string; role: string };
function App() {
  const [token, setToken] = useState(""),
    [session, setSession] = useState<Session | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [cart, setCart] = useState<OrderDraft["lines"]>([]),
    [rows, setRows] = useState<OutboxRow[]>([]),
    [orders, setOrders] = useState<unknown[]>([]),
    [message, setMessage] = useState(
      "Conecta una sesión local para consultar inventario.",
    ),
    [client, setClient] = useState(""),
    [revision, setRevision] = useState<{ key: string; text: string } | null>(
      null,
    );
  const box = useRef<Outbox | null>(null),
    sync = useRef<Synchronizer | null>(null);
  async function request(path: string, init: RequestInit = {}) {
    if (!session) throw Error("Sesión requerida");
    const response = await fetch(apiUrl + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + session.token,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(JSON.stringify(data));
    return data;
  }
  useEffect(() => {
    if (!session) return;
    let active = true;
    let ownBox: Outbox | null = null;
    let ownSync: Synchronizer | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = async () => {
      if (ownBox && active) setRows(await ownBox.list());
    };
    const refresh = async () => {
      try {
        const catalog = (await request("/inventory")) as Product[];
        if (active) {
          setProducts(catalog);
          setMessage("Catálogo consultado al servidor.");
          setOrders((await request("/orders")) as unknown[]);
        }
        if (active) await ownBox?.saveCatalog(catalog);
      } catch (e) {
        const cached = await ownBox?.catalog();
        if (active) {
          if (cached) setProducts(cached.data as Product[]);
          setMessage(
            cached
              ? "Catálogo guardado " +
                  new Date(cached.updatedAt).toLocaleString("es-CO") +
                  " · stock sin garantía global sin red."
              : "Servidor no disponible o sesión inválida: " + String(e),
          );
        }
      }
    };
    const work = async () => {
      try {
        await ownSync?.sync();
        await update();
      } catch (e) {
        if (active)
          setMessage("Sincronización detenida; cola conservada: " + String(e));
      }
    };
    void (async () => {
      try {
        if (native) {
          const b = await openNativeOutbox(session.id);
          if (!active) return;
          ownBox = b;
          ownSync = new Synchronizer(
            b,
            httpTransport(apiUrl, () => session.token),
          );
          box.current = ownBox;
          sync.current = ownSync;
          await update();
        }
        await refresh();
        timer = setInterval(() => void work(), 5000);
      } catch (e) {
        if (active) setMessage("SQLite no disponible: " + String(e));
      }
    })();
    const socket = io(apiUrl, { auth: { token: session.token } });
    socket.on("connect", () => {
      void refresh();
      void work();
    });
    socket.on("change", () => void refresh());
    window.addEventListener("online", work);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      socket.disconnect();
      window.removeEventListener("online", work);
      box.current = null;
      sync.current = null;
    };
  }, [session]);
  function connect() {
    try {
      const part = token.split(".")[1]!;
      const payload = JSON.parse(
        atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      ) as { sub: string; role: string };
      if (!payload.sub) throw Error("Token inválido");
      setProducts([]);
      setCart([]);
      setRows([]);
      setOrders([]);
      setSession({ token, id: payload.sub, role: payload.role });
    } catch {
      setMessage(
        "Token inválido. Genera credenciales locales; el servidor verifica firma, rol y vencimiento.",
      );
    }
  }
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
        setMessage(
          "Guardado durable como pending_sync. Aún sin confirmación, pago ni reserva global.",
        );
        setCart([]);
        await sync.current?.sync();
        setRows(await box.current.list());
      } else {
        const o = await request("/orders", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(draft),
        });
        setMessage("Pedido confirmado por servidor: " + o.id);
        setCart([]);
        setProducts((await request("/inventory")) as Product[]);
        setOrders((await request("/orders")) as unknown[]);
      }
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <>
      <header>
        <span className="mark">⌂</span>
        <div>
          <strong>Minimarket La Playita</strong>
          <small>Primer incremento · desarrollo separado del prototipo</small>
        </div>
        <span className="pill">
          {native ? "Móvil · SQLite" : "Web · requiere conexión"}
        </span>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">DEL CAMPO A TU MESA</p>
          <h1>Un pedido, sin perderlo.</h1>
          <p>Catálogo, pedido y sincronización · recogida en tienda · COP.</p>
          <small>
            Esta base aún no sustituye el diseño aprobado. Sin procesamiento de
            pagos; Nequi real pendiente. Offline solo móvil.
          </small>
        </section>
        <section className="panel">
          <h2>Sesión de desarrollo</h2>
          <p>
            Usa un JWT local generado con <code>npm run dev:credentials</code>.
            No se guarda en localStorage ni en SQLite. El servidor verifica los
            permisos.
          </p>
          <label>
            Token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button onClick={connect}>Conectar</button>
          {session && (
            <small>
              {session.role} · {session.id}
            </small>
          )}
        </section>
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
            Esperando catálogo autorizado. En móvil se reutiliza la última
            consulta guardada de la misma cuenta.
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
            Cliente opcional · vacío = Cliente general
            <input
              maxLength={100}
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </label>
          <p>
            Efectivo al recoger. Precio y disponibilidad se validan al enviar.
          </p>
          <button
            disabled={!session || !cart.length}
            onClick={() => void send()}
          >
            {native ? "Guardar en SQLite y sincronizar" : "Enviar online"}
          </button>
        </section>
        {native && (
          <section className="panel">
            <h2>Cola durable</h2>
            <button
              onClick={() => {
                void sync.current
                  ?.sync()
                  .then(async () => setRows(await box.current!.list()));
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
                  <small>
                    Revisión: {row.resolved_by}. Original conservado.
                  </small>
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
              Edición técnica temporal: verifica datos y precio actual. Crea una
              clave nueva sin borrar la solicitud original.
            </p>
            <textarea
              rows={12}
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
                      JSON.parse(revision.text) as OrderDraft,
                    );
                    setRevision(null);
                    setRows(await box.current!.list());
                  } catch (e) {
                    setMessage(String(e));
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
          <h2>Pedidos recuperados por REST</h2>
          {orders.map((o, i) => (
            <pre key={i}>{JSON.stringify(o, null, 2)}</pre>
          ))}
          {!orders.length && <p className="empty">Sin pedidos recuperados.</p>}
        </section>
      </main>
      <footer>Local · Sin publicación · Datos del prototipo intactos</footer>
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
createRoot(document.getElementById("root")!).render(<App />);
